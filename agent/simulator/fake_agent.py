#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


def post_json(controller: str, path: str, payload: dict[str, Any]) -> dict[str, Any]:
    url = f"{controller.rstrip('/')}{path}"
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
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


def load_inventory(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as inventory_file:
        return json.load(inventory_file)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Register a fake server to KDX SDT.")
    parser.add_argument("--controller", default="http://localhost:8000", help="KDX SDT controller URL.")
    parser.add_argument("--serial", default="LAB-FAKE-001", help="Server serial number.")
    parser.add_argument("--hostname", default="fake-dl380-01", help="Server hostname.")
    parser.add_argument("--vendor", default="HPE", help="Server vendor.")
    parser.add_argument("--model", default="ProLiant DL380 Gen11", help="Server model.")
    parser.add_argument("--product-name", default="ProLiant DL380 Gen11", help="Server product name.")
    parser.add_argument("--agent-ip", default="192.168.88.50", help="Temporary OS IP address.")
    parser.add_argument("--bmc-ip", default="192.168.88.151", help="BMC/iLO IP address.")
    parser.add_argument(
        "--inventory",
        default=str(Path(__file__).with_name("sample_inventory.json")),
        help="Path to inventory JSON file.",
    )
    parser.add_argument("--heartbeat-interval", type=int, default=60, help="Heartbeat interval in seconds.")
    parser.add_argument("--once", action="store_true", help="Register and upload inventory once, then exit.")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    inventory = load_inventory(Path(args.inventory))
    inventory.setdefault("system", {})
    inventory.setdefault("network", [])
    inventory.setdefault("bmc", {})
    inventory["system"]["serial_number"] = args.serial
    inventory["system"]["vendor"] = args.vendor
    inventory["system"]["model"] = args.model
    inventory["system"]["product_name"] = args.product_name
    inventory["bmc"]["ip"] = args.bmc_ip

    register_payload = {
        "serial_number": args.serial,
        "vendor": args.vendor,
        "model": args.model,
        "product_name": args.product_name,
        "hostname": args.hostname,
        "agent_ip": args.agent_ip,
        "bmc_ip": args.bmc_ip,
    }
    inventory_payload = {
        "serial_number": args.serial,
        "inventory": inventory,
    }
    heartbeat_payload = {
        "serial_number": args.serial,
        "agent_ip": args.agent_ip,
    }

    print(f"Registering {args.serial} to {args.controller}")
    print(json.dumps(post_json(args.controller, "/api/v1/agents/register", register_payload), indent=2))

    print("Uploading inventory")
    print(json.dumps(post_json(args.controller, "/api/v1/agents/inventory", inventory_payload), indent=2))

    if args.once:
        print("One-shot mode complete")
        return 0

    print(f"Sending heartbeat every {args.heartbeat_interval} seconds")
    while True:
        result = post_json(args.controller, "/api/v1/agents/heartbeat", heartbeat_payload)
        print(f"heartbeat ok: {result.get('serial_number', args.serial)}")
        time.sleep(args.heartbeat_interval)


if __name__ == "__main__":
    raise SystemExit(main())
