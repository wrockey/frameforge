"""SSDP discovery for Samsung Frame TVs on the local network."""
from __future__ import annotations

import re
import socket
from dataclasses import dataclass
from typing import List

import httpx

SSDP_ADDR = "239.255.255.250"
SSDP_PORT = 1900
SSDP_MX = 3
# 2024 Frames don't advertise the narrow RemoteControlReceiver ST, so we ask
# for everything on the network and filter responses by SERVER header.
SSDP_ST = "ssdp:all"

MSEARCH = (
    f"M-SEARCH * HTTP/1.1\r\n"
    f"HOST: {SSDP_ADDR}:{SSDP_PORT}\r\n"
    f'MAN: "ssdp:discover"\r\n'
    f"MX: {SSDP_MX}\r\n"
    f"ST: {SSDP_ST}\r\n\r\n"
).encode()


@dataclass
class DiscoveredTV:
    host: str
    model_name: str
    is_frame: bool
    mac: str | None = None


def _parse_header(packet: bytes, name: str) -> str | None:
    match = re.search(
        rb"^" + name.encode() + rb":\s*([^\r\n]+)",
        packet,
        re.IGNORECASE | re.MULTILINE,
    )
    return match.group(1).decode(errors="replace").strip() if match else None


def _is_samsung(server_header: str | None) -> bool:
    return bool(server_header and "samsung" in server_header.lower())


def _is_frame_model(model_name: str) -> bool:
    """Frame TV model names contain 'LS03'. e.g. 'QN43LS03DAFXZA'."""
    return "LS03" in model_name.upper()


def _fetch_device_info(host: str) -> tuple[str, str | None]:
    """Returns (model_name, mac) from the TV's HTTP info endpoint."""
    try:
        info = httpx.get(f"http://{host}:8001/api/v2/", timeout=3.0).json()
        device = info.get("device", {})
        return device.get("modelName", ""), device.get("wifiMac")
    except Exception:
        return "", None


def discover(timeout: float = 4.0) -> List[DiscoveredTV]:
    """Send SSDP M-SEARCH and return any Samsung TVs found, Frames first."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 2)
    sock.settimeout(timeout)
    sock.sendto(MSEARCH, (SSDP_ADDR, SSDP_PORT))

    samsung_hosts: set[str] = set()
    try:
        while True:
            data, addr = sock.recvfrom(8192)
            if addr[0] in samsung_hosts:
                continue
            if _is_samsung(_parse_header(data, "SERVER")):
                samsung_hosts.add(addr[0])
    except socket.timeout:
        pass
    finally:
        sock.close()

    results: list[DiscoveredTV] = []
    for host_addr in samsung_hosts:
        model, mac = _fetch_device_info(host_addr)
        if not model:
            continue  # speaks SSDP-as-Samsung but isn't a TV (NAS, soundbar, …)
        results.append(
            DiscoveredTV(
                host=host_addr,
                model_name=model,
                is_frame=_is_frame_model(model),
                mac=mac,
            )
        )
    results.sort(key=lambda r: not r.is_frame)
    return results
