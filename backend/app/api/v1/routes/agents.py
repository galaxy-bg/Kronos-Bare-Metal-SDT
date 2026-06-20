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
            hostname=payload.hostname,
            agent_ip=payload.agent_ip,
            bmc_ip=payload.bmc_ip,
            status="online",
            last_seen=now,
        )
        db.add(server)
    else:
        server.vendor = payload.vendor
        server.model = payload.model
        server.product_name = payload.product_name
        server.hostname = payload.hostname
        server.agent_ip = payload.agent_ip
        server.bmc_ip = payload.bmc_ip
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
