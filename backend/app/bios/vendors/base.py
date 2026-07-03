from __future__ import annotations

from typing import Any, Protocol

from app.models.server import Server


class BIOSVendorClient(Protocol):
    def read_current(self, server: Server) -> dict[str, Any]:
        raise NotImplementedError

    def read_workload_options(self, server: Server) -> dict[str, Any]:
        raise NotImplementedError

    def apply_attributes(self, server: Server, attributes: dict[str, Any], dry_run: bool = True) -> dict[str, Any]:
        raise NotImplementedError
