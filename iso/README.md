# KDX Live ISO

This directory will contain the Rocky Linux based KDX Live ISO build assets.

Initial direction:

- Build on a Rocky Linux 9 builder VM.
- Use kickstart for repeatable image creation.
- Install the KDX agent as a systemd service.
- Include HPE iLOrest and `ssacli` packages for HPE ProLiant lab testing.

See `docs/golden-live-iso-design.md`.

Build and USB write steps are documented in `docs/live-iso-build-runbook.md`.
