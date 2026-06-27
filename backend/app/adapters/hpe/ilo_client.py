from __future__ import annotations

import ssl
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
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
        license_result: dict[str, Any] | None = None
        health_result: dict[str, Any] | None = None
        try:
            license_result = self.get_ilo_license()
        except RedfishError:
            license_result = None
        try:
            health_result = self.get_health_summary()
        except RedfishError:
            health_result = None
        return {
            "vendor": self.vendor,
            "source": "hpe-redfish",
            "system_path": system_path,
            "system": system,
            "license": license_result,
            "health": health_result,
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

    def get_ilo_license(self) -> dict[str, Any]:
        if not self.context.bmc_ip:
            raise RedfishError("BMC/iLO IP is not configured.")
        errors: list[str] = []
        for scheme in ("https", "http"):
            url = f"{scheme}://{self.context.bmc_ip}/xmldata?item=CpqKey"
            request = urllib.request.Request(url, headers={"Accept": "application/xml,text/xml,*/*"})
            try:
                with urllib.request.urlopen(request, timeout=10, context=ssl._create_unverified_context()) as response:
                    body = response.read().decode("utf-8", errors="replace")
            except urllib.error.HTTPError as exc:
                errors.append(f"{url}: HTTP {exc.code}")
                continue
            except urllib.error.URLError as exc:
                errors.append(f"{url}: {exc.reason}")
                continue
            return self._license_from_xml(body, url)

        raise RedfishError("; ".join(errors) or f"Could not read CpqKey XML from {self.context.bmc_ip}")

    def _license_from_xml(self, body: str, endpoint: str) -> dict[str, Any]:
        values: dict[str, str] = {}
        try:
            root = ET.fromstring(body)
        except ET.ParseError as exc:
            raise RedfishError(f"Invalid CpqKey XML from {endpoint}") from exc
        for element in root.iter():
            tag = element.tag.split("}", 1)[-1].lower()
            text = str(element.text or "").strip()
            if text:
                values[tag] = text

        name = values.get("lname", "")
        tier = values.get("ltier", "")
        edition = "Unknown"
        normalized = f"{name} {tier}".lower()
        if "advanced" in normalized or tier.lower() == "adv":
            edition = "Advanced"
        elif "essentials" in normalized or tier.lower() == "ess":
            edition = "Essentials"
        elif name or tier:
            edition = "Standard"

        return {
            "edition": edition,
            "installed": edition in {"Advanced", "Essentials"},
            "detected_by": "xmldata-cpqkey",
            "endpoint": endpoint,
            "license_key": values.get("key"),
            "license_name": values.get("lname"),
            "license_tier": values.get("ltier"),
            "license_state": values.get("lstate"),
            "serial_number": values.get("sbsn"),
        }

    def get_health_summary(self) -> dict[str, Any]:
        manager_path = self._first_member_path("/redfish/v1/Managers/", "/redfish/v1/Managers/1/")
        system_path = self._first_member_path("/redfish/v1/Systems/", "/redfish/v1/Systems/1/")
        manager = self._get(manager_path)
        system = self._get(system_path)
        chassis_values: list[str | None] = []
        try:
            chassis = self._get("/redfish/v1/Chassis/")
            for member in chassis.get("Members", []):
                if isinstance(member, dict) and member.get("@odata.id"):
                    chassis_values.append(self._health_value(self._get(str(member["@odata.id"]))))
        except RedfishError:
            pass

        manager_health = self._normalize_health(self._health_value(manager))
        system_health = self._normalize_health(self._health_value(system))
        chassis_health = self._worst_health(chassis_values) if chassis_values else None
        overall = self._worst_health([manager_health, system_health, chassis_health])
        return {
            "overall": overall,
            "manager": manager_health,
            "system": system_health,
            "chassis": chassis_health,
            "power_state": system.get("PowerState"),
            "detected_by": "redfish-status",
            "endpoint": self.base_url,
        }

    def _first_member_path(self, collection_path: str, fallback: str) -> str:
        collection = self._get(collection_path)
        for member in collection.get("Members", []):
            if isinstance(member, dict) and member.get("@odata.id"):
                return str(member["@odata.id"])
        return fallback

    def _health_value(self, payload: dict[str, Any]) -> str | None:
        status = payload.get("Status")
        if isinstance(status, dict):
            value = status.get("HealthRollup") or status.get("Health")
            return str(value) if value else None
        return None

    def _normalize_health(self, value: str | None) -> str | None:
        normalized = (value or "").strip().lower()
        if not normalized:
            return None
        if normalized in {"ok", "healthy"}:
            return "healthy"
        if normalized in {"warning", "degraded"}:
            return "degraded"
        if normalized in {"critical", "failed"}:
            return "critical"
        return normalized

    def _worst_health(self, values: list[str | None]) -> str:
        rank = {"unknown": 0, "healthy": 1, "degraded": 2, "critical": 3}
        current = "unknown"
        for value in values:
            normalized = self._normalize_health(value)
            if normalized and rank.get(normalized, 0) > rank.get(current, 0):
                current = normalized
        return current

    def power_on(self) -> dict[str, Any]:
        # TODO: job queue integration.
        return {"vendor": self.vendor, "implemented": False, "message": "Power actions will be queued in Phase-2."}

    def power_off(self) -> dict[str, Any]:
        # TODO: job queue integration.
        return {"vendor": self.vendor, "implemented": False, "message": "Power actions will be queued in Phase-2."}

    def reboot(self) -> dict[str, Any]:
        # TODO: OS deployment.
        return {"vendor": self.vendor, "implemented": False, "message": "Reboot actions will be queued in Phase-2."}
