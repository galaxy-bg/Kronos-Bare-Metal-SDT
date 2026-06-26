# KDX Agent

The Phase-1 agent will run from a bootable Linux USB image and communicate with the KDX Controller.

Initial responsibilities:

- Collect DMI data
- Collect CPU, memory, disk, and NIC inventory
- Detect BMC information where available
- Register to the controller
- Send periodic heartbeat
- Upload inventory snapshots
- Refresh inventory periodically so first-boot gaps can be filled later

## Current Implementation

`agent/kdx-agent.py` is the first real agent path. It can run on a Rocky Linux VM or on a future Rocky-based Live USB image.

It collects inventory from the running OS and posts it to the controller:

- `/sys/class/dmi/id` and `dmidecode` for system identity
- `/proc/cpuinfo` for CPU data
- `/proc/meminfo` for memory
- `lsblk` for disks
- `ip -j addr` for network interfaces

VM tests can use predefined values from `/etc/kdx-agent/agent.env` for fields that are not realistic inside a VM, such as HPE serial number or BMC details.

## HPE iLO Discovery Flow

On first boot, the agent may not know the iLO/BMC IP address. This is expected on newer HPE systems when local Redfish requires a valid iLO user before exposing management network settings. In that state the inventory reports `pending-management-network-config`.

The control plane can validate the factory `Administrator` credential or create the managed `hpadmin` user. Successful Redfish validation reads the current iLO management network and stores the discovered BMC IP. If `hpadmin` is created through Redfish, the same action also refreshes BMC network details.

After the initial upload, the agent refreshes full inventory every `KDX_INVENTORY_REFRESH_INTERVAL` seconds, default `300`. Set it to `0` to disable periodic inventory refresh.

## Rocky VM Test

```bash
bash agent/install-rocky-agent.sh
vi /etc/kdx-agent/agent.env
/usr/local/bin/kdx-agent --config /etc/kdx-agent/agent.env --once
systemctl start kdx-agent
```

See [Agent And Live USB Plan](../docs/agent-liveusb-plan.md).
