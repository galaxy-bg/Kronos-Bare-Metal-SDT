#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


DEFAULT_CONFIG = "/etc/kdx-agent/agent.env"


def read_env_file(path: str) -> dict[str, str]:
    config_path = Path(path)
    if not config_path.exists():
        return {}

    values: dict[str, str] = {}
    for raw_line in config_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def setting(config: dict[str, str], key: str, default: str | None = None) -> str | None:
    return os.environ.get(key) or config.get(key) or default


def run(command: list[str], timeout: int = 10) -> str:
    try:
        result = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return ""
    return result.stdout.strip() if result.returncode == 0 else ""


def read_first(paths: list[str]) -> str | None:
    for path in paths:
        try:
            value = Path(path).read_text(encoding="utf-8").strip()
        except OSError:
            continue
        if value:
            return value
    return None


def dmi_value(name: str, sysfs_name: str) -> str | None:
    sysfs_value = read_first([f"/sys/class/dmi/id/{sysfs_name}"])
    if sysfs_value:
        return sysfs_value

    dmidecode_value = run(["dmidecode", "-s", name])
    return dmidecode_value or None


def get_agent_ip(interface: str | None) -> str | None:
    if interface:
        output = run(["ip", "-j", "addr", "show", "dev", interface])
    else:
        route = run(["ip", "-j", "route", "get", "1.1.1.1"])
        try:
            routes = json.loads(route)
            preferred = routes[0].get("prefsrc")
            if preferred:
                return str(preferred)
        except (json.JSONDecodeError, IndexError, AttributeError):
            pass
        output = run(["ip", "-j", "addr"])

    try:
        devices = json.loads(output)
    except json.JSONDecodeError:
        return None

    for device in devices:
        if device.get("ifname") == "lo":
            continue
        for addr in device.get("addr_info", []):
            if addr.get("family") == "inet" and not str(addr.get("local", "")).startswith("127."):
                return str(addr.get("local"))
    return None


def collect_cpu() -> list[dict[str, Any]]:
    model = None
    cores = 0
    sockets: set[str] = set()

    try:
        for line in Path("/proc/cpuinfo").read_text(encoding="utf-8").splitlines():
            if line.startswith("model name") and model is None:
                model = line.split(":", 1)[1].strip()
            if line.startswith("processor"):
                cores += 1
            if line.startswith("physical id"):
                sockets.add(line.split(":", 1)[1].strip())
    except OSError:
        pass

    return [{"model": model or "Unknown CPU", "cores": cores or None, "sockets": len(sockets) or None}]


def collect_memory() -> dict[str, Any]:
    try:
        for line in Path("/proc/meminfo").read_text(encoding="utf-8").splitlines():
            if line.startswith("MemTotal:"):
                kb = int(line.split()[1])
                return {"total_gb": round(kb / 1024 / 1024, 2)}
    except (OSError, ValueError):
        pass
    return {"total_gb": None}


def collect_storage() -> list[dict[str, Any]]:
    output = run(["lsblk", "-J", "-b", "-o", "NAME,TYPE,SIZE,MODEL,SERIAL"])
    try:
        data = json.loads(output)
    except json.JSONDecodeError:
        return []

    disks: list[dict[str, Any]] = []
    for device in data.get("blockdevices", []):
        if device.get("type") != "disk":
            continue
        size = device.get("size")
        disks.append(
            {
                "name": device.get("name"),
                "model": device.get("model"),
                "serial": device.get("serial"),
                "size_gb": round(int(size) / 1024 / 1024 / 1024, 2) if size else None,
            }
        )
    return disks


def collect_network() -> list[dict[str, Any]]:
    output = run(["ip", "-j", "addr"])
    try:
        devices = json.loads(output)
    except json.JSONDecodeError:
        return []

    interfaces: list[dict[str, Any]] = []
    for device in devices:
        name = device.get("ifname")
        if name == "lo":
            continue
        ipv4 = [
            addr.get("local")
            for addr in device.get("addr_info", [])
            if addr.get("family") == "inet" and addr.get("local")
        ]
        interfaces.append(
            {
                "name": name,
                "mac": device.get("address"),
                "state": device.get("operstate"),
                "ipv4": ipv4,
            }
        )
    return interfaces


