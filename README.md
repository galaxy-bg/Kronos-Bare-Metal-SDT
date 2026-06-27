# KDX SDT

Bare Metal Discovery & Deployment Platform

KDX SDT is a centralized bare-metal server discovery, inventory, deployment, and lifecycle management platform.

Phase-1 MVP focuses on:

- Booting servers from a KDX Live USB
- Automatic registration to a central controller
- Hardware inventory collection
- Web-based server management portal
- HPE ProLiant discovery and safe iLO read-only operations through Redfish

Phase-1 intentionally does not include BIOS configuration, firmware updates, or OS deployment.

## Stack

- Backend: Python 3.12, FastAPI, SQLAlchemy, Alembic, Pydantic
- Frontend: React, TypeScript, Vite, Material UI
- Database: PostgreSQL 16
- Runtime: Docker Compose

## Documentation

- [Phase-1 MVP Scope](docs/phase-1.md)
- [HLD Context](docs/hld-context.md)
- [Lab Network Design](docs/lab-network-design.md)
- [Control Plane VM Runbook](docs/control-plane-vm-runbook.md)
- [Agent And Live USB Plan](docs/agent-liveusb-plan.md)
- [Golden Live ISO Design](docs/golden-live-iso-design.md)
- [Live ISO Build Runbook](docs/live-iso-build-runbook.md)

## Quick Start

```bash
docker compose up --build
```

Services:

- Web UI: http://localhost:3000
- Backend API: http://localhost:8000
- API docs: http://localhost:8000/docs
- PostgreSQL: localhost:5432

## Architecture

KronOS SDT is moving to a vendor-adapter architecture. The core platform stays
vendor-neutral: API routes and services should not call HPE, Dell, or OEM code
directly. Vendor behavior is selected through `AdapterRegistry` and executed
through a common `BaseVendorAdapter` interface.

Current backend layout:

```text
backend/app/
├── api/v1/routes/          # HTTP API
├── adapters/               # Vendor-specific Redfish/iLO/iDRAC behavior
│   ├── base.py             # BaseVendorAdapter contract
│   ├── registry.py         # Vendor/model/BMC adapter selection
│   ├── hpe/                # HPE ProLiant iLO implementation
│   ├── dell/               # Dell iDRAC stubs
│   ├── generic/            # Generic Redfish stubs
│   └── oem/                # OEM Redfish stubs
├── core/                   # config, database, logging, security helpers
├── models/                 # SQLAlchemy models
├── repositories/           # DB access helpers
├── schemas/                # Pydantic contracts
├── services/               # vendor-neutral business logic
├── utils/                  # shared DMI, network, Redfish helpers
└── workers/                # future job worker entry points
```

Current agent layout:

```text
agent/
├── kdx-agent.py            # current live ISO entry point
└── kronos_agent/           # target modular package
    ├── collectors/
    ├── client/
    └── services/
```

The live ISO still uses `agent/kdx-agent.py` for MVP compatibility. The
`agent/kronos_agent/` package is the target structure for the next agent split.

## Vendor Adapter Model

All vendor adapters implement:

- `detect()`
- `get_system_inventory()`
- `get_bios_config()`
- `set_bios_config()`
- `get_storage_inventory()`
- `get_raid_config()`
- `set_raid_config()`
- `get_firmware_inventory()`
- `set_uid_led()`
- `power_status()`
- `power_on()`
- `power_off()`
- `reboot()`

Normalized vendor values:

- `hpe`
- `dell`
- `generic_redfish`
- `oem`
- `unknown`

HPE is implemented first. Dell, OEM, and generic Redfish adapters are present as
safe Phase-1 stubs so the core platform can grow without hard-coding one vendor.

Example adapter-backed route:

```bash
curl http://localhost:8000/api/v1/servers/1/inventory/refresh
```

This loads the server from the DB, selects an adapter through `AdapterRegistry`,
calls `get_system_inventory()`, and stores the result. If BMC IP or credentials
are missing, it stores a mocked refresh result instead of failing the MVP flow.

## Current Phase-1 Scope

- Agent registration
- Heartbeat
- Inventory upload
- Server list and server detail UI
- Recent task tracking
- KDX agent version/build reporting in registration, heartbeat, server detail, and deployment reports
- HPE iLO credential validation and managed `hpadmin` workflow
- HPE iLO management IP, user, and license actions through the live agent
- Adapter-backed HPE Redfish read-only inventory refresh
- Placeholder BMC credential model with `credential_type=bmc`

## HPE Phase-2 Roadmap

- BIOS profile read/apply
- RAID profile read/apply
- Firmware inventory and update orchestration
- iLO Advanced license lifecycle reporting
- UID LED locate actions from the UI
- Power actions through queued jobs
- OS deployment workflow
- Durable job queue and worker execution model

## Agent Versioning

The live ISO agent reports its version during registration and every heartbeat.
The controller stores this under each server's `management_config_json.agent`
metadata and shows it in the server list, server detail page, and deployment
CSV report.

Current agent version is tracked in:

- `agent/VERSION`
- `agent/kdx-agent.py` as `AGENT_VERSION`
- [CHANGELOG.md](CHANGELOG.md)

Runtime overrides are available for lab builds:

```bash
KDX_AGENT_VERSION=1.1.0 KDX_AGENT_BUILD=lab-v6 ./agent/kdx-agent.py --once
```

Lab control plane profile:

- Control plane IP: `192.168.88.240`
- Agent controller URL: `http://192.168.88.240:8000`
- Operator Web UI: `http://192.168.88.240:3000`

## Agent VM Test

Install the real KDX agent on a Rocky Linux test VM:

```bash
bash agent/install-rocky-agent.sh
vi /etc/kdx-agent/agent.env
/usr/local/bin/kdx-agent --config /etc/kdx-agent/agent.env --once
systemctl start kdx-agent
```

## Fake Agent

Register a synthetic server against the lab control plane:

```bash
python3 agent/simulator/fake_agent.py \
  --controller http://192.168.88.240:8000 \
  --serial LAB-FAKE-001 \
  --hostname fake-dl380-01 \
  --agent-ip 192.168.88.50 \
  --bmc-ip 192.168.88.151 \
  --once
```

## Seed Example

```bash
curl -X POST http://localhost:8000/api/v1/agents/register \
  -H 'Content-Type: application/json' \
  -d '{
    "serial_number": "CZJ123456",
    "vendor": "HPE",
    "model": "ProLiant DL380 Gen11",
    "product_name": "ProLiant DL380 Gen11",
    "hostname": "dl380g11-01",
    "agent_ip": "192.168.1.50",
    "bmc_ip": "10.10.10.15"
  }'
```

## Repository Structure

```text
kdx-sdt/
├── agent/
├── backend/
│   ├── alembic/
│   ├── app/
│   ├── Dockerfile
│   └── requirements.txt
├── docs/
├── frontend/
│   ├── public/
│   ├── src/
│   └── Dockerfile
├── docker-compose.yml
└── README.md
```
