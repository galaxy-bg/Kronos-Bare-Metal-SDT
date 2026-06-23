# KDX Live ISO Build Runbook

This runbook describes the practical path for creating the first bootable KDX Live ISO and writing it to a USB stick for HPE bare-metal testing.

## Builder VM

Build the ISO on a Rocky Linux 9 VM, not on macOS.

Recommended:

| Resource | Value |
| --- | --- |
| OS | Rocky Linux 9.x |
| vCPU | 4 |
| RAM | 8 GB |
| Disk | 60 GB |
| Network | Internet access for Rocky and HPE repositories |

Install build tools:

```bash
dnf install -y lorax-lmc-novirt anaconda-tui livecd-tools git curl
```

Clone the repo:

```bash
mkdir -p /opt/kdx
cd /opt/kdx
git clone https://github.com/galaxy-bg/Kronos-Bare-Metal-SDT.git
cd Kronos-Bare-Metal-SDT
```

## Download HPE Tools

The first bootstrap profile uses HPE SDR packages from:

```text
https://downloads.linux.hpe.com/SDR/repo/spp/2021.10.0_supspp_rhel8.5_x86_64/
```

Download selected packages:

```bash
cd /opt/kdx/Kronos-Bare-Metal-SDT/iso/vendor/hpe
./download-hpe-tools.sh
```

If official RPM links for `ilorest` and `ssacli` are available:

```bash
ILOREST_RPM_URL="https://example/hpe/ilorest.rpm" \
SSACLI_RPM_URL="https://example/hpe/ssacli.rpm" \
./download-hpe-tools.sh
```

The RPMs stay under:

```text
iso/vendor/hpe/rpms/
```

They are bundled into the generated kickstart during ISO build and ignored by Git.

## Build ISO

From the repo root:

```bash
cd /opt/kdx/Kronos-Bare-Metal-SDT
BUILD_DIR=/var/tmp/kdx-live-iso ISO_NAME=kdx-live-rocky9.iso ./iso/scripts/build-rocky-live-iso.sh
```

Expected output:

```text
/var/tmp/kdx-live-iso/result/kdx-live-rocky9.iso
```

The build script embeds:

- `agent/kdx-agent.py`
- `agent/systemd/kdx-agent.service`
- `agent/config/agent.env.example`
- `iso/scripts/kdx-live-debug.sh`
- downloaded HPE RPMs under `iso/vendor/hpe/rpms/`

## Temporary Lab Access

During bare-metal development, the Live ISO enables local and SSH root login:

```text
user: root
password: HP1nv3nt
```

This is for isolated lab testing only. Remove or lock root access again before using the image outside the lab.

## Write ISO To USB From macOS

Find the USB disk:

```bash
diskutil list
```

Unmount it:

```bash
diskutil unmountDisk /dev/diskN
```

Write the ISO. Be very careful with `diskN`.

```bash
sudo dd if=kdx-live-rocky9.iso of=/dev/rdiskN bs=4m status=progress
sync
diskutil eject /dev/diskN
```

## First Hardware Test

1. Connect the HPE server data NIC to the lab network.
2. Confirm VLAN/DHCP can provide an IP on `192.168.88.0/24`.
3. Confirm controller is running at `192.168.88.240`.
4. Boot the server from the KDX Live USB.
5. Wait 2-3 minutes.
6. Open KDX UI and check that the server appears online.

Expected first result:

- Hostname defaults to `iLO-<serial>`.
- Agent IP is the DHCP address.
- BMC/iLO IP may still be empty.
- Inventory is uploaded.
- HPE tool presence can be checked in later agent inventory/action output.

## Troubleshooting

If the server does not appear:

- Check switch port VLAN and DHCP.
- Check whether the server booted from USB.
- Check whether the control plane is reachable from another host on VLAN 88.
- Temporarily test the same USB in a VM with bridged networking.
- Log in as `root` and run `kdx-live-debug`.
- Check the agent service with `systemctl status kdx-agent`.
- Check agent logs with `journalctl -u kdx-agent -f`.
- Run a one-shot registration manually with `kdx-agent --config /etc/kdx-agent/agent.env --once`.

If the ISO build fails:

- Verify builder VM has internet access.
- Verify `livemedia-creator` exists.
- Verify Rocky repository URLs are reachable.
- Build without HPE RPMs first, then add RPMs once base ISO boots.

## Next Step After Discovery

After a real HPE server registers successfully, implement the controller action queue and the first local HPE action:

```text
hpe_hponcfg_bootstrap_user
```

That action should create or reset:

```text
user: hpadmin
password: ChangeMe
role: Administrator
```
