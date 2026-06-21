# KDX SDT

Bare Metal Discovery & Deployment Platform

KDX SDT is a centralized bare-metal server discovery, inventory, deployment, and lifecycle management platform.

Phase-1 MVP focuses on:

- Booting servers from a KDX Live USB
- Automatic registration to a central controller
- Hardware inventory collection
- Web-based server management portal

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

## Quick Start

```bash
docker compose up --build
```

Services:

- Web UI: http://localhost:3000
- Backend API: http://localhost:8000
- API docs: http://localhost:8000/docs
- PostgreSQL: localhost:5432

Lab control plane profile:

- Control plane IP: `192.168.88.240`
- Agent controller URL: `http://192.168.88.240:8000`
- Operator Web UI: `http://192.168.88.240:3000`

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
