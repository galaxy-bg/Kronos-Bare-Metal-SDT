#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET


DEFAULT_CONFIG = "/etc/kdx-agent/agent.env"
HPE_TOOL_CANDIDATES = {
    "hponcfg": ["/usr/local/bin/hponcfg", "/sbin/hponcfg", "/usr/sbin/hponcfg", "/usr/bin/hponcfg"],
    "ilorest": ["/usr/local/bin/ilorest", "/usr/sbin/ilorest", "/usr/bin/ilorest", "/opt/ilorest/ilorest"],
    "ssacli": [
        "/usr/local/bin/ssacli",
        "/usr/sbin/ssacli",
        "/usr/bin/ssacli",
        "/opt/smartstorageadmin/ssacli/bin/ssacli",
        "/opt/smartstorageadmin/ssacli/ssacli",
    ],
    "hpasmcli": ["/usr/local/bin/hpasmcli", "/sbin/hpasmcli", "/usr/sbin/hpasmcli", "/usr/bin/hpasmcli"],
}
INVALID_DMI_VALUES = {
    "",
    "0",
    "none",
    "null",
    "not specified",
    "not available",
    "not applicable",
    "unknown",
    "system serial number",
    "to be filled by o.e.m.",
    "to be filled by oem",
}


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
            encoding="utf-8",
            errors="replace",
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
        if clean_dmi_value(value):
            return value
    return None


