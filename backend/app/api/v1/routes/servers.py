import base64
from copy import deepcopy
from datetime import UTC, datetime, timedelta
import hashlib
import hmac
import json
import os
import secrets
import subprocess
from shutil import which
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import desc, func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.db.session import get_db
from app.models.server_action import ServerAction
from app.models.server import Server
from app.schemas.action import (
    IloEnrollmentCreateResponse,
    IloEnrollmentRead,
    IloEnrollmentSubmit,
    IloLicenseActionRequest,
    IloNetworkActionRequest,
    IloUserActionRequest,
    RaidPlanRequest,
    ServerActionRead,
)
from app.schemas.server import BulkDeleteRequest, BulkDeleteResponse, DashboardStats, ServerDetail, ServerRead, ServerUpdate
from app.services.adapter_service import AdapterService
from app.services.inventory_service import InventoryService
from app.utils.redfish import RedfishError
from app.utils.dmi import normalize_vendor

router = APIRouter()
OFFLINE_AFTER = timedelta(minutes=5)
DEFAULT_COMPLETED_ACTION_VISIBLE_MINUTES = 10
ENROLLMENT_TOKEN_TTL = timedelta(minutes=15)
ENROLLMENT_SECRET = os.environ.get("KDX_ENROLLMENT_SECRET") or secrets.token_urlsafe(32)
DEFAULT_MANAGED_ILO_USER = os.environ.get("KDX_DEFAULT_ILO_USER", "hpadmin")
DEFAULT_MANAGED_ILO_PASSWORD = os.environ.get("KDX_DEFAULT_ILO_PASSWORD", "HP1nv3nt")
REDFISH_INVENTORY_KEYS = ("storage_redfish", "raid", "firmware_inventory", "device_inventory")


def b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def b64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def sign_payload(payload: bytes) -> str:
    return b64url_encode(hmac.new(ENROLLMENT_SECRET.encode("utf-8"), payload, hashlib.sha256).digest())


def create_enrollment_token(server: Server, expires_at: datetime) -> str:
    payload = {
        "server_id": server.id,
        "serial_number": server.serial_number,
        "expires_at": expires_at.isoformat(),
        "nonce": secrets.token_urlsafe(12),
    }
    encoded_payload = b64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signature = sign_payload(encoded_payload.encode("ascii"))
    return f"{encoded_payload}.{signature}"


def read_enrollment_token(token: str) -> dict[str, Any]:
    try:
        encoded_payload, signature = token.split(".", 1)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid enrollment token") from exc

    expected = sign_payload(encoded_payload.encode("ascii"))
    if not hmac.compare_digest(signature, expected):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid enrollment token")

    try:
        payload = json.loads(b64url_decode(encoded_payload).decode("utf-8"))
        expires_at = datetime.fromisoformat(str(payload["expires_at"]))
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid enrollment token") from exc

    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    if expires_at < datetime.now(UTC):
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Enrollment token expired")

    payload["expires_at"] = expires_at
    return payload


def enrollment_url(request: Request, token: str) -> str:
    origin = request.headers.get("origin")
    if origin:
        base = origin.rstrip("/")
    else:
        forwarded_proto = request.headers.get("x-forwarded-proto", request.url.scheme)
        host = request.headers.get("host", str(request.url.netloc))
        base = f"{forwarded_proto}://{host}".rstrip("/")
    return f"{base}/enroll/ilo/{token}"


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


def enriched_inventory_json(server: Server, inventory_json: dict[str, Any] | None) -> dict[str, Any] | None:
    if inventory_json is None:
        return None

    enriched = deepcopy(inventory_json)
    bmc = enriched.get("bmc")
    if not isinstance(bmc, dict):
        bmc = {}
        enriched["bmc"] = bmc

    config = server.management_config_json or {}
    if server.bmc_ip:
        if not bmc.get("ip"):
            bmc["detected_by"] = "control-plane-merged"
        bmc["ip"] = server.bmc_ip
    for key in ("subnet", "gateway", "dns", "vlan", "redfish_endpoint", "redfish_ethernet_interface"):
        if config.get(key) is not None:
            bmc[key] = config[key]
    if config.get("dns_name"):
        bmc["dns_name"] = config["dns_name"]

    return enriched


