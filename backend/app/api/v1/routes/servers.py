from datetime import UTC, datetime, timedelta
import subprocess
from shutil import which
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session, selectinload

from app.db.session import get_db
from app.models.server_action import ServerAction
from app.models.server import Server
from app.schemas.action import IloNetworkActionRequest, IloUserActionRequest, ServerActionRead
from app.schemas.server import BulkDeleteRequest, BulkDeleteResponse, DashboardStats, ServerDetail, ServerRead, ServerUpdate

router = APIRouter()
OFFLINE_AFTER = timedelta(minutes=5)


def ping_ip(ip_address: str | None) -> bool | None:
    if not ip_address:
        return None
    if which("ping") is None:
        return None

    try:
        result = subprocess.run(
            ["ping", "-c", "1", "-W", "1", ip_address],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=2,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return False

    return result.returncode == 0


def server_to_read(server: Server) -> dict[str, Any]:
    return {
        "id": server.id,
        "uuid": server.uuid,
        "serial_number": server.serial_number,
        "vendor": server.vendor,
        "model": server.model,
        "product_name": server.product_name,
        "hostname": server.hostname,
        "agent_ip": server.agent_ip,
        "bmc_ip": server.bmc_ip,
        "management_config_json": server.management_config_json,
        "agent_reachable": ping_ip(server.agent_ip),
        "bmc_reachable": ping_ip(server.bmc_ip),
        "status": server.status,
        "last_seen": server.last_seen,
        "created_at": server.created_at,
        "updated_at": server.updated_at,
    }


def server_to_detail(server: Server) -> dict[str, Any]:
    data = server_to_read(server)
    data["inventories"] = server.inventories
    return data


def refresh_server_statuses(db: Session) -> None:
    cutoff = datetime.now(UTC) - OFFLINE_AFTER
    servers = db.scalars(select(Server).where(Server.last_seen < cutoff, Server.status == "online")).all()
    for server in servers:
        server.status = "offline"
    if servers:
        db.commit()


@router.get("", response_model=list[ServerRead])
def list_servers(db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    refresh_server_statuses(db)
    servers = db.scalars(select(Server).order_by(desc(Server.last_seen))).all()
    return [server_to_read(server) for server in servers]


@router.get("/stats", response_model=DashboardStats)
def dashboard_stats(db: Session = Depends(get_db)) -> DashboardStats:
    refresh_server_statuses(db)
    total = db.scalar(select(func.count(Server.id))) or 0
    online = db.scalar(select(func.count(Server.id)).where(Server.status == "online")) or 0
    offline = db.scalar(select(func.count(Server.id)).where(Server.status == "offline")) or 0
    return DashboardStats(total_servers=total, online_servers=online, offline_servers=offline)


@router.post("/bulk-delete", response_model=BulkDeleteResponse)
def bulk_delete_servers(payload: BulkDeleteRequest, db: Session = Depends(get_db)) -> BulkDeleteResponse:
    unique_ids = sorted(set(payload.server_ids))
    servers = db.scalars(select(Server).where(Server.id.in_(unique_ids))).all()

    for server in servers:
        db.delete(server)

    db.commit()
    return BulkDeleteResponse(deleted=len(servers), requested=len(unique_ids))


@router.get("/actions/recent", response_model=list[ServerActionRead])
def recent_server_actions(limit: int = 50, db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    bounded_limit = min(max(limit, 1), 200)
    actions = db.scalars(select(ServerAction).order_by(desc(ServerAction.requested_at)).limit(bounded_limit)).all()
    return [action_to_read(action) for action in actions]


@router.get("/{server_id}", response_model=ServerDetail)
def get_server(server_id: int, db: Session = Depends(get_db)) -> dict[str, Any]:
    refresh_server_statuses(db)
    server = db.scalar(
        select(Server)
        .where(Server.id == server_id)
        .options(selectinload(Server.inventories))
    )
    if server is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found")
    return server_to_detail(server)


@router.patch("/{server_id}", response_model=ServerRead)
def update_server(server_id: int, payload: ServerUpdate, db: Session = Depends(get_db)) -> dict[str, Any]:
    server = db.get(Server, server_id)
    if server is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(server, field, value)

    db.commit()
    db.refresh(server)
    return server_to_read(server)


def mask_secret_fields(value: Any) -> Any:
    if isinstance(value, dict):
        masked: dict[str, Any] = {}
        for key, item in value.items():
            if "password" in key.lower():
                masked[key] = "********"
            else:
                masked[key] = mask_secret_fields(item)
        return masked
    if isinstance(value, list):
        return [mask_secret_fields(item) for item in value]
    return value


def mask_action_payload(action_type: str, payload: dict[str, Any]) -> dict[str, Any]:
    return mask_secret_fields(payload)


def action_to_read(action: ServerAction) -> dict[str, Any]:
    return {
        "id": action.id,
        "server_id": action.server_id,
        "action_type": action.action_type,
        "status": action.status,
        "payload_json": mask_action_payload(action.action_type, action.payload_json),
        "result_json": action.result_json,
        "error_message": action.error_message,
        "requested_at": action.requested_at,
        "started_at": action.started_at,
        "completed_at": action.completed_at,
    }


@router.post("/{server_id}/actions/hpe-create-ilo-user", response_model=ServerActionRead, status_code=status.HTTP_201_CREATED)
def create_ilo_user_action(server_id: int, payload: IloUserActionRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    server = db.get(Server, server_id)
    if server is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found")

    action = ServerAction(
        server_id=server.id,
        action_type="hpe_create_ilo_user",
        payload_json={
            "username": payload.username,
            "password": payload.password,
            "bmc_ip": server.bmc_ip,
            "auth": {
                "username": payload.admin_username,
                "password": payload.admin_password,
            },
        },
    )
    db.add(action)
    db.commit()
    db.refresh(action)
    return action_to_read(action)


@router.post("/{server_id}/actions/hpe-set-ilo-network", response_model=ServerActionRead, status_code=status.HTTP_201_CREATED)
def set_ilo_network_action(server_id: int, payload: IloNetworkActionRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    server = db.get(Server, server_id)
    if server is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found")

    management_config = {
        "ip": payload.ip,
        "subnet": payload.subnet,
        "gateway": payload.gateway,
        "dns": payload.dns,
        "ntp": payload.ntp,
        "vlan": payload.vlan or "0",
    }
    action = ServerAction(
        server_id=server.id,
        action_type="hpe_set_ilo_network",
        payload_json={
            "management": management_config,
            "bmc_ip": server.bmc_ip,
            "auth": {
                "username": payload.admin_username,
                "password": payload.admin_password,
            },
        },
    )
    server.bmc_ip = payload.ip
    server.management_config_json = management_config

    db.add(action)
    db.commit()
    db.refresh(action)
    return action_to_read(action)


@router.delete("/{server_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_server(server_id: int, db: Session = Depends(get_db)) -> None:
    server = db.get(Server, server_id)
    if server is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found")

    db.delete(server)
    db.commit()
