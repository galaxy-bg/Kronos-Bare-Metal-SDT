# KDX Golden Live ISO Design

The KDX Live ISO is the bootable agent environment used for bare-metal discovery and local vendor tooling. The first target is HPE ProLiant Gen10/Gen11/Gen12.

## Goal

Build a Rocky Linux based Live ISO that can:

- Boot on bare-metal servers without installing an OS.
- Bring up network with DHCP.
- Start `kdx-agent.service` automatically.
- Register the server to the KDX controller.
- Collect hardware inventory.
- Include HPE tools required for local iLO and Smart Array operations.
- Execute controller-approved actions such as iLO user creation or management network configuration.

## Tooling To Include

Base OS tools:

- Python 3
- `dmidecode`
- `iproute`
- `util-linux`
- `pciutils`
- `usbutils`
- `lshw`
- `jq`
- `curl`
- `tar`
- `gzip`

HPE tools:

- HPE iLOrest
- HPE Smart Storage Administrator CLI, normally `ssacli`
- HPE `hponcfg`, useful for local iLO bootstrap when iLO IP and credentials are unknown
- HPE `amsd` and `hp-health`, useful for HPE hardware health/inventory context
- Optional later: `storcli` for non-HPE/Broadcom controllers if required

Keep HPE binary packages under `iso/vendor/hpe/` in the repo or in a private artifact store. Do not download vendor packages during every ISO build unless package URLs are pinned and the build host has stable internet.

## Security Defaults

The ISO is powerful because it can configure management controllers and storage. Keep the first lab version simple, but make the boundaries clear:

- The default iLO user can be `hpadmin`.
- The lab password can be `ChangeMe`.
- The agent config must support disabling mutating actions.
- RAID configuration must be opt-in and action-based.
- The agent must never auto-create arrays or wipe disks during discovery.
- Every mutating action should be requested by the controller and reported back with structured output.

Recommended ISO environment flags:

```env
KDX_CONTROLLER_URL=http://192.168.88.240:8000
KDX_AGENT_INTERFACE=
KDX_HEARTBEAT_INTERVAL=60
KDX_ENABLE_HPE_ACTIONS=true
KDX_ENABLE_RAID_ACTIONS=false
KDX_DEFAULT_ILO_USER=hpadmin
KDX_DEFAULT_ILO_PASSWORD=ChangeMe
```

## Action Phases

### Phase A: Discovery ISO

This is the first ISO we should build.

Capabilities:

- Boot Rocky Live.
- DHCP on the lab VLAN.
- Start KDX agent.
- Register server.
- Upload DMI, CPU, memory, disk and NIC inventory.
- Detect whether `ilorest` and `ssacli` are present.

No mutating hardware actions yet.

### Phase B: iLO Bootstrap Actions

Add controller action support for HPE iLO bootstrap:

- Create or update local iLO user `hpadmin`.
- Set iLO network profile: IP, subnet, gateway, DNS, NTP and VLAN.
- Validate iLO reachability after configuration.

Actions:

```text
hpe_create_ilo_user
hpe_set_ilo_network
```

### Phase C: Storage Read-Only Inventory

Use `ssacli` for read-only storage inventory:

- Controller model
- Physical drives
- Logical drives
- Current RAID levels
- Disk health

Action:

```text
hpe_refresh_storage_inventory
```

### Phase D: RAID Configuration

RAID configuration should come after inventory and approval workflow.

Action:

```text
hpe_apply_raid_profile
```

Rules:

- Require explicit confirmation in the Web UI.
- Show which disks will be erased.
- Store requested profile and result.
- Do not execute from automatic discovery.

## Golden ISO Build Approach

Use a Rocky Linux build VM. Building an ISO on macOS directly is not ideal because the standard Linux image build tools expect Linux kernel features.

Recommended builder:

- Rocky Linux 9 VM
- 4 vCPU
- 8 GB RAM
- 60 GB disk

Install build tools:

```bash
dnf install -y lorax-lmc-novirt anaconda-tui livecd-tools git curl
```

Recommended repo structure:

```text
iso/
├── README.md
├── kickstart/
│   └── kdx-live.ks
├── scripts/
│   └── build-rocky-live-iso.sh
└── vendor/
    └── hpe/
        ├── ilorest.rpm
        └── ssacli.rpm
```

The kickstart should:

1. Install Rocky minimal/live packages.
2. Install required base tools.
3. Copy `agent/kdx-agent.py` to `/usr/local/bin/kdx-agent`.
4. Copy `agent/systemd/kdx-agent.service`.
5. Copy `/etc/kdx-agent/agent.env`.
6. Install HPE RPMs if present.
7. Enable `NetworkManager`.
8. Enable `kdx-agent.service`.
9. Disable unnecessary services.

## First Lab Build

For the first version, do not block on perfect ISO automation. The fastest safe path is:

1. Build a Rocky VM that behaves like the future Live ISO.
2. Install `kdx-agent`.
3. Download selected HPE RPMs with `iso/vendor/hpe/download-hpe-tools.sh`.
4. Add HPE RPMs manually.
5. Validate `ilorest --version`, `hponcfg -h` and `ssacli version`.
6. Snapshot this VM as the "golden agent VM".
7. Convert the same package list and files into kickstart.
8. Build the ISO.
9. Boot the ISO in a VM.
10. Boot the ISO on one HPE server.

## Validation Checklist

The ISO is acceptable when:

- It boots without manual login.
- It receives a DHCP IP.
- It can reach `http://192.168.88.240:8000/health`.
- `kdx-agent.service` is active.
- The server appears in KDX UI as online.
- Inventory upload succeeds.
- `ilorest` exists and runs.
- `ssacli` exists and runs.
- No RAID or iLO mutation happens automatically.

## Important Design Choice

Use Redfish after the iLO IP is known. Use local HPE tooling from the Live ISO for first bootstrap because Redfish usually needs an already reachable management IP.
