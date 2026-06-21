# KDX Agent And Live USB Plan

Phase-1 needs a real agent path that can be tested in a Rocky Linux VM before it is embedded into a bootable USB image.

## Recommended Flow

1. Run the KDX control plane on the lab VM at `192.168.88.240`.
2. Create a Rocky Linux test VM on the same lab network.
3. Install the KDX agent as a systemd service.
4. Let the agent collect real VM inventory and register to the controller.
5. Use predefined values only where a VM cannot provide bare-metal data, such as HPE serial format or BMC/iLO IP.
6. Move the same agent and systemd unit into a Rocky Live USB image.

## Why This Is Better Than The Fake Agent

The fake agent only posts a static payload. The KDX agent reads live OS data:

- DMI vendor, model, product name and serial
- Active agent IP
- CPU information
- Memory size
- Disk inventory
- Network interfaces and MAC addresses
- BMC placeholder or predefined BMC values

For VM testing, set `KDX_SERIAL_NUMBER`, `KDX_VENDOR`, `KDX_MODEL` and `KDX_PRODUCT_NAME` in `/etc/kdx-agent/agent.env`. On real HPE hardware, the agent should read these from `/sys/class/dmi/id` or `dmidecode`.

## Rocky VM Test

Clone the repo on a Rocky Linux VM:

```bash
cd /opt
git clone https://github.com/galaxy-bg/Kronos-Bare-Metal-SDT.git
cd Kronos-Bare-Metal-SDT
```

Install the agent:

```bash
bash agent/install-rocky-agent.sh
```

Edit the agent config:

```bash
vi /etc/kdx-agent/agent.env
```

Minimal VM test config:

```env
KDX_CONTROLLER_URL=http://192.168.88.240:8000
KDX_AGENT_INTERFACE=
KDX_HEARTBEAT_INTERVAL=60
KDX_SERIAL_NUMBER=CZJVMTEST001
KDX_VENDOR=HPE
KDX_MODEL=ProLiant DL380 Gen11
KDX_PRODUCT_NAME=P42124-B21
KDX_HOSTNAME=iLO-CZJVMTEST001
KDX_BMC_VENDOR=HPE
KDX_BMC_TYPE=iLO
KDX_BMC_IP=
```

Run one-shot registration first:

```bash
/usr/local/bin/kdx-agent --config /etc/kdx-agent/agent.env --once
```

Then run as a service:

```bash
systemctl start kdx-agent
systemctl status kdx-agent
journalctl -u kdx-agent -f
```

## Live USB Direction

The Live USB should be Rocky-based and include:

- Python 3
- `dmidecode`
- `iproute`
- `util-linux`
- `pciutils`
- `lshw` if available
- KDX agent script at `/usr/local/bin/kdx-agent`
- KDX agent config at `/etc/kdx-agent/agent.env`
- systemd unit `kdx-agent.service`

The USB boot flow should be:

1. Network comes up through DHCP.
2. `network-online.target` is reached.
3. `kdx-agent.service` starts.
4. Agent discovers serial, vendor, model, current OS IP and inventory.
5. Agent registers to `http://192.168.88.240:8000`.
6. Agent uploads inventory.
7. Agent keeps heartbeat running.

## BMC / iLO Network Configuration Direction

First-time BMC network configuration should be executed from the Live USB agent, not directly from controller Redfish. Redfish normally requires a reachable BMC IP first.

For HPE:

- Use local `ilorest` from the booted OS when possible.
- Controller stores requested management profile: IP, subnet, gateway, DNS, NTP and VLAN.
- Agent later polls for pending actions and runs the vendor-specific script locally.
- Once the iLO IP is configured, the controller can move to Redfish-based lifecycle operations.

For Dell:

- Use local RACADM where available.
- Redfish becomes the steady-state interface after iDRAC is reachable.

## Next Backend Step

Add an action queue:

```text
server_actions
- id
- server_id
- action_type
- payload_json
- status
- result_json
- created_at
- updated_at
```

Initial action type:

```text
set_management_network
```

Initial payload:

```json
{
  "ip": "192.168.88.163",
  "subnet": "255.255.255.0",
  "gateway": "192.168.88.1",
  "dns": "192.168.88.1,8.8.8.8",
  "ntp": "pool.ntp.org",
  "vlan": "88"
}
```
