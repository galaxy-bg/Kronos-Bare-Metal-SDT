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


if __name__ == "__main__":
    unittest.main()