def latest_inventory_json(server: Server) -> dict[str, Any] | None:
    if not server.inventories:
        return None

    merged = deepcopy(server.inventories[0].inventory_json or {})
    for inventory in server.inventories:
        snapshot = inventory.inventory_json or {}
        for key in REDFISH_INVENTORY_KEYS:
            if key not in merged and snapshot.get(key) is not None:
                merged[key] = deepcopy(snapshot[key])
        if all(key in merged for key in REDFISH_INVENTORY_KEYS):
            break

    return enriched_inventory_json(server, merged)


def nested_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def raid_drive_path(drive: dict[str, Any]) -> str | None:
    path = drive.get("path")
    if isinstance(path, str) and path:
        return path
    resource = nested_dict(drive.get("resource"))
    odata_id = resource.get("@odata.id")
    return str(odata_id) if odata_id else None


def raid_drive_label(drive: dict[str, Any]) -> str:
    resource = nested_dict(drive.get("resource"))
    location = nested_dict(nested_dict(resource.get("PhysicalLocation")).get("PartLocation"))
    return (
        str(location.get("ServiceLabel") or "")
        or str(resource.get("Name") or resource.get("Model") or resource.get("Id") or "")
        or str(raid_drive_path(drive) or "Drive")
    )


def raid_drive_summary(drive: dict[str, Any]) -> dict[str, Any]:
    resource = nested_dict(drive.get("resource"))
    status_payload = nested_dict(resource.get("Status"))
    links = nested_dict(resource.get("Links"))
    volumes = links.get("Volumes")
    volume_count = resource.get("Volumes@odata.count")
    if not isinstance(volume_count, int):
        volume_count = len(volumes) if isinstance(volumes, list) else 0
    return {
        "path": raid_drive_path(drive),
        "label": raid_drive_label(drive),
        "name": resource.get("Name"),
        "model": resource.get("Model"),
        "serial_number": resource.get("SerialNumber"),
        "capacity_bytes": resource.get("CapacityBytes"),
        "media_type": resource.get("MediaType"),
        "protocol": resource.get("Protocol"),
        "state": status_payload.get("State"),
        "health": status_payload.get("Health"),
        "volume_count": volume_count,
        "location": raid_drive_label(drive),
    }


def raid_plan_requirement(raid_level: str) -> tuple[int, int | None]:
    if raid_level == "RAID1":
        return 2, 2
    if raid_level == "RAID5":
        return 3, None
    if raid_level == "RAID6":
        return 4, None
    if raid_level == "RAID10":
        return 4, None
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Supported preview levels are RAID1, RAID5, RAID6 and RAID10.")


