from __future__ import annotations

from typing import Any


def diff_attributes(
    desired: dict[str, Any],
    current: dict[str, Any],
    supported_attributes: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    changed: dict[str, dict[str, Any]] = {}
    unchanged: dict[str, Any] = {}
    unsupported: dict[str, Any] = {}
    supported = supported_attributes or {}

    for name, desired_value in sorted((desired or {}).items()):
        if supported and name not in supported:
            unsupported[name] = desired_value
            continue
        current_value = current.get(name)
        if current_value == desired_value:
            unchanged[name] = desired_value
            continue
        changed[name] = {"current": current_value, "desired": desired_value}

    return {
        "changed": changed,
        "unchanged": unchanged,
        "unsupported": unsupported,
        "changed_count": len(changed),
        "unsupported_count": len(unsupported),
        "apply_attributes": {name: item["desired"] for name, item in changed.items()},
    }


def compliance_result(diff: dict[str, Any]) -> dict[str, Any]:
    return {
        "compliant": not diff.get("changed") and not diff.get("unsupported"),
        "changed_count": diff.get("changed_count", 0),
        "unsupported_count": diff.get("unsupported_count", 0),
        "diff": diff,
    }
