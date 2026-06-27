from __future__ import annotations

from sqlalchemy.orm import Session, selectinload

from app.models.server import Server


class ServerRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get(self, server_id: int) -> Server | None:
        return self.db.get(Server, server_id)

    def get_with_inventory(self, server_id: int) -> Server | None:
        return self.db.get(Server, server_id, options=[selectinload(Server.inventories)])