def clean_dmi_value(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    if cleaned.lower() in INVALID_DMI_VALUES:
        return None
    return cleaned


def dmi_value(name: str, sysfs_names: str | list[str]) -> str | None:
    if isinstance(sysfs_names, str):
        sysfs_names = [sysfs_names]

    sysfs_value = read_first([f"/sys/class/dmi/id/{sysfs_name}" for sysfs_name in sysfs_names])
    if sysfs_value:
        return sysfs_value

    dmidecode_value = run(["dmidecode", "-s", name])
    return clean_dmi_value(dmidecode_value)


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


def is_hpe_vendor(vendor: str | None) -> bool:
    if not vendor:
        return False
    normalized = vendor.strip().lower()
    return normalized in {"hpe", "hewlett packard enterprise", "hewlett-packard", "hp"} or "hewlett" in normalized


def first_existing_path(paths: list[str]) -> str | None:
    return next((path for path in paths if Path(path).exists()), None)


def link_hpe_tools(system_vendor: str | None, config: dict[str, str]) -> dict[str, Any]:
    if not is_hpe_vendor(system_vendor):
        return {"enabled": False, "reason": "non-hpe-vendor"}
    if not bool_setting(config, "KDX_LINK_HPE_TOOLS", True):
        return {"enabled": False, "reason": "disabled"}

    link_dir = Path(setting(config, "KDX_HPE_TOOL_LINK_DIR", "/usr/local/bin") or "/usr/local/bin")
    tools: dict[str, Any] = {}
    try:
        link_dir.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        return {"enabled": True, "error": f"cannot create {link_dir}: {exc}", "tools": tools}

    for tool_name, candidates in HPE_TOOL_CANDIDATES.items():
        source = first_existing_path(candidates)
        if source is None:
            tools[tool_name] = {"available": False, "linked": False}
            continue

        link_path = link_dir / tool_name
        tool_status: dict[str, Any] = {"available": True, "path": source, "link": str(link_path), "linked": False}
        try:
            if link_path.exists() or link_path.is_symlink():
                if link_path.is_symlink() and str(link_path.resolve()) == str(Path(source).resolve()):
                    tool_status["linked"] = True
                elif link_path.resolve() == Path(source).resolve():
                    tool_status["linked"] = True
                    tool_status["link"] = str(link_path)
                else:
                    tool_status["error"] = f"{link_path} already exists"
            else:
                link_path.symlink_to(source)
                tool_status["linked"] = True
        except OSError as exc:
            tool_status["error"] = str(exc)
        tools[tool_name] = tool_status

    return {"enabled": True, "reason": "hpe-vendor", "tools": tools}


def hponcfg_path() -> str | None:
    return first_existing_path(HPE_TOOL_CANDIDATES["hponcfg"])


def parse_hponcfg_value(root: ET.Element, *tags: str) -> str | None:
    wanted = {tag.lower() for tag in tags}
    for element in root.iter():
        if element.tag.lower() not in wanted:
            continue
        value = element.attrib.get("VALUE") or element.text
        cleaned = string_value(value)
        if cleaned:
            return cleaned
    return None


def discover_hpe_bmc_with_hponcfg() -> dict[str, Any]:
    executable = hponcfg_path()
    if executable is None:
        return {"detected_by": "hponcfg-missing"}

    with tempfile.NamedTemporaryFile(prefix="kdx-hponcfg-read-", suffix=".xml", delete=False) as handle:
        xml_path = handle.name

    try:
        result = subprocess.run(
            [executable, "-w", xml_path],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=60,
            check=False,
        )
        if result.returncode != 0:
            output = (result.stdout + "\n" + result.stderr).strip()
            return {"detected_by": "hponcfg-read-failed", "error": output or f"hponcfg exited {result.returncode}"}

        try:
            root = ET.parse(xml_path).getroot()
        except (ET.ParseError, OSError) as exc:
            return {"detected_by": "hponcfg-parse-failed", "error": str(exc)}

        return {
            "vendor": "HPE",
            "type": "iLO",
            "ip": parse_hponcfg_value(root, "IP_ADDRESS"),
            "subnet": parse_hponcfg_value(root, "SUBNET_MASK"),
            "gateway": parse_hponcfg_value(root, "GATEWAY_IP_ADDRESS"),
            "dns": parse_hponcfg_value(root, "PRIM_DNS_SERVER", "DNS_SERVER1"),
            "vlan": parse_hponcfg_value(root, "VLAN_ID") or "0",
            "detected_by": "hponcfg",
        }
    finally:
        try:
            Path(xml_path).unlink()
        except OSError:
            pass


def detect_bmc(config: dict[str, str], system_vendor: str | None) -> dict[str, Any]:
    bmc_ip = setting(config, "KDX_BMC_IP")
    bmc_type = setting(config, "KDX_BMC_TYPE", "iLO" if is_hpe_vendor(system_vendor) else None)
    bmc_vendor = setting(config, "KDX_BMC_VENDOR") or ("HPE" if is_hpe_vendor(system_vendor) else None)
    if bmc_ip:
        return {
            "vendor": bmc_vendor,
            "type": bmc_type,
            "ip": bmc_ip,
            "detected_by": "predefined",
        }

    if is_hpe_vendor(system_vendor) and bool_setting(config, "KDX_DISCOVER_HPE_BMC", True):
        discovered = discover_hpe_bmc_with_hponcfg()
        if discovered.get("ip"):
            return discovered

    return {
        "vendor": bmc_vendor,
        "type": bmc_type,
        "ip": None,
        "detected_by": "pending-management-network-config",
    }


def collect_inventory(config: dict[str, str]) -> dict[str, Any]:
    vendor = setting(config, "KDX_VENDOR") or dmi_value("system-manufacturer", "sys_vendor")
    model = setting(config, "KDX_MODEL") or dmi_value("system-product-name", "product_name")
    product_name = setting(config, "KDX_PRODUCT_NAME") or dmi_value("system-version", "product_version")
    serial = (
        setting(config, "KDX_SERIAL_NUMBER")
        or dmi_value("system-serial-number", ["product_serial", "product_uuid"])
        or dmi_value("baseboard-serial-number", "board_serial")
        or dmi_value("chassis-serial-number", "chassis_serial")
    )

    hpe_tools = link_hpe_tools(vendor, config)

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
        "bmc": detect_bmc(config, vendor),
        "tools": {
            "hpe": hpe_tools,
        },
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


def post_json_optional(controller: str, path: str, payload: dict[str, Any]) -> dict[str, Any] | None:
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
            return json.loads(body) if body else None
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8")
        raise RuntimeError(f"{url} failed with HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"{url} failed: {exc.reason}") from exc


def bool_setting(config: dict[str, str], key: str, default: bool) -> bool:
    value = setting(config, key)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def ribcl_root() -> tuple[ET.Element, ET.Element]:
    root = ET.Element("RIBCL", {"VERSION": "2.0"})
    login = ET.SubElement(root, "LOGIN", {"USER_LOGIN": "", "PASSWORD": ""})
    return root, login


def xml_bytes(root: ET.Element) -> bytes:
    ET.indent(root, space="  ")
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def add_value(parent: ET.Element, tag: str, value: str | None) -> None:
    if value:
        ET.SubElement(parent, tag, {"VALUE": value})


def build_hponcfg_create_user_xml(username: str, password: str) -> bytes:
    root, login = ribcl_root()
    user_info = ET.SubElement(login, "USER_INFO", {"MODE": "write"})
    add_user = ET.SubElement(
        user_info,
        "ADD_USER",
        {"USER_NAME": username, "USER_LOGIN": username, "PASSWORD": password},
    )
    for privilege in [
        "ADMIN_PRIV",
        "REMOTE_CONS_PRIV",
        "RESET_SERVER_PRIV",
        "VIRTUAL_MEDIA_PRIV",
        "CONFIG_ILO_PRIV",
    ]:
        ET.SubElement(add_user, privilege, {"VALUE": "Y"})
    return xml_bytes(root)


def normalize_subnet_mask(value: str | None) -> str | None:
    if not value:
        return None
    stripped = value.strip()
    if not stripped.startswith("/"):
        return stripped
    try:
        prefix = int(stripped[1:])
    except ValueError:
        return stripped
    if prefix < 0 or prefix > 32:
        return stripped
    mask = (0xFFFFFFFF << (32 - prefix)) & 0xFFFFFFFF
    return ".".join(str((mask >> shift) & 0xFF) for shift in (24, 16, 8, 0))


def build_hponcfg_network_xml(management: dict[str, Any]) -> bytes:
    root, login = ribcl_root()
    rib_info = ET.SubElement(login, "RIB_INFO", {"MODE": "write"})
    network = ET.SubElement(rib_info, "MOD_NETWORK_SETTINGS")
    ET.SubElement(network, "DHCP_ENABLE", {"VALUE": "N"})
    add_value(network, "IP_ADDRESS", string_value(management.get("ip")))
    add_value(network, "SUBNET_MASK", normalize_subnet_mask(string_value(management.get("subnet"))))
    add_value(network, "GATEWAY_IP_ADDRESS", string_value(management.get("gateway")))

    dns = string_value(management.get("dns"))
    if dns:
        dns_servers = [server.strip() for server in dns.split(",") if server.strip()]
        if dns_servers:
            add_value(network, "PRIM_DNS_SERVER", dns_servers[0])
        if len(dns_servers) > 1:
            add_value(network, "SEC_DNS_SERVER", dns_servers[1])

    vlan = string_value(management.get("vlan"))
    if vlan and vlan != "0":
        ET.SubElement(network, "VLAN_ENABLED", {"VALUE": "Y"})
        ET.SubElement(network, "VLAN_ID", {"VALUE": vlan})

    ntp = string_value(management.get("ntp"))
    if ntp:
        sntp = ET.SubElement(rib_info, "MOD_SNTP_SETTINGS")
        add_value(sntp, "SNTP_SERVER1", ntp.split(",")[0].strip())

    return xml_bytes(root)


def string_value(value: Any) -> str | None:
    if value is None:
        return None
    stripped = str(value).strip()
    return stripped or None


def run_hponcfg(xml_content: bytes) -> dict[str, Any]:
    executable = hponcfg_path()
    if executable is None:
        raise RuntimeError("hponcfg is not installed")

    with tempfile.NamedTemporaryFile(prefix="kdx-hponcfg-", suffix=".xml", delete=False) as handle:
        handle.write(xml_content)
        xml_path = handle.name

    try:
        result = subprocess.run(
            [executable, "-f", xml_path],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=60,
            check=False,
        )
    finally:
        try:
            Path(xml_path).unlink()
        except OSError:
            pass

    output = (result.stdout + "\n" + result.stderr).strip()
    if result.returncode != 0:
        raise RuntimeError(output or f"hponcfg failed with exit code {result.returncode}")
    return {"command": f"{executable} -f <generated.xml>", "output": output}


def execute_action(action: dict[str, Any], config: dict[str, str], system_vendor: str | None) -> dict[str, Any]:
    if not bool_setting(config, "KDX_ENABLE_HPE_ACTIONS", True):
        raise RuntimeError("HPE actions are disabled by KDX_ENABLE_HPE_ACTIONS")
    if not is_hpe_vendor(system_vendor):
        raise RuntimeError(f"HPE actions are not allowed for vendor: {system_vendor or 'unknown'}")

    action_type = action.get("action_type")
    payload = action.get("payload") or {}

    if action_type == "hpe_create_ilo_user":
        username = string_value(payload.get("username"))
        password = string_value(payload.get("password"))
        if not username or not password:
            raise RuntimeError("username and password are required")
        result = run_hponcfg(build_hponcfg_create_user_xml(username, password))
        return {**result, "username": username}

    if action_type == "hpe_set_ilo_network":
        management = payload.get("management") or {}
        if not isinstance(management, dict):
            raise RuntimeError("management payload is invalid")
        if not string_value(management.get("ip")):
            raise RuntimeError("management.ip is required")
        result = run_hponcfg(build_hponcfg_network_xml(management))
        return {**result, "management": {key: value for key, value in management.items() if key != "password"}}

    raise RuntimeError(f"Unsupported action type: {action_type}")


def poll_and_execute_actions(controller: str, serial: str, config: dict[str, str], system_vendor: str | None, max_actions: int = 3) -> None:
    for _ in range(max_actions):
        action = post_json_optional(controller, "/api/v1/agents/actions/next", {"serial_number": serial})
        if not action:
            return

        action_id = action.get("id")
        action_type = action.get("action_type")
        print(f"Executing action {action_id}: {action_type}")
        try:
            result = execute_action(action, config, system_vendor)
            post_json(
                controller,
                f"/api/v1/agents/actions/{action_id}/complete",
                {"serial_number": serial, "status": "succeeded", "result": result},
            )
            print(f"action {action_id} succeeded")
        except Exception as exc:
            post_json(
                controller,
                f"/api/v1/agents/actions/{action_id}/complete",
                {"serial_number": serial, "status": "failed", "error": str(exc)},
            )
            print(f"action {action_id} failed: {exc}")


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
    poll_and_execute_actions(controller, serial, config, system.get("vendor"))

    if args.once:
        print("One-shot mode complete")
        return 0

    print(f"Sending heartbeat every {interval} seconds")
    while True:
        payload = {"serial_number": serial, "agent_ip": get_agent_ip(interface)}
        result = post_json(controller, "/api/v1/agents/heartbeat", payload)
        print(f"heartbeat ok: {result.get('serial_number', serial)}")
        poll_and_execute_actions(controller, serial, config, system.get("vendor"))
        time.sleep(interval)


if __name__ == "__main__":
    raise SystemExit(main())