def build_raid_plan(server: Server, payload: RaidPlanRequest, raid_config: dict[str, Any]) -> dict[str, Any]:
    raid_summary = nested_dict(raid_config.get("raid"))
    drive_items = raid_summary.get("drives")
    drives = [item for item in drive_items if isinstance(item, dict)] if isinstance(drive_items, list) else []
    drive_by_path = {path: drive for drive in drives if (path := raid_drive_path(drive))}
    raid_level = payload.raid_level.upper()
    minimum_drives, exact_drives = raid_plan_requirement(raid_level)
    selected = [drive_by_path[path] for path in payload.selected_drive_paths if path in drive_by_path]
    missing_paths = [path for path in payload.selected_drive_paths if path not in drive_by_path]
    selected_summaries = [raid_drive_summary(drive) for drive in selected]

    checks: list[dict[str, Any]] = []

    def add_check(name: str, passed: bool, message: str) -> None:
        checks.append({"name": name, "passed": passed, "message": message})

    selected_count = len(selected)
    count_ok = selected_count >= minimum_drives and (exact_drives is None or selected_count == exact_drives)
    expected_count = f"exactly {exact_drives}" if exact_drives is not None else f"at least {minimum_drives}"
    add_check(
        "drive-count",
        count_ok,
        f"{raid_level} requires {expected_count} selected drive{'s' if (exact_drives or minimum_drives) != 1 else ''}.",
    )
    add_check("drive-exists", not missing_paths, "All selected drives must be visible in the current Redfish RAID inventory.")

    absent = [drive for drive in selected_summaries if str(drive.get("state") or "").lower() == "absent"]
    add_check("drive-present", not absent, "Selected drives must be present; empty bays cannot be used.")

    unhealthy = [
        drive
        for drive in selected_summaries
        if str(drive.get("health") or "").lower() not in {"ok", "healthy"}
    ]
    add_check("drive-health", not unhealthy, "Selected drives must report healthy/OK status.")

    assigned = [drive for drive in selected_summaries if int(drive.get("volume_count") or 0) > 0]
    add_check("drive-unassigned", not assigned, "Selected drives must not already belong to a Redfish volume.")

    if raid_level == "RAID10":
        add_check("raid10-even-count", selected_count % 2 == 0, "RAID10 requires an even number of selected drives.")

    eligible = all(check["passed"] for check in checks)
    return {
        "server_id": server.id,
        "serial_number": server.serial_number,
        "raid_level": raid_level,
        "purpose": payload.purpose,
        "volume_name": payload.volume_name,
        "bootable": payload.bootable,
        "selected_drive_paths": payload.selected_drive_paths,
        "selected_drives": selected_summaries,
        "missing_drive_paths": missing_paths,
        "checks": checks,
        "eligible": eligible,
        "apply_supported": False,
        "destructive": True,
        "message": "Preview only. No RAID changes were applied. Next step will require explicit destructive confirmation.",
        "raid": raid_summary,
    }


def conflict_index(servers: list[Server]) -> dict[int, dict[str, list[dict[str, str]]]]:
    conflicts: dict[int, dict[str, list[dict[str, str]]]] = {server.id: {} for server in servers}

    for field_name in ("agent_ip", "bmc_ip"):
        seen: dict[str, list[Server]] = {}
        for server in servers:
            if server.status == "deregistered":
                continue
            value = getattr(server, field_name)
            if not value:
                continue
            seen.setdefault(str(value), []).append(server)

        for value, matches in seen.items():
            if len(matches) < 2:
                continue
            for server in matches:
                conflicts[server.id][field_name] = [
                    {"serial_number": match.serial_number, "hostname": match.hostname or "", "value": value}
                    for match in matches
                    if match.id != server.id
                ]

    return conflicts


def readiness_for_server(server: Server, conflicts: dict[str, Any]) -> tuple[str, list[str]]:
    if server.status == "deregistered":
        return "deregistered", ["Server is deregistered."]

    reasons: list[str] = []
    if conflicts:
        reasons.append("Duplicate agent or BMC IP detected.")

    config = server.management_config_json or {}
    credential = config.get("credential")
    managed_user = config.get("managed_user")
    credential_ready = isinstance(credential, dict) and bool(credential.get("username") and credential.get("password") and credential.get("verified"))
    managed_ready = isinstance(managed_user, dict) and bool(managed_user.get("username") and managed_user.get("password") and managed_user.get("created"))

    if not server.bmc_ip:
        reasons.append("BMC/iLO IP is not known yet.")
    if not credential_ready and not managed_ready:
        reasons.append("Validated iLO credential is missing.")

    if conflicts:
        return "conflict", reasons
    if server.bmc_ip and managed_ready:
        return "ready", reasons or ["Ready for protected iLO actions."]
    if server.bmc_ip and credential_ready:
        return "credential_validated", reasons or ["iLO credential is validated; managed user can be created."]
    if server.bmc_ip:
        return "needs_credential", reasons
    return "registered", reasons


def server_to_read(server: Server, conflicts: dict[str, Any] | None = None) -> dict[str, Any]:
    latest_inventory = latest_inventory_json(server)
    conflict_data = conflicts or {}
    readiness_status, readiness_reasons = readiness_for_server(server, conflict_data)
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
        "latest_inventory_json": latest_inventory,
        "registration_status": "deregistered" if server.status == "deregistered" else "registered",
        "readiness_status": readiness_status,
        "readiness_reasons": readiness_reasons,
        "conflicts": conflict_data,
        "agent_reachable": ping_ip(server.agent_ip),
        "bmc_reachable": ping_ip(server.bmc_ip),
        "status": server.status,
        "last_seen": server.last_seen,
        "created_at": server.created_at,
        "updated_at": server.updated_at,
    }


