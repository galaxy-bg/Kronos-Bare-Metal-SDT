from __future__ import annotations

import re
from typing import Any

READ_ONLY_HINTS = {
    "serial",
    "uuid",
    "guid",
    "mac",
    "wwn",
    "license",
    "signature",
    "fingerprint",
    "certificate",
    "password",
    "secret",
    "token",
    "asset",
    "servicetag",
    "service_tag",
}

UNSAFE_EXACT_NAMES = {
    "AdminPassword",
    "PowerOnPassword",
    "SecureBootStatus",
    "TpmState",
    "Tpm2Operation",
    "OneTimeBoot",
    "BootOnce",
}


def normalize_bios_config(bios_payload: dict[str, Any]) -> dict[str, Any]:
    attributes = extract_attributes(bios_payload)
    registry_attributes = extract_registry_attributes(bios_payload)
    normalized: dict[str, Any] = {}
    skipped: list[dict[str, str]] = []

    for name, value in attributes.items():
        registry = registry_attributes.get(name, {})
        reason = skip_reason(name, registry)
        if reason:
            skipped.append({"attribute": name, "reason": reason})
            continue
        normalized[name] = coerce_value(value, registry)

    return {
        "raw_attributes": attributes,
        "normalized_attributes": normalized,
        "skipped_attributes": skipped,
        "registry_attributes": registry_attributes,
        "settings_uri": extract_settings_uri(bios_payload),
        "attribute_registry": extract_attribute_registry_name(bios_payload),
        "workload_profile": detect_workload_profile(attributes, registry_attributes),
    }


def final_attributes(
    normalized_attributes: dict[str, Any],
    custom_overrides: dict[str, Any] | None = None,
    base_workload_profile: str | None = None,
) -> dict[str, Any]:
    result = dict(normalized_attributes or {})
    if base_workload_profile:
        result["WorkloadProfile"] = base_workload_profile
    result.update(custom_overrides or {})
    return result


def extract_attributes(bios_payload: dict[str, Any]) -> dict[str, Any]:
    bios = bios_payload.get("bios") if isinstance(bios_payload.get("bios"), dict) else bios_payload
    attributes = bios.get("Attributes") if isinstance(bios, dict) else {}
    return dict(attributes or {}) if isinstance(attributes, dict) else {}


def extract_registry_attributes(bios_payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
    registry = bios_payload.get("registry") if isinstance(bios_payload.get("registry"), dict) else {}
    entries = registry.get("RegistryEntries") if isinstance(registry, dict) else {}
    attributes = entries.get("Attributes") if isinstance(entries, dict) else []
    result: dict[str, dict[str, Any]] = {}
    if not isinstance(attributes, list):
        return result
    for item in attributes:
        if not isinstance(item, dict):
            continue
        name = item.get("AttributeName") or item.get("Name")
        if name:
            result[str(name)] = item
    return result


def extract_settings_uri(bios_payload: dict[str, Any]) -> str | None:
    bios = bios_payload.get("bios") if isinstance(bios_payload.get("bios"), dict) else bios_payload
    settings = bios.get("@Redfish.Settings") if isinstance(bios, dict) else None
    if isinstance(settings, dict):
        settings_object = settings.get("SettingsObject")
        if isinstance(settings_object, dict) and settings_object.get("@odata.id"):
            return str(settings_object["@odata.id"])
    return None


def extract_attribute_registry_name(bios_payload: dict[str, Any]) -> str | None:
    bios = bios_payload.get("bios") if isinstance(bios_payload.get("bios"), dict) else bios_payload
    value = bios.get("AttributeRegistry") if isinstance(bios, dict) else None
    return str(value) if value else None


def workload_options(bios_payload: dict[str, Any]) -> dict[str, Any]:
    normalized = normalize_bios_config(bios_payload)
    registry = normalized.get("registry_attributes", {})
    workload = registry.get("WorkloadProfile") if isinstance(registry, dict) else None
    allowable: list[str] = []
    display_names: dict[str, str] = {}
    if isinstance(workload, dict):
        values = workload.get("Value") or workload.get("AllowableValues") or []
        if isinstance(values, list):
            for item in values:
                if isinstance(item, dict):
                    value_name = item.get("ValueName") or item.get("Value")
                    if value_name:
                        allowable.append(str(value_name))
                        if item.get("ValueDisplayName"):
                            display_names[str(value_name)] = str(item["ValueDisplayName"])
                    continue
                if item is not None:
                    allowable.append(str(item))
    return {
        "supported": bool(allowable or normalized.get("workload_profile") is not None),
        "attribute": "WorkloadProfile",
        "current": normalized.get("workload_profile"),
        "options": allowable,
        "display_names": display_names,
    }


def detect_workload_profile(attributes: dict[str, Any], registry_attributes: dict[str, dict[str, Any]]) -> str | None:
    if "WorkloadProfile" in attributes:
        return str(attributes["WorkloadProfile"])
    for name in registry_attributes:
        if name.lower() == "workloadprofile":
            value = attributes.get(name)
            return str(value) if value is not None else None
    return None


def skip_reason(name: str, registry: dict[str, Any]) -> str | None:
    if registry.get("ReadOnly") is True:
        return "read-only"
    if name in UNSAFE_EXACT_NAMES:
        return "unsafe"
    lowered = re.sub(r"[^a-z0-9]+", "_", name.lower())
    for hint in READ_ONLY_HINTS:
        if hint in lowered:
            return "server-specific"
    return None


def coerce_value(value: Any, registry: dict[str, Any]) -> Any:
    attr_type = str(registry.get("Type") or registry.get("AttributeType") or "").lower()
    if attr_type in {"integer", "int"}:
        try:
            return int(value)
        except (TypeError, ValueError):
            return value
    if attr_type in {"boolean", "bool"}:
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            return value.lower() in {"true", "enabled", "yes", "1"}
    return value
