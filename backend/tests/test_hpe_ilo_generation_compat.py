from __future__ import annotations

import unittest

from app.adapters.base import AdapterContext, BmcCredential
from app.adapters.hpe.ilo_client import HpeIloAdapter


class FixtureIloAdapter(HpeIloAdapter):
    def __init__(self, resources: dict[str, dict]):
        super().__init__(
            AdapterContext(
                vendor="hpe",
                model=None,
                bmc_ip="192.0.2.10",
                credential=BmcCredential("Administrator", "secret"),
            )
        )
        self.resources = resources

    def _get(self, path: str) -> dict:
        if path not in self.resources:
            raise AssertionError(f"Unexpected Redfish path: {path}")
        return self.resources[path]

    def get_ilo_license(self) -> dict:
        return {"edition": "Unknown", "installed": False}


def resources_for(model: str, manager_model: str, legacy: bool = False) -> dict[str, dict]:
    system_path = "/redfish/v1/Systems/server-1"
    manager_path = "/redfish/v1/Managers/ilo-1"
    ethernet_path = manager_path + "/EthernetInterfaces/1"
    member = (lambda path: {"href": path}) if legacy else (lambda path: {"@odata.id": path})
    collection = (lambda path: {"links": {"Member": [member(path)]}}) if legacy else (lambda path: {"Members": [member(path)]})
    return {
        "/redfish/v1/Systems/": collection(system_path),
        system_path: {
            "@odata.id": system_path,
            "SerialNumber": "CZ1234",
            "Manufacturer": "HPE",
            "Model": model,
            "PowerState": "On",
            "Status": {"Health": "OK"},
        },
        "/redfish/v1/Managers/": collection(manager_path),
        manager_path: {
            "@odata.id": manager_path,
            "Model": manager_model,
            "FirmwareVersion": "test",
            "Status": {"Health": "OK"},
        },
        manager_path + "/EthernetInterfaces/": collection(ethernet_path),
        ethernet_path: {"IPv4Addresses": [{"Address": "192.0.2.10", "SubnetMask": "255.255.255.0"}]},
        manager_path + "/NetworkProtocol/": {},
        "/redfish/v1/Chassis/": {"Members": []},
    }


