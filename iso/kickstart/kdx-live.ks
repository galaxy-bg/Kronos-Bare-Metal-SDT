# KDX SDT Rocky Live ISO kickstart draft.
# This is an initial scaffold and should be tested on a Rocky builder VM.

lang en_US.UTF-8
keyboard us
timezone Europe/Istanbul --utc
network --bootproto=dhcp --device=link --activate
rootpw --plaintext HP1nv3nt
selinux --enforcing
firewall --enabled
services --enabled=NetworkManager,sshd
zerombr
clearpart --all --initlabel
part / --fstype=ext4 --size=6144

url --url=https://dl.rockylinux.org/pub/rocky/9/BaseOS/x86_64/os/
repo --name=appstream --baseurl=https://dl.rockylinux.org/pub/rocky/9/AppStream/x86_64/os/

%packages
@^minimal-environment
NetworkManager
openssh-server
python3
dracut-live
syslinux-nonlinux
shim-x64
grub2-efi-x64
grub2-efi-x64-cdboot
efibootmgr
dosfstools
rocky-logos
memtest86+
dmidecode
iproute
util-linux
pciutils
usbutils
curl
jq
tar
gzip
lshw
%end

%post --log=/root/kdx-live-post.log
mkdir -p /etc/kdx-agent /usr/local/bin

cat > /etc/kdx-agent/agent.env <<'EOF'
KDX_CONTROLLER_URL=http://192.168.88.240:8000
KDX_AGENT_INTERFACE=
KDX_HEARTBEAT_INTERVAL=60
KDX_ENABLE_HPE_ACTIONS=true
KDX_ENABLE_RAID_ACTIONS=false
KDX_DEFAULT_ILO_USER=hpadmin
KDX_DEFAULT_ILO_PASSWORD=ChangeMe
EOF

chmod 0644 /etc/kdx-agent/agent.env

mkdir -p /etc/ssh/sshd_config.d
cat > /etc/ssh/sshd_config.d/01-kdx-lab.conf <<'EOF'
PermitRootLogin yes
PasswordAuthentication yes
EOF

firewall-offline-cmd --add-service=ssh || true
systemctl enable NetworkManager
systemctl enable sshd
systemctl enable kdx-agent || true
%end
