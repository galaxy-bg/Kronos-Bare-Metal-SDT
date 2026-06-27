from __future__ import annotations

from app.adapters.base import BmcCredential
from app.models.server import Server


def get_preferred_bmc_credential(server: Server) -> BmcCredential | None:
    config = server.management_config_json or {}
    for key in ("managed_user", "credential"):
        value = config.get(key)
        if isinstance(value, dict) and value.get("username") and value.get("password"):
            return BmcCredential(username=str(value["username"]), password=str(value["password"]))
    return None
