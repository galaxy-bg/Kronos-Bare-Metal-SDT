from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.inventory import Inventory
from app.models.server import Server
from app.repositories.inventory_repository import InventoryRepository
from app.services.adapter_service import AdapterService
from app.utils.redfish import RedfishError
from datetime import UTC, datetime


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
                storage_inventory = adapter.get_storage_inventory()
                inventory_json["storage_redfish"] = storage_inventory
                inventory_json["raid"] = storage_inventory.get("raid") if isinstance(storage_inventory, dict) else None
                inventory_json["bios_redfish"] = self._optional_adapter_read(adapter, "get_bios_config")
                inventory_json["firmware_inventory"] = self._optional_adapter_read(adapter, "get_firmware_inventory")
                inventory_json["device_inventory"] = self._optional_adapter_read(adapter, "get_device_inventory")
            except RedfishError as exc:
                inventory_json = self.adapter_service.mocked_inventory_refresh(server, f"Redfish refresh failed: {exc}")
        self._merge_management_state(server, inventory_json)
        inventory = InventoryRepository(self.db).create(server.id, inventory_json)
        self.db.commit()
        self.db.refresh(inventory)
        return inventory

    def _optional_adapter_read(self, adapter: object, method_name: str) -> dict:
        method = getattr(adapter, method_name, None)
        if not callable(method):
            return {"available": False, "reason": f"{method_name} is not implemented by this adapter."}
        try:
            return method()
        except RedfishError as exc:
            return {"available": False, "error": str(exc)}

    def _merge_management_state(self, server: Server, inventory_json: dict) -> None:
        current = dict(server.management_config_json or {})
        license_result = inventory_json.get("license") if isinstance(inventory_json, dict) else None
        if isinstance(license_result, dict):
            current["license"] = self._compact_license(license_result)
        health_result = inventory_json.get("health") if isinstance(inventory_json, dict) else None
        if isinstance(health_result, dict):
            current["health"] = self._compact_health(health_result)
        server.management_config_json = {key: value for key, value in current.items() if value is not None}

    def _compact_license(self, value: dict) -> dict:
        result = {
            "edition": value.get("edition") or "Unknown",
            "installed": value.get("installed"),
            "detected_by": value.get("detected_by"),
            "endpoint": value.get("endpoint"),
            "license_service": value.get("license_service"),
            "license_name": value.get("license_name"),
            "license_tier": value.get("license_tier"),
            "license_state": value.get("license_state"),
            "serial_number": value.get("serial_number"),
            "license_key": value.get("license_key"),
            "updated_at": datetime.now(UTC).isoformat(),
        }
        return {key: item for key, item in result.items() if item is not None}

    def _compact_health(self, value: dict) -> dict:
        result = {
            "overall": value.get("overall") or "unknown",
            "manager": value.get("manager"),
            "system": value.get("system"),
            "chassis": value.get("chassis"),
            "power_state": value.get("power_state"),
            "detected_by": value.get("detected_by"),
            "endpoint": value.get("endpoint"),
            "updated_at": datetime.now(UTC).isoformat(),
        }
        return {key: item for key, item in result.items() if item is not None}
