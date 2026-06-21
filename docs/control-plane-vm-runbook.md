# KDX SDT Control Plane VM Runbook

This runbook describes how to run the KDX SDT control plane on a lab VM connected to VLAN 88.

The MacBook is used as an admin workstation over VPN. The KDX SDT controller should run inside the lab network so bare-metal servers and iLO/BMC interfaces can reach it consistently.

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
| OS | Ubuntu Server 24.04 LTS |
| vCPU | 2 |
| Memory | 4 GB minimum, 8 GB preferred |
| Disk | 40 GB minimum |
| NIC | VLAN 88 |
| Static IP | `192.168.88.240/24` |

The control-plane IP must be excluded from DHCP or reserved on the switch.

## Network Settings

Configure the VM with:

```text
IP address: 192.168.88.240
Subnet: 255.255.255.0
Gateway: lab gateway for VLAN 88
DNS: lab DNS or public resolver
```

The following URLs should be reachable from the lab network:

```text
Backend API: http://192.168.88.240:8000
Web UI:      http://192.168.88.240:3000
API Docs:    http://192.168.88.240:8000/docs
```

## Install Runtime

Install Docker Engine and Compose plugin on the VM.

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"
```

Log out and back in after adding the user to the `docker` group.

## Deploy KDX SDT

```bash
git clone https://github.com/galaxy-bg/Kronos-Bare-Metal-SDT.git
cd Kronos-Bare-Metal-SDT
docker compose up --build -d
```

Check service status:

```bash
docker compose ps
curl http://192.168.88.240:8000/health
```

Expected health response:

```json
{"status":"ok"}
```

## Firewall

Allow the lab VLAN to reach the API and UI.

```bash
sudo ufw allow from 192.168.88.0/24 to any port 8000 proto tcp
sudo ufw allow from 192.168.88.0/24 to any port 3000 proto tcp
```

PostgreSQL port `5432` is exposed by Compose for local lab development, but agents do not need direct database access.

## Agent Controller URL

KDX agents and fake agents should use:

```env
KDX_CONTROLLER_URL=http://192.168.88.240:8000
KDX_AGENT_INTERFACE=eth0
KDX_HEARTBEAT_INTERVAL=60
```

## Validate From Another Host

From the MacBook or another lab host:

```bash
curl http://192.168.88.240:8000/health
open http://192.168.88.240:3000
```

If connected through VPN, make sure the VPN routes `192.168.88.0/24` to the lab.

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
