from __future__ import annotations

from typing import Any

from app.adapters.base import AdapterContext
from app.adapters.registry import AdapterRegistry
from app.models.server import Server
from app.services.server_service import get_preferred_bmc_credential
from app.utils.dmi import normalize_vendor


class AdapterService:
    def build_for_server(self, server: Server):
        context = AdapterContext(
            vendor=normalize_vendor(server.vendor),
            model=server.model,
            bmc_ip=server.bmc_ip,
            credential=get_preferred_bmc_credential(server),
        )
        return AdapterRegistry.build(context)

    def mocked_inventory_refresh(self, server: Server, reason: str) -> dict[str, Any]:
        return {
            "vendor": normalize_vendor(server.vendor),
            "source": "mocked-refresh",
            "mocked": True,
            "reason": reason,
            "system": {
                "SerialNumber": server.serial_number,
                "Manufacturer": server.vendor,
                "Model": server.model,
                "HostName": server.hostname,
            },
        }