def detect_bmc(config: dict[str, str]) -> dict[str, Any]:
    bmc_ip = setting(config, "KDX_BMC_IP")
    bmc_type = setting(config, "KDX_BMC_TYPE", "iLO")
    bmc_vendor = setting(config, "KDX_BMC_VENDOR", "HPE")
    return {
        "vendor": bmc_vendor,
        "type": bmc_type,
        "ip": bmc_ip,
        "detected_by": "predefined" if bmc_ip else "pending-management-network-config",
    }


def collect_inventory(config: dict[str, str]) -> dict[str, Any]:
    vendor = setting(config, "KDX_VENDOR") or dmi_value("system-manufacturer", "sys_vendor")
    model = setting(config, "KDX_MODEL") or dmi_value("system-product-name", "product_name")
    product_name = setting(config, "KDX_PRODUCT_NAME") or dmi_value("system-version", "product_version")
    serial = setting(config, "KDX_SERIAL_NUMBER") or dmi_value("system-serial-number", "product_serial")

    return {
        "system": {
            "vendor": vendor,
            "model": model,
            "product_name": product_name,
            "serial_number": serial,
            "hostname": socket.gethostname(),
        },
        "cpu": collect_cpu(),
        "memory": collect_memory(),
        "storage": collect_storage(),
        "network": collect_network(),
        "bmc": detect_bmc(config),
    }


def post_json(controller: str, path: str, payload: dict[str, Any]) -> dict[str, Any]:
    url = f"{controller.rstrip('/')}{path}"
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            body = response.read().decode("utf-8")
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8")
        raise RuntimeError(f"{url} failed with HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"{url} failed: {exc.reason}") from exc


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="KDX SDT live agent.")
    parser.add_argument("--config", default=DEFAULT_CONFIG, help="Path to agent env config.")
    parser.add_argument("--controller", default=None, help="KDX controller URL.")
    parser.add_argument("--interface", default=None, help="Network interface used for agent IP discovery.")
    parser.add_argument("--once", action="store_true", help="Register and upload inventory once, then exit.")
    parser.add_argument("--heartbeat-interval", type=int, default=None, help="Heartbeat interval in seconds.")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    config = read_env_file(args.config)
    controller = args.controller or setting(config, "KDX_CONTROLLER_URL", "http://192.168.88.240:8000")
    interface = args.interface or setting(config, "KDX_AGENT_INTERFACE")
    interval = args.heartbeat_interval or int(setting(config, "KDX_HEARTBEAT_INTERVAL", "60") or "60")

    inventory = collect_inventory(config)
    system = inventory["system"]
    serial = system.get("serial_number")
    if not serial:
        raise RuntimeError("Serial number is missing. Set KDX_SERIAL_NUMBER for VM tests.")

    agent_ip = get_agent_ip(interface)
    hostname = setting(config, "KDX_HOSTNAME") or f"iLO-{serial}"
    bmc_ip = inventory.get("bmc", {}).get("ip")

    register_payload = {
        "serial_number": serial,
        "vendor": system.get("vendor"),
        "model": system.get("model"),
        "product_name": system.get("product_name"),
        "hostname": hostname,
        "agent_ip": agent_ip,
        "bmc_ip": bmc_ip,
    }

    print(f"Registering {serial} to {controller}")
    print(json.dumps(post_json(controller, "/api/v1/agents/register", register_payload), indent=2))

    print("Uploading inventory")
    print(json.dumps(post_json(controller, "/api/v1/agents/inventory", {"serial_number": serial, "inventory": inventory}), indent=2))

    if args.once:
        print("One-shot mode complete")
        return 0

    print(f"Sending heartbeat every {interval} seconds")
    while True:
        payload = {"serial_number": serial, "agent_ip": get_agent_ip(interface)}
        result = post_json(controller, "/api/v1/agents/heartbeat", payload)
        print(f"heartbeat ok: {result.get('serial_number', serial)}")
        time.sleep(interval)


if __name__ == "__main__":
    raise SystemExit(main())
