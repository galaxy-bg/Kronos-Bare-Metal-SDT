from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session, selectinload

from app.db.session import get_db
from app.models.server import Server
from app.schemas.server import DashboardStats, ServerDetail, ServerRead

router = APIRouter()
OFFLINE_AFTER = timedelta(minutes=5)


def refresh_server_statuses(db: Session) -> None:
    cutoff = datetime.now(UTC) - OFFLINE_AFTER
    servers = db.scalars(select(Server).where(Server.last_seen < cutoff, Server.status == "online")).all()
    for server in servers:
        server.status = "offline"
    if servers:
        db.commit()


@router.get("", response_model=list[ServerRead])
def list_servers(db: Session = Depends(get_db)) -> list[Server]:
    refresh_server_statuses(db)
    return list(db.scalars(select(Server).order_by(desc(Server.last_seen))).all())


@router.get("/stats", response_model=DashboardStats)
def dashboard_stats(db: Session = Depends(get_db)) -> DashboardStats:
    refresh_server_statuses(db)
    total = db.scalar(select(func.count(Server.id))) or 0
    online = db.scalar(select(func.count(Server.id)).where(Server.status == "online")) or 0
    offline = db.scalar(select(func.count(Server.id)).where(Server.status == "offline")) or 0
    return DashboardStats(total_servers=total, online_servers=online, offline_servers=offline)


@router.get("/{server_id}", response_model=ServerDetail)
def get_server(server_id: int, db: Session = Depends(get_db)) -> Server:
    refresh_server_statuses(db)
    server = db.scalar(
        select(Server)
        .where(Server.id == server_id)
        .options(selectinload(Server.inventories))
    )
    if server is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found")
    return server
