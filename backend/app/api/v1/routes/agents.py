from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.inventory import Inventory
from app.models.server import Server
from app.schemas.agent import AgentHeartbeat, AgentRegistration, InventoryUpload
from app.schemas.server import ServerRead

router = APIRouter()


def default_hostname(serial_number: str) -> str:
    return f"iLO-{serial_number}"


def update_if_known(server: Server, field_name: str, value: str | None) -> None:
    if value is not None:
        setattr(server, field_name, value)


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

    inventory = Inventory(server_id=server.id, inventory_json=payload.inventory)
    server.status = "online"
    server.last_seen = datetime.now(UTC)

    db.add(inventory)
    db.commit()
    db.refresh(inventory)
    return {"status": "stored", "inventory_id": inventory.id}