class HpeIloGenerationCompatibilityTests(unittest.TestCase):
    def test_gen9_legacy_links_are_used_for_discovery_and_health(self) -> None:
        adapter = FixtureIloAdapter(resources_for("ProLiant DL380 Gen9", "HPE iLO 4", legacy=True))
        inventory = adapter.get_system_inventory()
        self.assertEqual(inventory["system_path"], "/redfish/v1/Systems/server-1")
        self.assertEqual(inventory["platform"]["server_generation"], "Gen9")
        self.assertEqual(inventory["platform"]["ilo_generation"], "iLO 4")
        self.assertEqual(inventory["management_network"]["ip"], "192.0.2.10")
        self.assertEqual(inventory["health"]["overall"], "healthy")

    def test_supported_generation_mapping(self) -> None:
        cases = (
            ("ProLiant DL380 Gen10", "HPE iLO 5", "Gen10", "iLO 5"),
            ("ProLiant DL380 Gen10 Plus", "HPE iLO 5", "Gen10Plus", "iLO 5"),
            ("ProLiant DL380 Gen11", "HPE iLO 6", "Gen11", "iLO 6"),
            ("ProLiant DL380 Gen12", "HPE iLO 7", "Gen12", "iLO 7"),
        )
        for model, manager, generation, ilo in cases:
            with self.subTest(model=model):
                details = FixtureIloAdapter({})._platform_details({"Model": model}, {"Model": manager})
                self.assertEqual(details["server_generation"], generation)
                self.assertEqual(details["ilo_generation"], ilo)

    def test_agentless_network_write_uses_discovered_legacy_interface(self) -> None:
        adapter = FixtureIloAdapter(resources_for("ProLiant DL380 Gen10", "HPE iLO 5", legacy=True))
        writes = []
        adapter._patch = lambda path, payload: writes.append((path, payload)) or {"status": "accepted"}  # type: ignore[method-assign]
        result = adapter.set_management_network(
            {"ip": "192.0.2.20", "subnet": "255.255.255.0", "gateway": "192.0.2.1", "dns": "1.1.1.1", "vlan": "0"}
        )
        self.assertEqual(result["ethernet_interface"], "/redfish/v1/Managers/ilo-1/EthernetInterfaces/1")
        self.assertEqual(writes[0][1]["IPv4StaticAddresses"][0]["Address"], "192.0.2.20")

    def test_dmtf_linked_controllers_and_empty_bays_are_normalized(self) -> None:
        controller_collection = "/redfish/v1/Systems/1/Storage/MR/Controllers"
        controller_path = controller_collection + "/0"
        adapter = FixtureIloAdapter(
            {
                controller_collection: {"Members": [{"@odata.id": controller_path}]},
                controller_path: {"Id": "0", "Name": "HPE MR416i-o Gen11", "SupportedRAIDTypes": ["None", "RAID1"]},
            }
        )
        storage_resource = {
            "Controllers": {"@odata.id": controller_collection},
            "StorageControllers": [{"Name": "Deprecated duplicate"}],
        }
        controllers = adapter._extract_controllers(storage_resource)
        self.assertEqual(len(controllers), 1)
        self.assertEqual(controllers[0]["path"], controller_path)
        self.assertEqual(controllers[0]["resource"]["Name"], "HPE MR416i-o Gen11")

        present = {"path": "/Drives/2", "resource": {"Name": "NVMe SSD", "SerialNumber": "disk-2", "Status": {"State": "StandbyOffline"}}}
        empty = {"path": "/Drives/64517", "resource": {"Name": "Empty Bay", "Status": {"State": "Absent"}}}
        self.assertTrue(adapter._is_present_storage_drive(present))
        self.assertFalse(adapter._is_present_storage_drive(empty))

    def test_volume_capabilities_enable_write_when_ilo_allow_header_omits_post(self) -> None:
        adapter = FixtureIloAdapter({})
        raid = adapter._raid_summary(
            [
                {
                    "path": "/Storage/MR",
                    "resource": {"Volumes": {"@odata.id": "/Storage/MR/Volumes"}},
                    "controllers": [],
                    "drives": [{"path": "/Drives/2", "resource": {"Name": "SSD", "SerialNumber": "disk-2"}}],
                    "volumes": [],
                    "volume_methods": ["GET", "HEAD"],
                    "volume_capabilities": {"RAIDType@Redfish.AllowableValues": ["None", "RAID1"]},
                }
            ],
            {"detected": False},
        )
        self.assertTrue(raid["apply_supported"])
        self.assertEqual(raid["writable_drive_count"], 1)
        self.assertEqual(raid["drives"][0]["writable_volume_collection"], "/Storage/MR/Volumes")

    def test_volume_create_payload_uses_dmtf_display_name(self) -> None:
        payload = FixtureIloAdapter({})._volume_create_payload("os-boot", "RAID1", ["/Drives/0", "/Drives/1"])
        self.assertEqual(payload["DisplayName"], "os-boot")
        self.assertNotIn("Name", payload)
        self.assertNotIn("InitializeMethod", payload)

    def test_dmtf_storage_flow_creates_raid_then_non_raid_remaining(self) -> None:
        volumes = "/redfish/v1/Systems/1/Storage/MR/Volumes"
        drives = [f"/redfish/v1/Chassis/MR/Drives/{index}" for index in range(4)]
        adapter = FixtureIloAdapter({})
        adapter.get_storage_inventory = lambda: {  # type: ignore[method-assign]
            "storage": [{
                "resource": {"Volumes": {"@odata.id": volumes}},
                "drives": [{"resource": {"@odata.id": path}} for path in drives],
                "volume_capabilities": {"RAIDType@Redfish.AllowableValues": ["None", "RAID1"]},
            }]
        }
        writes = []
        adapter._post = lambda path, payload: writes.append((path, payload)) or {"http_status": 201}  # type: ignore[method-assign]

        result = adapter.set_raid_config({
            "disk_mode": "RAID",
            "raid_level": "RAID1",
            "volume_name": "os-boot",
            "selected_drive_paths": drives[:2],
            "auto_jbod_remaining": True,
            "jbod_candidate_drives": [{"path": path} for path in drives[2:]],
        })

        self.assertEqual([payload["RAIDType"] for _, payload in writes], ["RAID1", "None", "None"])
        self.assertTrue(result["auto_jbod_executed"])
        self.assertEqual(len(result["operations"]), 3)

    def test_non_raid_flow_requires_none_capability(self) -> None:
        volumes = "/redfish/v1/Systems/1/Storage/MR/Volumes"
        drive = "/redfish/v1/Chassis/MR/Drives/0"
        adapter = FixtureIloAdapter({})
        adapter.get_storage_inventory = lambda: {  # type: ignore[method-assign]
            "storage": [{
                "resource": {"Volumes": {"@odata.id": volumes}},
                "drives": [{"resource": {"@odata.id": drive}}],
                "volume_capabilities": {"RAIDType@Redfish.AllowableValues": ["RAID1"]},
            }]
        }
        with self.assertRaisesRegex(Exception, "does not advertise RAIDType None"):
            adapter.set_raid_config({"disk_mode": "NON_RAID", "selected_drive_paths": [drive]})


if __name__ == "__main__":
    unittest.main()
