from __future__ import annotations


def normalize_vendor(value: str | None) -> str:
    raw = (value or "").strip().lower()
    if not raw:
        return "unknown"
    if raw in {"hpe", "hp", "hewlett packard enterprise", "hewlett-packard", "hewlett-packard enterprise"}:
        return "hpe"
    if raw in {"dell", "dell inc.", "dell emc", "dell technologies"}:
        return "dell"
    if "pegatron" in raw:
        return "oem"
    if "redfish" in raw:
        return "generic_redfish"
    return raw if raw in {"hpe", "dell", "generic_redfish", "oem", "unknown"} else "unknown"
