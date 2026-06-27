from __future__ import annotations

import ipaddress


def is_valid_ip_address(value: str | None) -> bool:
    if not value:
        return False
    try:
        ipaddress.ip_address(value)
    except ValueError:
        return False
    return True
