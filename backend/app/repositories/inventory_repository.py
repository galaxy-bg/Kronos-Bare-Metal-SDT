from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.inventory import Inventory


class InventoryRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def create(self, server_id: int, inventory_json: dict) -> Inventory:
        inventory = Inventory(server_id=server_id, inventory_json=inventory_json)
        self.db.add(inventory)
        return inventory
