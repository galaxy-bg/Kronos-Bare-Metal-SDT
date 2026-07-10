from __future__ import annotations

import ssl
import ipaddress
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from typing import Any

from app.adapters.base import AdapterContext, BaseVendorAdapter
from app.utils.redfish import RedfishError, redfish_delete_json, redfish_get_json, redfish_patch_json, redfish_post_json


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

    def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        base_url, username, password = self._require_connection()
        return redfish_post_json(base_url, path, username, password, payload)

    def _delete(self, path: str) -> dict[str, Any]:
        base_url, username, password = self._require_connection()
        return redfish_delete_json(base_url, path, username, password)

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
        management_network: dict[str, Any] | None = None
        try:
            management_network = self.get_management_network()
        except RedfishError:
            management_network = None
        return {
            "vendor": self.vendor,
            "source": "hpe-redfish",
            "system_path": system_path,
            "system": system,
            "license": license_result,
            "health": health_result,
            "management_network": management_network,
        }

    def get_bios_config(self) -> dict[str, Any]:
        system_path = self._first_member_path("/redfish/v1/Systems/", "/redfish/v1/Systems/1/")
        bios_path = system_path.rstrip("/") + "/Bios/"
        bios = self._get(bios_path)
        registry = self._read_bios_attribute_registry(bios)
        return {
            "vendor": self.vendor,
            "source": "hpe-redfish",
            "system_path": system_path,
            "bios_path": bios_path,
            "bios": bios,
            "registry": registry,
        }

    def set_bios_config(self, config: dict[str, Any]) -> dict[str, Any]:
        current = self.get_bios_config()
        attributes = config.get("attributes") if isinstance(config.get("attributes"), dict) else config
        settings_uri = self._bios_settings_uri(current.get("bios") if isinstance(current.get("bios"), dict) else {})
        if not settings_uri:
            raise RedfishError("Writable BIOS SettingsObject was not found in Redfish BIOS resource.")
        payload = {"Attributes": attributes}
        return {
            "vendor": self.vendor,
            "implemented": True,
            "settings_uri": settings_uri,
            "payload": payload,
            "result": self._patch(settings_uri, payload),
            "message": "BIOS settings update was submitted. Reboot is required for most BIOS changes.",
        }

    def get_storage_inventory(self) -> dict[str, Any]:
        system_path = self._first_member_path("/redfish/v1/Systems/", "/redfish/v1/Systems/1/")
        storage_path = system_path.rstrip("/") + "/Storage/"
        storage_collection = self._get(storage_path)
        storage_members: list[dict[str, Any]] = []
        for member_path in self._member_paths(storage_collection):
            storage_resource = self._safe_get(member_path)
            if not storage_resource:
                continue
            storage_members.append(
                {
                    "path": member_path,
                    "resource": storage_resource,
                    "controllers": self._extract_controllers(storage_resource),
                    "drives": self._read_linked_collection(storage_resource.get("Drives")),
                    "volumes": self._read_volumes(storage_resource.get("Volumes")),
                }
            )

        smart_storage = self._read_hpe_smart_storage(system_path)
        raid = self._raid_summary(storage_members, smart_storage)
        return {
            "vendor": self.vendor,
            "source": "hpe-redfish-storage",
            "system_path": system_path,
            "storage_collection": storage_collection,
            "storage": storage_members,
            "smart_storage": smart_storage,
            "raid": raid,
        }

    def get_raid_config(self) -> dict[str, Any]:
        storage = self.get_storage_inventory()
        return {
            "vendor": self.vendor,
            "source": storage.get("source"),
            "raid": storage.get("raid"),
            "storage": storage.get("storage"),
            "smart_storage": storage.get("smart_storage"),
        }

    def set_raid_config(self, config: dict[str, Any]) -> dict[str, Any]:
        storage_inventory = self.get_storage_inventory()
        selected_drive_paths = [str(path) for path in config.get("selected_drive_paths", []) if str(path)]
        if not selected_drive_paths:
            raise RedfishError("No drive paths were provided for storage apply.")

        disk_mode = str(config.get("disk_mode") or "RAID").upper()
        raid_level = str(config.get("raid_level") or "RAID1").upper()
        volume_name = self._volume_name(str(config.get("volume_name") or "kdx-volume"))

        if disk_mode in {"NON_RAID", "NONRAID", "JBOD"} or raid_level == "NON_RAID":
            raise RedfishError("Non-RAID/JBOD apply is not supported by this HPE MR Redfish path; use RAID volume create or vendor tooling.")

        collection_path = self._volume_collection_for_drive_set(storage_inventory, selected_drive_paths)
        payload = self._volume_create_payload(volume_name, raid_level, selected_drive_paths)
        return {
            "vendor": self.vendor,
            "implemented": True,
            "disk_mode": "RAID",
            "auto_jbod_remaining": bool(config.get("auto_jbod_remaining")),
            "auto_jbod_executed": False,
            "volume_collection": collection_path,
            "payload": payload,
            "result": self._post(collection_path, payload),
            "message": (
                f"{raid_level} volume create request was submitted. "
                "Auto JBOD remaining drives is tracked as a plan policy and is not executed by this Redfish path yet."
                if config.get("auto_jbod_remaining")
                else f"{raid_level} volume create request was submitted."
            ),
        }

    def clear_raid_config(self, storage_path: str | None = None) -> dict[str, Any]:
        storage_inventory = self.get_storage_inventory()
        operations: list[dict[str, Any]] = []
        requested_path = self._normalize_odata_path(storage_path) if storage_path else None

        for storage_member in storage_inventory.get("storage", []):
            if not isinstance(storage_member, dict):
                continue
            member_path = self._normalize_odata_path(str(storage_member.get("path") or ""))
            if requested_path and member_path != requested_path:
                continue
            resource = storage_member.get("resource") if isinstance(storage_member.get("resource"), dict) else {}
            actions = resource.get("Actions") if isinstance(resource, dict) else {}
            reset = actions.get("#Storage.ResetToDefaults") if isinstance(actions, dict) else None
            target = reset.get("target") if isinstance(reset, dict) else None
            if not target:
                continue
            allowable = reset.get("ResetType@Redfish.AllowableValues") if isinstance(reset, dict) else []
            reset_type = "ResetAll" if not allowable or "ResetAll" in allowable else str(allowable[0])
            payload = {"ResetType": reset_type}
            operations.append(
                {
                    "storage_path": storage_member.get("path"),
                    "action": str(target),
                    "payload": payload,
                    "result": self._post(str(target), payload),
                }
            )

        if not operations:
            raise RedfishError("No HPE Redfish Storage.ResetToDefaults action was found for this storage controller.")
        return {
            "vendor": self.vendor,
            "implemented": True,
            "operations": operations,
            "message": "Storage config clear request was submitted.",
        }

    def delete_raid_volume(self, volume_path: str) -> dict[str, Any]:
        normalized = self._normalize_odata_path(volume_path)
        if not normalized:
            raise RedfishError("Volume path is required.")
        return {
            "vendor": self.vendor,
            "implemented": True,
            "volume_path": volume_path,
            "result": self._delete(volume_path),
            "message": "Logical drive delete request was submitted.",
        }

    def get_firmware_inventory(self) -> dict[str, Any]:
        # TODO: firmware update.
        collection_path = "/redfish/v1/UpdateService/FirmwareInventory/"
        collection = self._get(collection_path)
        return {
            "vendor": self.vendor,
            "source": "hpe-redfish-firmware",
            "collection_path": collection_path,
            "collection": collection,
            "items": self._read_collection_members(collection),
        }

    def get_device_inventory(self) -> dict[str, Any]:
        system_path = self._first_member_path("/redfish/v1/Systems/", "/redfish/v1/Systems/1/")
        chassis_collection = self._safe_get("/redfish/v1/Chassis/") or {}
        chassis: list[dict[str, Any]] = []
        devices: list[dict[str, Any]] = []

        for chassis_path in self._member_paths(chassis_collection):
            chassis_resource = self._safe_get(chassis_path)
            if not chassis_resource:
                continue
            chassis.append({"path": chassis_path, "resource": chassis_resource})
            for child_name in ("Devices", "PCIeDevices", "NetworkAdapters", "Drives"):
                for item in self._read_named_child_collection(chassis_path, child_name):
                    devices.append({"category": child_name, **item})

        for child_name in ("PCIeDevices", "NetworkInterfaces", "EthernetInterfaces"):
            for item in self._read_named_child_collection(system_path, child_name):
                devices.append({"category": child_name, **item})

        return {
            "vendor": self.vendor,
            "source": "hpe-redfish-device",
            "system_path": system_path,
            "chassis_collection": chassis_collection,
            "chassis": chassis,
            "devices": devices,
            "summary": {
                "chassis_count": len(chassis),
                "device_count": len(devices),
                "categories": sorted({str(item.get("category")) for item in devices if item.get("category")}),
            },
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

    def create_ilo_user(self, username: str, password: str) -> dict[str, Any]:
        account_path, account = self._account_for_username(username)
        if account_path:
            return {
                "vendor": self.vendor,
                "backend": "redfish",
                "endpoint": self.base_url,
                "existing": True,
                "username": username,
                "path": account_path,
                "account": account,
                "message": f"iLO user {username} already exists.",
            }

        payload = {
            "UserName": username,
            "Password": password,
            "RoleId": "Administrator",
            "Enabled": True,
        }
        result = self._post("/redfish/v1/AccountService/Accounts/", payload)
        return {
            "vendor": self.vendor,
            "backend": "redfish",
            "endpoint": self.base_url,
            "existing": False,
            "username": username,
            "payload": {"UserName": username, "RoleId": "Administrator", "Enabled": True},
            "account": result,
            "message": f"iLO user {username} was created.",
        }

    def get_management_network(self) -> dict[str, Any]:
        manager_path = self._first_member_path("/redfish/v1/Managers/", "/redfish/v1/Managers/1/")
        collection = self._get(f"{manager_path.rstrip('/')}/EthernetInterfaces/")
        skipped: list[str] = []

        for ethernet_path in self._member_paths(collection):
            ethernet = self._safe_get(ethernet_path)
            if not ethernet:
                continue
            for entry in self._ipv4_entries(ethernet):
                address = self._string_value(entry.get("Address"))
                if not self._is_management_ip_candidate(address):
                    if address:
                        skipped.append(address)
                    continue
                return {
                    "vendor": "HPE",
                    "type": "iLO",
                    "ip": address,
                    "subnet": entry.get("SubnetMask"),
                    "gateway": entry.get("Gateway"),
                    "dns": self._dns_servers(ethernet),
                    "ntp": self._ntp_servers(manager_path),
                    "vlan": self._vlan_value(ethernet),
                    "redfish_endpoint": self.base_url,
                    "redfish_ethernet_interface": ethernet_path,
                    "detected_by": "redfish",
                }

        raise RedfishError(f"No routable iLO management IPv4 address found. Skipped: {', '.join(skipped) or 'none'}")

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

    def _safe_get(self, path: str) -> dict[str, Any] | None:
        try:
            return self._get(path)
        except RedfishError:
            return None

    def _read_bios_attribute_registry(self, bios: dict[str, Any]) -> dict[str, Any]:
        registry_name = bios.get("AttributeRegistry")
        if not registry_name:
            return {"available": False, "reason": "BIOS AttributeRegistry is not advertised."}

        registry_path = f"/redfish/v1/Registries/{registry_name}/"
        registry = self._safe_get(registry_path)
        if registry:
            location_uri = self._registry_location_uri(registry)
            if location_uri:
                registry_file = self._safe_get(location_uri)
                if registry_file:
                    return registry_file
            return registry

        registries = self._safe_get("/redfish/v1/Registries/")
        if not registries:
            return {"available": False, "registry": registry_name, "reason": "Registries collection is not readable."}
        for member_path in self._member_paths(registries):
            member = self._safe_get(member_path)
            if not member:
                continue
            member_id = str(member.get("Id") or member.get("Name") or "")
            if registry_name not in member_id and member_id not in str(registry_name):
                continue
            location_uri = self._registry_location_uri(member)
            if location_uri:
                registry_file = self._safe_get(location_uri)
                if registry_file:
                    return registry_file
            return member
        return {"available": False, "registry": registry_name, "reason": "Matching BIOS registry was not found."}

    def _registry_location_uri(self, registry: dict[str, Any]) -> str | None:
        locations = registry.get("Location")
        if isinstance(locations, list):
            for location in locations:
                if isinstance(location, dict) and location.get("Uri"):
                    return str(location["Uri"])
        location = registry.get("Location")
        if isinstance(location, dict) and location.get("Uri"):
            return str(location["Uri"])
        return None

    def _bios_settings_uri(self, bios: dict[str, Any]) -> str | None:
        settings = bios.get("@Redfish.Settings")
        if isinstance(settings, dict):
            settings_object = settings.get("SettingsObject")
            if isinstance(settings_object, dict) and settings_object.get("@odata.id"):
                return str(settings_object["@odata.id"])
        if bios.get("@odata.id"):
            return str(bios["@odata.id"]).rstrip("/") + "/Settings/"
        return None

    def _member_paths(self, collection: object) -> list[str]:
        if not isinstance(collection, dict):
            return []
        paths: list[str] = []
        for member in collection.get("Members", []):
            if isinstance(member, dict) and member.get("@odata.id"):
                paths.append(str(member["@odata.id"]))
        return paths

    def _string_value(self, value: object) -> str | None:
        if value is None:
            return None
        text = str(value).strip()
        return text or None

    def _is_management_ip_candidate(self, value: str | None) -> bool:
        if not value:
            return False
        try:
            address = ipaddress.ip_address(value)
        except ValueError:
            return False
        if address.version != 4:
            return False
        if address.is_loopback or address.is_link_local or address.is_multicast or address.is_unspecified:
            return False
        if address in ipaddress.ip_network("16.1.15.0/30"):
            return False
        return True

    def _vlan_value(self, ethernet: dict[str, Any]) -> str:
        vlan = ethernet.get("VLAN") if isinstance(ethernet.get("VLAN"), dict) else {}
        if not vlan.get("VLANEnable"):
            return "0"
        vlan_id = vlan.get("VLANId")
        return str(vlan_id) if vlan_id is not None else "0"

    def _ipv4_entries(self, ethernet: dict[str, Any]) -> list[dict[str, Any]]:
        entries: list[dict[str, Any]] = []
        for key in ("IPv4Addresses", "IPv4StaticAddresses"):
            value = ethernet.get(key)
            if isinstance(value, list):
                entries.extend(entry for entry in value if isinstance(entry, dict))
        return entries

    def _dns_servers(self, ethernet: dict[str, Any]) -> str | None:
        candidates = ethernet.get("NameServers") or ethernet.get("StaticNameServers")
        if isinstance(candidates, list):
            values = [str(server) for server in candidates if self._string_value(server) and str(server) not in {"0.0.0.0", "::"}]
            if values:
                return ", ".join(values)
        return None

    def _ntp_servers(self, manager_path: str) -> str | None:
        network_protocol = self._safe_get(f"{manager_path.rstrip('/')}/NetworkProtocol/")
        if not network_protocol:
            return None
        ntp = network_protocol.get("NTP")
        if not isinstance(ntp, dict):
            return None
        candidates = ntp.get("NTPServers") or ntp.get("StaticNTPServers")
        if isinstance(candidates, list):
            values = [str(server) for server in candidates if self._string_value(server)]
            if values:
                return ", ".join(values)
        return None

    def _account_for_username(self, username: str) -> tuple[str | None, dict[str, Any] | None]:
        collection = self._get("/redfish/v1/AccountService/Accounts/")
        for account_path in self._member_paths(collection):
            account = self._safe_get(account_path)
            if not account:
                continue
            if str(account.get("UserName") or "").lower() == username.lower():
                return account_path, account
        return None, None

    def _odata_path(self, value: object) -> str | None:
        if isinstance(value, dict) and value.get("@odata.id"):
            return str(value["@odata.id"])
        return None

    def _read_linked_collection(self, value: object) -> list[dict[str, Any]]:
        results: list[dict[str, Any]] = []
        if isinstance(value, list):
            for item in value:
                path = self._odata_path(item)
                if not path:
                    continue
                resource = self._safe_get(path)
                results.append({"path": path, "resource": resource or {"error": "read failed"}})
            return results

        path = self._odata_path(value)
        if not path:
            return results
        collection = self._safe_get(path)
        if not collection:
            return [{"path": path, "resource": {"error": "read failed"}}]
        member_paths = self._member_paths(collection)
        if not member_paths:
            return [{"path": path, "resource": collection}]
        for member_path in member_paths:
            resource = self._safe_get(member_path)
            results.append({"path": member_path, "resource": resource or {"error": "read failed"}})
        return results

    def _read_volumes(self, value: object) -> list[dict[str, Any]]:
        path = self._odata_path(value)
        if not path:
            return self._read_linked_collection(value)
        collection = self._safe_get(path)
        if not collection:
            return [{"path": path, "resource": {"error": "read failed"}}]
        return self._read_collection_members(collection)

    def _extract_controllers(self, storage_resource: dict[str, Any]) -> list[dict[str, Any]]:
        controllers: list[dict[str, Any]] = []
        for key in ("StorageControllers", "Controllers"):
            value = storage_resource.get(key)
            if isinstance(value, list):
                for item in value:
                    if isinstance(item, dict):
                        controllers.append(item)
        return controllers

    def _read_hpe_smart_storage(self, system_path: str) -> dict[str, Any]:
        candidates = [
            system_path.rstrip("/") + "/SmartStorage/ArrayControllers/",
            "/redfish/v1/Systems/1/SmartStorage/ArrayControllers/",
        ]
        for collection_path in dict.fromkeys(candidates):
            collection = self._safe_get(collection_path)
            if not collection:
                continue
            controllers = []
            for controller_path in self._member_paths(collection):
                controller = self._safe_get(controller_path)
                if not controller:
                    continue
                controllers.append(
                    {
                        "path": controller_path,
                        "resource": controller,
                        "disk_drives": self._read_named_child_collection(controller_path, "DiskDrives"),
                        "logical_drives": self._read_named_child_collection(controller_path, "LogicalDrives"),
                        "storage_enclosures": self._read_named_child_collection(controller_path, "StorageEnclosures"),
                    }
                )
            return {
                "detected": True,
                "source": "hpe-smartstorage-redfish",
                "collection_path": collection_path,
                "collection": collection,
                "controllers": controllers,
            }
        return {
            "detected": False,
            "source": "hpe-smartstorage-redfish",
            "attempted_paths": candidates,
        }

    def _read_named_child_collection(self, parent_path: str, child_name: str) -> list[dict[str, Any]]:
        collection_path = parent_path.rstrip("/") + f"/{child_name}/"
        collection = self._safe_get(collection_path)
        if not collection:
            return []
        return self._read_collection_members(collection)

    def _read_collection_members(self, collection: dict[str, Any]) -> list[dict[str, Any]]:
        results: list[dict[str, Any]] = []
        for member_path in self._member_paths(collection):
            resource = self._safe_get(member_path)
            results.append({"path": member_path, "resource": resource or {"error": "read failed"}})
        return results

    def _raid_summary(self, storage_members: list[dict[str, Any]], smart_storage: dict[str, Any]) -> dict[str, Any]:
        controllers: list[dict[str, Any]] = []
        drives: list[dict[str, Any]] = []
        volumes: list[dict[str, Any]] = []

        for storage_member in storage_members:
            storage_path = str(storage_member.get("path") or "")
            for controller in storage_member.get("controllers", []):
                if isinstance(controller, dict):
                    controllers.append({"source": storage_path, **controller})
            for drive in storage_member.get("drives", []):
                if isinstance(drive, dict):
                    drives.append({"source": storage_path, **drive})
            for volume in storage_member.get("volumes", []):
                if isinstance(volume, dict):
                    volumes.append({"source": storage_path, **volume})

        if smart_storage.get("detected"):
            for controller in smart_storage.get("controllers", []):
                if not isinstance(controller, dict):
                    continue
                controller_path = str(controller.get("path") or "")
                controllers.append({"source": "hpe-smartstorage", "path": controller_path, "resource": controller.get("resource")})
                for drive in controller.get("disk_drives", []):
                    if isinstance(drive, dict):
                        drives.append({"source": controller_path, **drive})
                for logical_drive in controller.get("logical_drives", []):
                    if isinstance(logical_drive, dict):
                        volumes.append({"source": controller_path, **logical_drive})

        recommendations: list[dict[str, Any]] = []
        drive_count = len(drives)
        if drive_count >= 2:
            recommendations.append(
                {
                    "raid_level": "RAID1",
                    "minimum_drives": 2,
                    "eligible": True,
                    "destructive": True,
                    "message": "Two or more drives detected; RAID1 can be planned after operator selects target drives.",
                }
            )
        if drive_count >= 3:
            recommendations.append(
                {
                    "raid_level": "RAID5",
                    "minimum_drives": 3,
                    "eligible": True,
                    "destructive": True,
                    "message": "Three or more drives detected; RAID5 can be planned after operator selects target drives.",
                }
            )
        if not recommendations:
            recommendations.append(
                {
                    "raid_level": None,
                    "eligible": False,
                    "destructive": False,
                    "message": "Not enough Redfish-visible drives for a RAID recommendation yet.",
                }
            )

        return {
            "apply_supported": True,
            "apply_note": "Guarded RAID apply is enabled with explicit destructive confirmation.",
            "controller_count": len(controllers),
            "drive_count": drive_count,
            "volume_count": len(volumes),
            "controllers": controllers,
            "drives": drives,
            "volumes": volumes,
            "recommendations": recommendations,
        }

    def _volume_name(self, value: str) -> str:
        normalized = value.strip() or "kdx-volume"
        return normalized[:15]

    def _volume_create_payload(self, name: str, raid_type: str, drive_paths: list[str]) -> dict[str, Any]:
        redfish_raid_type = "None" if raid_type in {"None", "NON_RAID", "JBOD"} else raid_type
        payload = {
            "Name": self._volume_name(name),
            "RAIDType": redfish_raid_type,
            "Links": {
                "Drives": [{"@odata.id": path} for path in drive_paths],
            },
        }
        if redfish_raid_type != "None":
            payload["InitializeMethod"] = "Background"
        return payload

    def _normalize_odata_path(self, path: str | None) -> str:
        return str(path or "").strip().rstrip("/")

    def _volume_collection_for_drive(self, storage_inventory: dict[str, Any], drive_path: str) -> str:
        for storage_member in storage_inventory.get("storage", []):
            if not isinstance(storage_member, dict):
                continue
            drive_paths = {
                self._normalize_odata_path(str(nested.get("@odata.id")))
                for item in storage_member.get("drives", [])
                if isinstance(item, dict)
                for nested in [item.get("resource") if isinstance(item.get("resource"), dict) else item]
                if isinstance(nested, dict) and nested.get("@odata.id")
            }
            if self._normalize_odata_path(drive_path) not in drive_paths:
                continue
            resource = storage_member.get("resource") if isinstance(storage_member.get("resource"), dict) else {}
            volumes = resource.get("Volumes") if isinstance(resource, dict) else None
            if isinstance(volumes, dict) and volumes.get("@odata.id"):
                return str(volumes["@odata.id"])
        raise RedfishError(f"Drive {drive_path} is not linked to a writable Redfish Volumes collection.")

    def _volume_collection_for_drive_set(self, storage_inventory: dict[str, Any], drive_paths: list[str]) -> str:
        collections = {self._volume_collection_for_drive(storage_inventory, drive_path) for drive_path in drive_paths}
        if len(collections) != 1:
            raise RedfishError("Selected RAID drives must belong to the same Redfish storage controller.")
        return next(iter(collections))

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
        system_path = self._first_member_path("/redfish/v1/Systems/", "/redfish/v1/Systems/1/")
        system = self._get(system_path)
        actions = system.get("Actions") if isinstance(system.get("Actions"), dict) else {}
        reset = actions.get("#ComputerSystem.Reset") if isinstance(actions, dict) else None
        target = reset.get("target") if isinstance(reset, dict) else None
        if not target:
            raise RedfishError("ComputerSystem.Reset action was not found for this HPE server.")

        allowable = reset.get("ResetType@Redfish.AllowableValues") if isinstance(reset, dict) else []
        reset_type = "GracefulRestart"
        if isinstance(allowable, list) and allowable:
            if "GracefulRestart" in allowable:
                reset_type = "GracefulRestart"
            elif "ForceRestart" in allowable:
                reset_type = "ForceRestart"
            else:
                reset_type = str(allowable[0])

        payload = {"ResetType": reset_type}
        return {
            "vendor": self.vendor,
            "implemented": True,
            "system_path": system_path,
            "action": str(target),
            "payload": payload,
            "result": self._post(str(target), payload),
            "message": f"Server reboot submitted through Redfish ({reset_type}).",
        }
