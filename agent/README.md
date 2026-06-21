# KDX Agent

The Phase-1 agent will run from a bootable Linux USB image and communicate with the KDX Controller.

Initial responsibilities:

- Collect DMI data
- Collect CPU, memory, disk, and NIC inventory
- Detect BMC information where available
- Register to the controller
- Send periodic heartbeat
- Upload inventory snapshots