def server_to_detail(server: Server, conflicts: dict[str, Any] | None = None) -> dict[str, Any]:
    data = server_to_read(server, conflicts)
    inventories = []
    for index, inventory in enumerate(server.inventories):
        inventory_json = inventory.inventory_json
        if index == 0:
            inventory_json = enriched_inventory_json(server, inventory_json) or {}
        inventories.append({"id": inventory.id, "inventory_json": inventory_json, "created_at": inventory.created_at})
    data["inventories"] = inventories
    return data


def refresh_server_statuses(db: Session) -> None:
    cutoff = datetime.now(UTC) - OFFLINE_AFTER
    servers = db.scalars(select(Server).where(Server.last_seen < cutoff, Server.status == "online")).all()
    for server in servers:
        server.status = "offline"
    if servers:
        db.commit()


def preferred_ilo_auth(server: Server, admin_username: str | None, admin_password: str | None) -> tuple[str | None, str | None]:
    config = server.management_config_json or {}
    managed_user = config.get("managed_user")
    credential = config.get("credential")
    auth_username = admin_username
    auth_password = admin_password

    if isinstance(managed_user, dict) and managed_user.get("username") and managed_user.get("password"):
        auth_username = auth_username or managed_user.get("username")
        auth_password = auth_password or managed_user.get("password")

    if isinstance(credential, dict):
        auth_username = auth_username or credential.get("username")
        auth_password = auth_password or credential.get("password")

    return auth_username, auth_password


def has_managed_ilo_user(server: Server) -> bool:
    managed_user = (server.management_config_json or {}).get("managed_user")
    return isinstance(managed_user, dict) and bool(
        managed_user.get("username") and managed_user.get("password") and managed_user.get("created")
    )


def require_ilo_auth(auth_username: str | None, auth_password: str | None) -> tuple[str, str]:
    if not auth_username or not auth_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Validated iLO credentials or an iLO admin username/password are required.",
        )
    return auth_username, auth_password


