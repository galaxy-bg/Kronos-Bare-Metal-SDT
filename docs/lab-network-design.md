# KDX SDT Lab Network Design

This document defines the first lab network profile for KDX SDT Phase-1.

## Lab Profile

The initial lab uses an existing switch and a managed network in the `192.168.88.0/24` subnet.

```text
Managed Lab VLAN: 192.168.88.0/24
Control Plane IP: 192.168.88.240
DHCP Provider: Lab switch or upstream DHCP service
Boot Method: KDX Live USB
PXE/TFTP: Not required for Phase-1
```

## Topology

```text
                      +-----------------------------+
                      | Lab Switch / Managed VLAN   |
                      | 192.168.88.0/24             |
                      | DHCP enabled                |
                      +--------------+--------------+
                                     |
             +-----------------------+-----------------------+
             |                                               |
  +----------+-----------+                       +-----------+----------+
  | Control Plane VM     |                       | Bare-Metal Server    |
  | 192.168.88.240       |                       | kdxOS Live USB       |
  | 192.168.88.240       |                       | eth0 via DHCP        |
  +----------+-----------+                       +-----------+----------+
             |                                               |
             | API / UI / DB                                 | Agent register
             |                                               |
             +------------------- HTTP API ------------------+
```

## Control Plane Node

The control plane node is a lab VM connected to VLAN 88. The MacBook is used as an admin workstation over VPN.

Required network settings:

- Static IP: `192.168.88.240`
- Subnet: `255.255.255.0`
- Network: `192.168.88.0/24`
- Controller API URL for agents: `http://192.168.88.240:8000`
- Web UI URL for operators: `http://192.168.88.240:3000`

The control plane runs:

- FastAPI backend
- PostgreSQL database
- React web UI

These services can initially run with Docker Compose. Kubernetes deployment profiles can be added later with k3d/k3s for local development and RKE2 for production-like clusters.

See [Control Plane VM Runbook](control-plane-vm-runbook.md) for VM installation and startup steps.

## Bare-Metal Server Flow

1. Server boots from KDX Live USB.
2. `eth0` connects to the managed lab VLAN.
3. Server receives an IP address from DHCP.
4. KDX Agent reads the controller URL from its local configuration.
5. Agent registers to `http://192.168.88.240:8000/api/v1/agents/register`.
6. Agent uploads inventory to `http://192.168.88.240:8000/api/v1/agents/inventory`.
7. Agent sends heartbeat to `http://192.168.88.240:8000/api/v1/agents/heartbeat`.

## Agent Configuration

For the MVP, the controller URL is explicit and static.

```env
KDX_CONTROLLER_URL=http://192.168.88.240:8000
KDX_AGENT_INTERFACE=eth0
KDX_HEARTBEAT_INTERVAL=60
```

Future discovery options:

- DHCP vendor option for controller URL
- DNS name such as `kdx-controller.lab`
- Redundant controller endpoint list

## Addressing Rules

Recommended lab reservations:

| Purpose | Address |
| --- | --- |
| KDX control plane | `192.168.88.240` |
| DHCP pool | Switch-managed |
| Bare-metal agents | DHCP-assigned |
| BMC/iLO interfaces | DHCP or reserved IPs, depending on lab policy |

The control plane IP should be excluded from the DHCP pool or reserved on the switch.

## Phase-1 Notes

- The lab switch provides DHCP.
- MacBook does not run DHCP or control-plane services for this profile.
- PXE, TFTP, and network boot are not required.
- USB boot is the only Phase-1 boot method.
- The agent must be able to reach `192.168.88.240:8000` from its DHCP-assigned address.
