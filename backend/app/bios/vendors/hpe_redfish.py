from __future__ import annotations

from typing import Any

from app.bios.normalizer import workload_options
from app.models.server import Server
from app.services.adapter_service import AdapterService
from app.utils.redfish import RedfishError


class HpeRedfishBIOSClient:
    def __init__(self) -> None:
        self.adapter_service = AdapterService()

    def read_current(self, server: Server) -> dict[str, Any]:
        adapter = self.adapter_service.build_for_server(server)
        if not server.bmc_ip:
            raise RedfishError("BMC/iLO IP is not configured.")
        if not adapter.context.credential:
            raise RedfishError("BMC credential is not configured.")
        return adapter.get_bios_config()

    def read_workload_options(self, server: Server) -> dict[str, Any]:
        return workload_options(self.read_current(server))

    def apply_attributes(self, server: Server, attributes: dict[str, Any], dry_run: bool = True) -> dict[str, Any]:
        adapter = self.adapter_service.build_for_server(server)
        if dry_run:
            return {
                "dry_run": True,
                "vendor": "hpe",
                "apply_attributes": attributes,
                "message": "BIOS apply dry-run only; no Redfish PATCH was sent.",
            }
        return adapter.set_bios_config({"attributes": attributes})
