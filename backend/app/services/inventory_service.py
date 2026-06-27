from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.inventory import Inventory
from app.models.server import Server
from app.repositories.inventory_repository import InventoryRepository
from app.services.adapter_service import AdapterService
from app.utils.redfish import RedfishError


class InventoryService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.adapter_service = AdapterService()

    def refresh_from_bmc(self, server: Server) -> Inventory:
        adapter = self.adapter_service.build_for_server(server)
        if not server.bmc_ip:
            inventory_json = self.adapter_service.mocked_inventory_refresh(server, "BMC IP is not configured.")
        elif not adapter.context.credential:
            inventory_json = self.adapter_service.mocked_inventory_refresh(server, "BMC credential is not configured.")
        else:
            try:
                inventory_json = adapter.get_system_inventory()
            except RedfishError as exc:
                inventory_json = self.adapter_service.mocked_inventory_refresh(server, f"Redfish refresh failed: {exc}")
        inventory = InventoryRepository(self.db).create(server.id, inventory_json)
        self.db.commit()
        self.db.refresh(inventory)
        return inventory
