# KDX SDT Control Plane VM Runbook

This runbook describes how to run the KDX SDT control plane on a Rocky Linux lab VM connected to VLAN 88.

The MacBook is used as an admin workstation over VPN. The KDX SDT controller should run inside the lab network so KDX Live USB agents, fake agents and iLO/BMC interfaces can reach it consistently.

## Target Topology

```text
MacBook Admin Workstation
        |
       VPN
        |
+-------+-------------------------+
| Lab Network / VLAN 88           |
| 192.168.88.0/24                 |
|                                 |
|  +---------------------------+  |
|  | KDX SDT Control Plane VM  |  |
|  | 192.168.88.240           |  |
|  | API + UI + PostgreSQL     |  |
|  +------------+--------------+  |
|               |                 |
|  +------------+--------------+  |
|  | Bare-Metal Server         |  |
|  | KDX Live USB / Fake Agent |  |
|  | DHCP address on VLAN 88   |  |
|  +---------------------------+  |
+---------------------------------+
```

## VM Requirements

Recommended baseline:

| Resource | Value |
| --- | --- |
| OS | Rocky Linux 9.5 |
| vCPU | 2 |
| Memory | 4 GB minimum, 8 GB preferred |
| Disk | 40 GB minimum |
| NIC | VLAN 88 |
| Control-plane IP | `192.168.88.240/24` |

The control-plane IP must be excluded from DHCP or reserved on the switch. Bare-metal servers can use DHCP on VLAN 88 for their temporary agent IPs.

## Network Settings

Configure the VM with:

```text
IP address: 192.168.88.240
Subnet: 255.255.255.0
Gateway: lab gateway for VLAN 88
DNS: lab DNS or public resolver
```

The following URLs should be reachable from the lab network and from the MacBook VPN route:

```text
Backend API: http://192.168.88.240:8000
Web UI:      http://192.168.88.240:3000
API Docs:    http://192.168.88.240:8000/docs
```

## Install Runtime On Rocky Linux

Install Docker Engine and Compose plugin on the VM. Run these commands as `root` or with `sudo`.

```bash
dnf install -y dnf-plugins-core git curl ca-certificates
dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
docker version
docker compose version
```

## Deploy KDX SDT

```bash
mkdir -p /opt/kdx
cd /opt/kdx
git clone https://github.com/galaxy-bg/Kronos-Bare-Metal-SDT.git
cd Kronos-Bare-Metal-SDT
```

Create a lab `.env` file so the browser uses the VM IP instead of `localhost` for the backend API. This is required when opening the UI from the MacBook or another host.

```bash
cat > .env <<'EOF'
VITE_API_BASE_URL=http://192.168.88.240:8000
CORS_ORIGINS=http://192.168.88.240:3000,http://localhost:3000,http://127.0.0.1:3000
EOF
```

Start the stack:

```bash
docker compose up --build -d
```

Check service status:

```bash
docker compose ps
curl http://localhost:8000/health
curl http://192.168.88.240:8000/health
```

Expected health response:

```json
{"status":"ok"}
```

## Firewall

Allow the lab VLAN to reach the API and UI. Rocky Linux commonly uses `firewalld`.

```bash
firewall-cmd --permanent --add-port=8000/tcp
firewall-cmd --permanent --add-port=3000/tcp
firewall-cmd --reload
```

PostgreSQL port `5432` is exposed by Compose for local lab development, but agents do not need direct database access.

## Agent Controller URL

KDX agents and fake agents should use:

```env
KDX_CONTROLLER_URL=http://192.168.88.240:8000
KDX_AGENT_INTERFACE=eth0
KDX_HEARTBEAT_INTERVAL=60
```

## Register A Fake Server

Use this from the control-plane VM to simulate a KDX Live USB agent before testing real bare metal:

```bash
python3 agent/simulator/fake_agent.py \
  --controller http://192.168.88.240:8000 \
  --serial LAB-FAKE-VM-001 \
  --hostname fake-vm-dl380-01 \
  --agent-ip 192.168.88.60 \
  --bmc-ip 192.168.88.160 \
  --once
```

Then verify that the server is visible through the API and Web UI:

```bash
curl http://192.168.88.240:8000/api/v1/servers
```

## Validate From Another Host

From the MacBook or another lab host:

```bash
curl http://192.168.88.240:8000/health
open http://192.168.88.240:3000
```

If connected through VPN, make sure the VPN routes `192.168.88.0/24` to the lab. If the Web UI shows `Backend API is not reachable`, verify `.env`, run `docker compose up --build -d` again, and hard-refresh the browser.

## Stop Or Update

Stop services:

```bash
docker compose down
```

Update code and restart:

```bash
git pull
docker compose up --build -d
```