@router.get("", response_model=list[ServerRead])
def list_servers(db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    refresh_server_statuses(db)
    servers = db.scalars(select(Server).options(selectinload(Server.inventories)).order_by(Server.serial_number)).all()
    conflicts = conflict_index(servers)
    return [server_to_read(server, conflicts.get(server.id, {})) for server in servers]


@router.get("/stats", response_model=DashboardStats)
def dashboard_stats(db: Session = Depends(get_db)) -> DashboardStats:
    refresh_server_statuses(db)
    total = db.scalar(select(func.count(Server.id)).where(Server.status != "deregistered")) or 0
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
def recent_server_actions(
    limit: int = 50,
    completed_visible_minutes: int = DEFAULT_COMPLETED_ACTION_VISIBLE_MINUTES,
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    bounded_limit = min(max(limit, 1), 200)
    visible_for = timedelta(minutes=min(max(completed_visible_minutes, 1), 1440))
    completed_cutoff = datetime.now(UTC) - visible_for
    actions = db.scalars(
        select(ServerAction)
        .where(
            or_(
                ServerAction.status.in_(("pending", "running")),
                ServerAction.completed_at >= completed_cutoff,
            )
        )
        .order_by(desc(ServerAction.requested_at))
        .limit(bounded_limit)
    ).all()
    return [action_to_read(action) for action in actions]


@router.post("/{server_id}/ilo-enrollment", response_model=IloEnrollmentCreateResponse)
def create_ilo_enrollment(server_id: int, request: Request, db: Session = Depends(get_db)) -> IloEnrollmentCreateResponse:
    server = db.get(Server, server_id)
    if server is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found")

    expires_at = datetime.now(UTC) + ENROLLMENT_TOKEN_TTL
    token = create_enrollment_token(server, expires_at)
    return IloEnrollmentCreateResponse(token=token, url=enrollment_url(request, token), expires_at=expires_at)


@router.get("/ilo-enrollment/{token}", response_model=IloEnrollmentRead)
def get_ilo_enrollment(token: str, db: Session = Depends(get_db)) -> IloEnrollmentRead:
    payload = read_enrollment_token(token)
    server = db.get(Server, int(payload["server_id"]))
    if server is None or server.serial_number != payload.get("serial_number"):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found")

    return IloEnrollmentRead(
        server_id=server.id,
        serial_number=server.serial_number,
        hostname=server.hostname,
        vendor=server.vendor,
        model=server.model,
        expires_at=payload["expires_at"],
    )


@router.post("/ilo-enrollment/{token}/submit", response_model=ServerActionRead, status_code=status.HTTP_201_CREATED)
def submit_ilo_enrollment(token: str, payload: IloEnrollmentSubmit, db: Session = Depends(get_db)) -> dict[str, Any]:
    token_payload = read_enrollment_token(token)
    server = db.get(Server, int(token_payload["server_id"]))
    if server is None or server.serial_number != token_payload.get("serial_number"):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found")

    existing_managed_user = (server.management_config_json or {}).get("managed_user")
    has_managed_user = isinstance(existing_managed_user, dict) and bool(
        existing_managed_user.get("username") and existing_managed_user.get("password")
    )

    if payload.create_managed_user and payload.username != DEFAULT_MANAGED_ILO_USER and not has_managed_user:
        action = ServerAction(
            server_id=server.id,
            action_type="hpe_create_ilo_user",
            payload_json={
                "username": DEFAULT_MANAGED_ILO_USER,
                "password": DEFAULT_MANAGED_ILO_PASSWORD,
                "bmc_ip": server.bmc_ip,
                "dns_name": payload.dns_name,
                "source": "ilo-tag-scan",
                "auth": {"username": payload.username, "password": payload.password},
            },
        )
    else:
        should_create_managed_user = payload.create_managed_user and not has_managed_user
        action = ServerAction(
            server_id=server.id,
            action_type="hpe_verify_ilo_credential",
            payload_json={
                "auth": {"username": payload.username, "password": payload.password},
                "dns_name": payload.dns_name,
                "source": "ilo-tag-scan",
                "create_managed_user": should_create_managed_user,
            },
        )
    db.add(action)
    db.commit()
    db.refresh(action)
    return action_to_read(action)


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
    all_servers = db.scalars(select(Server)).all()
    conflicts = conflict_index(all_servers)
    return server_to_detail(server, conflicts.get(server.id, {}))


@router.patch("/{server_id}", response_model=ServerRead)
def update_server(server_id: int, payload: ServerUpdate, db: Session = Depends(get_db)) -> dict[str, Any]:
    server = db.get(Server, server_id)
    if server is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        if field == "vendor":
            setattr(server, field, normalize_vendor(value))
        else:
            setattr(server, field, value)

    db.commit()
    db.refresh(server)
    return server_to_read(server)


@router.get("/{server_id}/inventory/refresh")
def refresh_server_inventory(server_id: int, db: Session = Depends(get_db)) -> dict[str, Any]:
    server = db.get(Server, server_id)
    if server is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found")

    inventory = InventoryService(db).refresh_from_bmc(server)
    return {
        "status": "stored",
        "inventory_id": inventory.id,
        "inventory": inventory.inventory_json,
    }


@router.get("/{server_id}/raid/plan")
def plan_server_raid(server_id: int, raid_level: str = "RAID1", db: Session = Depends(get_db)) -> dict[str, Any]:
    server = db.get(Server, server_id)
    if server is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found")

    adapter = AdapterService().build_for_server(server)
    if not server.bmc_ip:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="BMC/iLO IP is not configured.")
    if not adapter.context.credential:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Validated iLO credential is required.")

    normalized_raid_level = raid_level.upper()
    if normalized_raid_level not in {"RAID1", "RAID5"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Supported preview levels are RAID1 and RAID5.")

    try:
        raid_config = adapter.get_raid_config()
    except RedfishError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Redfish RAID read failed: {exc}") from exc

    raid_summary = raid_config.get("raid") if isinstance(raid_config, dict) else {}
    recommendations = raid_summary.get("recommendations") if isinstance(raid_summary, dict) else []
    matching = [
        recommendation
        for recommendation in recommendations
        if isinstance(recommendation, dict) and recommendation.get("raid_level") == normalized_raid_level
    ]
    return {
        "server_id": server.id,
        "serial_number": server.serial_number,
        "raid_level": normalized_raid_level,
        "apply_supported": False,
        "destructive": True,
        "message": "Preview only. RAID apply will be added as a queued job with explicit destructive confirmation.",
        "eligible": bool(matching and matching[0].get("eligible")),
        "recommendation": matching[0] if matching else None,
        "raid": raid_summary,
    }


@router.post("/{server_id}/raid/plan")
def plan_selected_server_raid(server_id: int, payload: RaidPlanRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    server = db.get(Server, server_id)
    if server is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found")

    adapter = AdapterService().build_for_server(server)
    if not server.bmc_ip:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="BMC/iLO IP is not configured.")
    if not adapter.context.credential:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Validated iLO credential is required.")

    try:
        raid_config = adapter.get_raid_config()
    except RedfishError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Redfish RAID read failed: {exc}") from exc

    return build_raid_plan(server, payload, raid_config)


@router.post("/{server_id}/deregister", response_model=ServerRead)
def deregister_server(server_id: int, db: Session = Depends(get_db)) -> dict[str, Any]:
    server = db.get(Server, server_id)
    if server is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found")

    server.status = "deregistered"
    db.commit()
    db.refresh(server)
    all_servers = db.scalars(select(Server).options(selectinload(Server.inventories))).all()
    conflicts = conflict_index(all_servers)
    return server_to_read(server, conflicts.get(server.id, {}))


def mask_secret_fields(value: Any) -> Any:
    if isinstance(value, dict):
        masked: dict[str, Any] = {}
        for key, item in value.items():
            if "password" in key.lower() or "license_key" in key.lower():
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
        "result_json": mask_secret_fields(action.result_json),
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
    if payload.username == DEFAULT_MANAGED_ILO_USER and has_managed_ilo_user(server):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"{DEFAULT_MANAGED_ILO_USER} is already managed for this server.")

    auth_username, auth_password = preferred_ilo_auth(server, payload.admin_username, payload.admin_password)
    auth_username, auth_password = require_ilo_auth(auth_username, auth_password)

    action = ServerAction(
        server_id=server.id,
        action_type="hpe_create_ilo_user",
        payload_json={
            "username": payload.username,
            "password": payload.password,
            "bmc_ip": server.bmc_ip,
            "auth": {
                "username": auth_username,
                "password": auth_password,
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

    auth_username, auth_password = preferred_ilo_auth(server, payload.admin_username, payload.admin_password)
    auth_username, auth_password = require_ilo_auth(auth_username, auth_password)

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
                "username": auth_username,
                "password": auth_password,
            },
        },
    )
    server.bmc_ip = payload.ip
    current = dict(server.management_config_json or {})
    current.update(management_config)
    server.management_config_json = current

    db.add(action)
    db.commit()
    db.refresh(action)
    return action_to_read(action)


@router.post("/{server_id}/actions/hpe-install-ilo-license", response_model=ServerActionRead, status_code=status.HTTP_201_CREATED)
def install_ilo_license_action(server_id: int, payload: IloLicenseActionRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    server = db.get(Server, server_id)
    if server is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found")

    auth_username, auth_password = preferred_ilo_auth(server, payload.admin_username, payload.admin_password)
    auth_username, auth_password = require_ilo_auth(auth_username, auth_password)

    action = ServerAction(
        server_id=server.id,
        action_type="hpe_install_ilo_license",
        payload_json={
            "license_key": payload.license_key,
            "bmc_ip": server.bmc_ip,
            "auth": {
                "username": auth_username,
                "password": auth_password,
            },
        },
    )
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
