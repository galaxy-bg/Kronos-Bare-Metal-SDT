from __future__ import annotations

import base64
import json
import ssl
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class RedfishError(RuntimeError):
    pass


def basic_auth_header(username: str, password: str) -> str:
    token = base64.b64encode(f"{username}:{password}".encode("utf-8")).decode("ascii")
    return f"Basic {token}"


def redfish_get_json(
    base_url: str,
    path: str,
    username: str,
    password: str,
    timeout: int = 10,
    verify_tls: bool = False,
) -> dict[str, Any]:
    url = base_url.rstrip("/") + "/" + path.lstrip("/")
    headers = {"Accept": "application/json", "Authorization": basic_auth_header(username, password)}
    request = Request(url, headers=headers, method="GET")
    context = None if verify_tls else ssl._create_unverified_context()
    try:
        with urlopen(request, timeout=timeout, context=context) as response:
            body = response.read().decode("utf-8")
    except (HTTPError, URLError, TimeoutError) as exc:
        raise RedfishError(str(exc)) from exc
    try:
        return json.loads(body)
    except json.JSONDecodeError as exc:
        raise RedfishError(f"Invalid Redfish JSON from {url}") from exc


def redfish_patch_json(
    base_url: str,
    path: str,
    username: str,
    password: str,
    payload: dict[str, Any],
    timeout: int = 10,
    verify_tls: bool = False,
) -> dict[str, Any]:
    url = base_url.rstrip("/") + "/" + path.lstrip("/")
    headers = {
        "Accept": "application/json",
        "Authorization": basic_auth_header(username, password),
        "Content-Type": "application/json",
    }
    request = Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="PATCH")
    context = None if verify_tls else ssl._create_unverified_context()
    try:
        with urlopen(request, timeout=timeout, context=context) as response:
            body = response.read().decode("utf-8")
    except (HTTPError, URLError, TimeoutError) as exc:
        raise RedfishError(str(exc)) from exc
    if not body:
        return {"status": "accepted"}
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        return {"status": "accepted", "raw": body}


def redfish_post_json(
    base_url: str,
    path: str,
    username: str,
    password: str,
    payload: dict[str, Any],
    timeout: int = 30,
    verify_tls: bool = False,
) -> dict[str, Any]:
    url = base_url.rstrip("/") + "/" + path.lstrip("/")
    headers = {
        "Accept": "application/json",
        "Authorization": basic_auth_header(username, password),
        "Content-Type": "application/json",
    }
    request = Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
    context = None if verify_tls else ssl._create_unverified_context()
    try:
        with urlopen(request, timeout=timeout, context=context) as response:
            body = response.read().decode("utf-8")
            location = response.headers.get("Location")
            status = response.status
    except (HTTPError, URLError, TimeoutError) as exc:
        raise RedfishError(str(exc)) from exc
    if not body:
        result: dict[str, Any] = {"status": "accepted", "http_status": status}
        if location:
            result["location"] = location
        return result
    try:
        result = json.loads(body)
    except json.JSONDecodeError:
        result = {"status": "accepted", "raw": body}
    if location:
        result.setdefault("location", location)
    result.setdefault("http_status", status)
    return result


def redfish_delete_json(
    base_url: str,
    path: str,
    username: str,
    password: str,
    timeout: int = 30,
    verify_tls: bool = False,
) -> dict[str, Any]:
    url = base_url.rstrip("/") + "/" + path.lstrip("/")
    headers = {"Accept": "application/json", "Authorization": basic_auth_header(username, password)}
    request = Request(url, headers=headers, method="DELETE")
    context = None if verify_tls else ssl._create_unverified_context()
    try:
        with urlopen(request, timeout=timeout, context=context) as response:
            body = response.read().decode("utf-8")
            status = response.status
    except (HTTPError, URLError, TimeoutError) as exc:
        raise RedfishError(str(exc)) from exc
    if not body:
        return {"status": "accepted", "http_status": status}
    try:
        result = json.loads(body)
    except json.JSONDecodeError:
        result = {"status": "accepted", "raw": body}
    result.setdefault("http_status", status)
    return result
