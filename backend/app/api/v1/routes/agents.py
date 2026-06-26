from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.inventory import Inventory
from app.models.server import Server
from app.models.server_action import ServerAction
from app.schemas.agent import AgentActionComplete, AgentActionPoll, AgentActionRead, AgentHeartbeat, AgentRegistration, InventoryUpload
from app.schemas.server import ServerRead

router = APIRouter()


def mask_secret_fields(value: object) -> object:
    if isinstance(value, dict):
        masked: dict[str, object] = {}
        for key, item in value.items():
            if "password" in key.lower() or "license_key" in key.lower():
                masked[key] = "********"
            else:
                masked[key] = mask_secret_fields(item)
        return masked
    if isinstance(value, list):
        return [mask_secret_fields(item) for item in value]
    return value


def default_hostname(serial_number: str) -> str:
    return f"iLO-{serial_number}"


def update_if_known(server: Server, field_name: str, value: str | None) -> None:
    if value is not None:
        setattr(server, field_name, value)


def merged_management_config(server: Server) -> dict:
    return dict(server.management_config_json or {})


def compact_management_config(value: dict) -> dict:
    return {key: item for key, item in value.items() if item is not None}


def reject_deregistered(server: Server) -> None:
    if server.status == "deregistered":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Server is deregistered")


@router.post("/register", response_model=ServerRead, status_code=status.HTTP_201_CREATED)
def register_agent(payload: AgentRegistration, db: Session = Depends(get_db)) -> Server:
    now = datetime.now(UTC)
    server = db.scalar(select(Server).where(Server.serial_number == payload.serial_number))

    if server is None:
        server = Server(
            serial_number=payload.serial_number,
            vendor=payload.vendor,
            model=payload.model,
            product_name=payload.product_name,
            hostname=payload.hostname or default_hostname(payload.serial_number),
            agent_ip=payload.agent_ip,
            bmc_ip=payload.bmc_ip,
            management_config_json={
                "registration": {
                    "status": "registered",
                    "registered_at": now.isoformat(),
                }
            },
            status="online",
            last_seen=now,
        )
        db.add(server)
    else:
        update_if_known(server, "vendor", payload.vendor)
        update_if_known(server, "model", payload.model)
        update_if_known(server, "product_name", payload.product_name)
        update_if_known(server, "hostname", payload.hostname)
        update_if_known(server, "agent_ip", payload.agent_ip)
        update_if_known(server, "bmc_ip", payload.bmc_ip)
        if server.hostname is None:
            server.hostname = default_hostname(payload.serial_number)
        current = merged_management_config(server)
        current["registration"] = compact_management_config(
            {
                "status": "reclaimed" if server.status == "deregistered" else "registered",
                "registered_at": now.isoformat(),
            }
        )
        server.management_config_json = compact_management_config(current)
        server.status = "online"
        server.last_seen = now

    db.commit()
    db.refresh(server)
    return server


@router.post("/heartbeat", response_model=ServerRead)
def heartbeat(payload: AgentHeartbeat, db: Session = Depends(get_db)) -> Server:
    server = db.scalar(select(Server).where(Server.serial_number == payload.serial_number))
    if server is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server is not registered")
    reject_deregistered(server)

    server.status = "online"
    server.last_seen = datetime.now(UTC)
    if payload.agent_ip is not None:
        server.agent_ip = payload.agent_ip

    db.commit()
    db.refresh(server)
    return server


@router.post("/inventory", status_code=status.HTTP_201_CREATED)
def upload_inventory(payload: InventoryUpload, db: Session = Depends(get_db)) -> dict[str, int | str]:
    server = db.scalar(select(Server).where(Server.serial_number == payload.serial_number))
    if server is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server is not registered")
    reject_deregistered(server)

    inventory = Inventory(server_id=server.id, inventory_json=payload.inventory)
    server.status = "online"
    server.last_seen = datetime.now(UTC)
    system = payload.inventory.get("system") if isinstance(payload.inventory, dict) else None
    if isinstance(system, dict):
        update_if_known(server, "vendor", system.get("vendor"))
        update_if_known(server, "model", system.get("model"))
        update_if_known(server, "product_name", system.get("product_name"))
        bmc = payload.inventory.get("bmc")
        if isinstance(bmc, dict):
            update_if_known(server, "bmc_ip", bmc.get("ip"))

    db.add(inventory)
    db.commit()
    db.refresh(inventory)
    return {"status": "stored", "inventory_id": inventory.id}


