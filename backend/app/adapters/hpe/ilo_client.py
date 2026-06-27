from __future__ import annotations

from typing import Any

from app.adapters.base import AdapterContext, BaseVendorAdapter
from app.utils.redfish import RedfishError, redfish_get_json, redfish_patch_json


class HpeIloAdapter(BaseVendorAdapter):
    vendor = "hpe"

    def __init__(self, context: AdapterContext) -> None:
        super().__init__(context)
        self.base_url = f"https://{context.bmc_ip}" if context.bmc_ip else None

    def _require_connection(self) -> tuple[str, str, str]:
        if not self.base_url:
            raise RedfishError("BMC/iLO IP is not configured.")
        if not self.context.credential:
            raise RedfishError("BMC credential is not configured.")
        return self.base_url, self.context.credential.username, self.context.credential.password

    def _get(self, path: str) -> dict[str, Any]:
        base_url, username, password = self._require_connection()
        return redfish_get_json(base_url, path, username, password)

    def _patch(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        base_url, username, password = self._require_connection()
        return redfish_patch_json(base_url, path, username, password, payload)

    def detect(self) -> dict[str, Any]:
        root = self._get("/redfish/v1/")
        managers = self._get("/redfish/v1/Managers/")
        return {"vendor": self.vendor, "root": root, "managers": managers}

    def get_system_inventory(self) -> dict[str, Any]:
        systems = self._get("/redfish/v1/Systems/")
        members = systems.get("Members") or []
        system_path = "/redfish/v1/Systems/1/"
        if members and isinstance(members[0], dict) and members[0].get("@odata.id"):
            system_path = str(members[0]["@odata.id"])
        system = self._get(system_path)
        return {
            "vendor": self.vendor,
            "source": "hpe-redfish",
            "system_path": system_path,
            "system": system,
        }

    def get_bios_config(self) -> dict[str, Any]:
        systems = self._get("/redfish/v1/Systems/")
        members = systems.get("Members") or []
        system_path = "/redfish/v1/Systems/1/"
        if members and isinstance(members[0], dict) and members[0].get("@odata.id"):
            system_path = str(members[0]["@odata.id"])
        return {
            "vendor": self.vendor,
            "source": "hpe-redfish",
            "bios": self._get(system_path.rstrip("/") + "/Bios/"),
        }

    def set_bios_config(self, config: dict[str, Any]) -> dict[str, Any]:
        # TODO: BIOS profile apply.
        return {"vendor": self.vendor, "implemented": False, "message": "BIOS apply is planned for Phase-2."}

    def get_storage_inventory(self) -> dict[str, Any]:
        systems = self._get("/redfish/v1/Systems/")
        members = systems.get("Members") or []
        system_path = "/redfish/v1/Systems/1/"
        if members and isinstance(members[0], dict) and members[0].get("@odata.id"):
            system_path = str(members[0]["@odata.id"])
        storage_path = system_path.rstrip("/") + "/Storage/"
        return {"vendor": self.vendor, "source": "hpe-redfish", "storage": self._get(storage_path)}

    def get_raid_config(self) -> dict[str, Any]:
        return self.get_storage_inventory()

    def set_raid_config(self, config: dict[str, Any]) -> dict[str, Any]:
        # TODO: RAID profile apply.
        return {"vendor": self.vendor, "implemented": False, "message": "RAID apply is planned for Phase-2."}

    def get_firmware_inventory(self) -> dict[str, Any]:
        # TODO: firmware update.
        return {
            "vendor": self.vendor,
            "source": "hpe-redfish",
            "firmware": self._get("/redfish/v1/UpdateService/FirmwareInventory/"),
        }

    def set_uid_led(self, state: str) -> dict[str, Any]:
        normalized = state if state in {"Lit", "Blinking", "Off"} else "Off"
        systems = self._get("/redfish/v1/Systems/")
        members = systems.get("Members") or []
        system_path = "/redfish/v1/Systems/1/"
        if members and isinstance(members[0], dict) and members[0].get("@odata.id"):
            system_path = str(members[0]["@odata.id"])
        result = self._patch(system_path, {"IndicatorLED": normalized})
        return {"vendor": self.vendor, "state": normalized, "result": result}

    def power_status(self) -> dict[str, Any]:
        inventory = self.get_system_inventory()
        system = inventory.get("system") if isinstance(inventory, dict) else {}
        return {"vendor": self.vendor, "power_state": system.get("PowerState") if isinstance(system, dict) else None}

    def power_on(self) -> dict[str, Any]:
        # TODO: job queue integration.
        return {"vendor": self.vendor, "implemented": False, "message": "Power actions will be queued in Phase-2."}

    def power_off(self) -> dict[str, Any]:
        # TODO: job queue integration.
        return {"vendor": self.vendor, "implemented": False, "message": "Power actions will be queued in Phase-2."}

    def reboot(self) -> dict[str, Any]:
        # TODO: OS deployment.
        return {"vendor": self.vendor, "implemented": False, "message": "Reboot actions will be queued in Phase-2."}
