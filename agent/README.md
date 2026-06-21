# KDX Agent

The Phase-1 agent will run from a bootable Linux USB image and communicate with the KDX Controller.

Initial responsibilities:

- Collect DMI data
- Collect CPU, memory, disk, and NIC inventory
- Detect BMC information where available
- Register to the controller
- Send periodic heartbeat
- Upload inventory snapshots

## Current Implementation

`agent/kdx-agent.py` is the first real agent path. It can run on a Rocky Linux VM or on a future Rocky-based Live USB image.

It collects inventory from the running OS and posts it to the controller:

- `/sys/class/dmi/id` and `dmidecode` for system identity
- `/proc/cpuinfo` for CPU data
- `/proc/meminfo` for memory
- `lsblk` for disks
- `ip -j addr` for network interfaces

VM tests can use predefined values from `/etc/kdx-agent/agent.env` for fields that are not realistic inside a VM, such as HPE serial number or BMC details.

## Rocky VM Test

```bash
bash agent/install-rocky-agent.sh
vi /etc/kdx-agent/agent.env
/usr/local/bin/kdx-agent --config /etc/kdx-agent/agent.env --once
systemctl start kdx-agent
```

See [Agent And Live USB Plan](../docs/agent-liveusb-plan.md).