@router.post("/actions/next", response_model=AgentActionRead | None)
def next_action(payload: AgentActionPoll, db: Session = Depends(get_db)) -> dict | None:
    server = db.scalar(select(Server).where(Server.serial_number == payload.serial_number))
    if server is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server is not registered")
    reject_deregistered(server)

    action = db.scalar(
        select(ServerAction)
        .where(ServerAction.server_id == server.id, ServerAction.status == "pending")
        .order_by(ServerAction.requested_at, ServerAction.id)
        .limit(1)
    )
    if action is None:
        return None

    action.status = "running"
    action.started_at = datetime.now(UTC)
    db.commit()
    db.refresh(action)
    return {"id": action.id, "action_type": action.action_type, "payload": action.payload_json}


@router.post("/actions/{action_id}/complete")
def complete_action(action_id: int, payload: AgentActionComplete, db: Session = Depends(get_db)) -> dict[str, str]:
    server = db.scalar(select(Server).where(Server.serial_number == payload.serial_number))
    if server is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server is not registered")

    action = db.scalar(select(ServerAction).where(ServerAction.id == action_id, ServerAction.server_id == server.id))
    if action is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Action not found")

    if payload.status not in {"succeeded", "failed"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid action status")

    original_payload = action.payload_json
    action.status = payload.status
    action.result_json = payload.result
    action.error_message = payload.error
    action.completed_at = datetime.now(UTC)
    action.payload_json = mask_secret_fields(action.payload_json)

    if action.action_type == "hpe_set_ilo_network" and payload.status == "succeeded":
        management = original_payload.get("management", {})
        if isinstance(management, dict):
            ip = management.get("ip")
            if ip:
                server.bmc_ip = str(ip)
            current = merged_management_config(server)
            current.update(management)
            server.management_config_json = compact_management_config(current)

    if action.action_type == "hpe_verify_ilo_credential" and payload.status == "succeeded":
        result = payload.result or {}
        bmc = result.get("bmc") if isinstance(result, dict) else None
        current = merged_management_config(server)
        if isinstance(bmc, dict):
            ip = bmc.get("ip")
            if ip:
                server.bmc_ip = str(ip)
            current.update(bmc)
        auth = original_payload.get("auth") if isinstance(original_payload, dict) else None
        if isinstance(auth, dict):
            current["credential"] = compact_management_config(
                {
                    "username": auth.get("username"),
                    "password": auth.get("password"),
                    "verified": True,
                    "verified_at": action.completed_at.isoformat() if action.completed_at else None,
                    "source": original_payload.get("source"),
                }
            )
        dns_name = original_payload.get("dns_name") if isinstance(original_payload, dict) else None
        if dns_name:
            current["dns_name"] = dns_name
        managed_user = result.get("managed_user") if isinstance(result, dict) else None
        if isinstance(managed_user, dict) and managed_user.get("created"):
            current["managed_user"] = compact_management_config(
                {
                    "username": managed_user.get("username"),
                    "password": managed_user.get("password"),
                    "created": True,
                    "created_at": action.completed_at.isoformat() if action.completed_at else None,
                    "source": "verify-credential",
                }
            )
        server.management_config_json = compact_management_config(current)

    if action.action_type == "hpe_create_ilo_user" and payload.status == "succeeded":
        current = merged_management_config(server)
        result = payload.result or {}
        bmc = result.get("bmc") if isinstance(result, dict) else None
        if isinstance(bmc, dict):
            ip = bmc.get("ip")
            if ip:
                server.bmc_ip = str(ip)
            current.update(bmc)
        auth = original_payload.get("auth") if isinstance(original_payload, dict) else None
        if isinstance(auth, dict) and auth.get("username") and auth.get("password"):
            current["credential"] = compact_management_config(
                {
                    "username": auth.get("username"),
                    "password": auth.get("password"),
                    "verified": True,
                    "verified_at": action.completed_at.isoformat() if action.completed_at else None,
                    "source": original_payload.get("source") if isinstance(original_payload, dict) else "create-user-action",
                }
            )
        dns_name = original_payload.get("dns_name") if isinstance(original_payload, dict) else None
        if dns_name:
            current["dns_name"] = dns_name
        current["managed_user"] = compact_management_config(
            {
                "username": original_payload.get("username") if isinstance(original_payload, dict) else None,
                "password": original_payload.get("password") if isinstance(original_payload, dict) else None,
                "created": True,
                "created_at": action.completed_at.isoformat() if action.completed_at else None,
                "source": "create-user-action",
            }
        )
        server.management_config_json = compact_management_config(current)

    if action.action_type == "hpe_install_ilo_license" and payload.status == "succeeded":
        current = merged_management_config(server)
        result = payload.result or {}
        license_result = {
            "installed": True,
            "installed_at": action.completed_at.isoformat() if action.completed_at else None,
            "source": "install-license-action",
        }
        if isinstance(result, dict):
            for key in ("backend", "endpoint", "license_service", "action"):
                if result.get(key) is not None:
                    license_result[key] = result[key]
        current["license"] = compact_management_config(license_result)
        server.management_config_json = compact_management_config(current)

    db.commit()
    return {"status": "stored"}
