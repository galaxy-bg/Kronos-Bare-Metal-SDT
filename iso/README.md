# KDX Live ISO

This directory will contain the Rocky Linux based KDX Live ISO build assets.

Initial direction:

- Build on a Rocky Linux 9 builder VM.
- Use kickstart for repeatable image creation.
- Install the KDX agent as a systemd service.
- Include HPE iLOrest and `ssacli` packages for HPE ProLiant lab testing.
- Configure the live agent to refresh inventory every 300 seconds so BMC/IP details can be filled after credential validation.

## Current iLO Defaults

The live ISO agent is configured with:

- Controller: `http://192.168.88.240:8000`
- Heartbeat interval: `60` seconds
- Inventory refresh interval: `300` seconds
- Managed iLO user: `hpadmin`
- Managed iLO password: `HP1nv3nt`

First boot can show BMC IP as `null` when iLO credentials are not available yet. After the `Administrator` credential is validated or the managed `hpadmin` user is created, Redfish is used to read the iLO management network and update the control plane.

See `docs/golden-live-iso-design.md`.

Build and USB write steps are documented in `docs/live-iso-build-runbook.md`.
