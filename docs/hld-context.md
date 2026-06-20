# KronOS SDT HLD Context

This document captures the initial high-level design context for KronOS SDT Phase-1.

KronOS SDT is designed around a central controller and multiple bare-metal servers booted with kronosOS from a Live USB image. The first goal is discovery and inventory, not provisioning or lifecycle automation.

## Logical Topology

```text
                                      +------------------+
                                      |    OOTB VLAN     |
                                      +--------+---------+
                                               |
                         +---------------------+---------------------+
                         |                     |                     |
                    +----+----+           +----+----+           +----+----+
                    |   ILO   |           |   ILO   |           |   ILO   |
                    | Server  |           | Server  |           | Server  |
                    | kronosOS|           | kronosOS|           | kronosOS|
                    +----+----+           +----+----+           +----+----+
                         | eth0                | eth0                | eth0
                         +---------------------+---------------------+
                                               |
                                      +--------+---------+
                                      | Managed VLAN     |
                                      | 192.168.88.0/24  |
                                      +--------+---------+
                                               |
                                      +--------+---------+
                                      | Control Node     |
                                      | 192.168.88.240   |
                                      +------------------+
```

## Network Segments

### OOTB VLAN

The OOTB VLAN is used for out-of-the-box management connectivity.

Expected devices on this network:

- Server BMC interfaces
- HPE iLO controllers for the initial target platform
- Future Dell iDRAC and other vendor BMC controllers

Phase-1 only detects and stores BMC information. It does not perform power control, Redfish workflows, firmware updates, or BIOS configuration.

### Managed VLAN with DHCP

The managed VLAN provides network connectivity to the operating system booted from the KronOS Live USB.

Initial lab network:

- Network: `192.168.88.0/24`
- Control plane IP: `192.168.88.240`
- DHCP provider: lab switch or upstream DHCP service
- PXE/TFTP: not required for Phase-1

Expected behavior:

- The server boots into kronosOS from Live USB.
- The `eth0` interface receives an IP address from DHCP.
- The KronOS Agent uses this network path to reach the Control Node API at `http://192.168.88.240:8000`.
- The agent registers the server, uploads inventory, and sends heartbeats.

## Control Node

The Control Node runs the central KronOS SDT services.

In the initial lab, the Control Node is the MacBook M2 connected to the managed lab VLAN with static IP `192.168.88.240`.

Phase-1 services:

- FastAPI backend
- PostgreSQL database
- React web UI

Responsibilities:

- Accept agent registration requests
- Store server identity and network information
- Store hardware inventory snapshots
- Track online and offline state through heartbeat timestamps
- Expose server inventory through REST APIs
- Provide a web portal for discovered servers

## kronosOS Live Environment

`kronosOS` represents the temporary operating environment booted on target bare-metal servers.

Phase-1 agent responsibilities:

- Detect hostname
- Detect serial number
- Detect product ID or product name
- Detect discovered IP address
- Collect DMI information
- Collect CPU, memory, disk, and NIC inventory
- Detect BMC information where available
- Register to the Control Node
- Upload inventory to the Control Node
- Send periodic heartbeat

## Phase-1 Discovery Data

The HLD identifies the first discovery contract as a simple client record.

```text
Client
├── hostname       string
├── serial_number  string
├── product_id     string
└── discovered_ip  string
```

Current backend schema extends this baseline for the web UI and future lifecycle features:

```text
servers
├── id
├── uuid
├── serial_number
├── vendor
├── model
├── product_name
├── hostname
├── agent_ip
├── bmc_ip
├── status
├── last_seen
├── created_at
└── updated_at

inventories
├── id
├── server_id
├── inventory_json
└── created_at
```

Mapping from HLD to backend:

| HLD Field | Backend Field | Notes |
| --- | --- | --- |
| `hostname` | `servers.hostname` | OS hostname from kronosOS |
| `serial_number` | `servers.serial_number` | Primary identity for registration updates |
| `product_id` | `servers.product_name` or inventory JSON | Vendor-specific value can be normalized later |
| `discovered_ip` | `servers.agent_ip` | IP address assigned on managed VLAN |
| `ILO` | `servers.bmc_ip` and inventory JSON | Phase-1 stores detected BMC data only |

## Phase-1 Runtime Flow

1. Server boots from KronOS Live USB into kronosOS.
2. `eth0` receives an address from DHCP on the managed VLAN.
3. KronOS Agent collects identity and hardware inventory.
4. Agent calls `POST http://192.168.88.240:8000/api/v1/agents/register`.
5. Control Node creates or updates the server record.
6. Agent calls `POST http://192.168.88.240:8000/api/v1/agents/inventory`.
7. Agent periodically calls `POST http://192.168.88.240:8000/api/v1/agents/heartbeat`.
8. Web UI lists discovered servers and displays inventory details.

## Explicitly Out of Scope for Phase-1

- BIOS profile management
- RAID configuration
- Firmware management
- OS deployment
- Kickstart or Ubuntu Autoinstall generation
- VMware ESXi deployment
- Redfish power control
- Remote reboot workflows

These capabilities remain planned for later phases.
