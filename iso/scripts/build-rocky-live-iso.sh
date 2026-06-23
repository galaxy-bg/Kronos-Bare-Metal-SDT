#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BUILD_DIR="${BUILD_DIR:-/var/tmp/kdx-live-iso}"
KS_FILE="${KS_FILE:-${ROOT_DIR}/iso/kickstart/kdx-live.ks}"
KDX_PRODUCT_NAME="${KDX_PRODUCT_NAME:-KDX Server Deployment Toolkit}"
KDX_PRODUCT_VERSION="${KDX_PRODUCT_VERSION:-v1.0}"
ISO_NAME="${ISO_NAME:-kdx-server-deployment-toolkit-v1.0.iso}"
LIVE_ROOTFS_SIZE_GB="${LIVE_ROOTFS_SIZE_GB:-6}"
LORAX_TEMPLATES="${LORAX_TEMPLATES:-${ROOT_DIR}/iso/lorax-templates}"
GENERATED_DIR="${BUILD_DIR}/generated"
BUNDLE_FILE="${GENERATED_DIR}/kdx-live-bundle.tgz"
GENERATED_KS="${GENERATED_DIR}/kdx-live.generated.ks"

if ! command -v livemedia-creator >/dev/null 2>&1; then
  echo "livemedia-creator is required. Install lorax-lmc-novirt on a Rocky Linux builder VM." >&2
  exit 1
fi

mkdir -p "${GENERATED_DIR}"
rm -rf "${BUILD_DIR}/result"

tar -czf "${BUNDLE_FILE}" \
  -C "${ROOT_DIR}" \
  agent/kdx-agent.py \
  agent/systemd/kdx-agent.service \
  agent/config/agent.env.example \
  iso/scripts/kdx-live-debug.sh \
  iso/vendor/hpe/rpms

cp "${KS_FILE}" "${GENERATED_KS}"

cat >> "${GENERATED_KS}" <<'KS_EOF'

%post --log=/root/kdx-live-bundle.log
mkdir -p /opt/kdx-live-bundle /etc/kdx-agent /usr/local/bin
base64 -d > /root/kdx-live-bundle.tgz <<'KDX_BUNDLE_EOF'
KS_EOF

base64 -w 76 "${BUNDLE_FILE}" >> "${GENERATED_KS}"

cat >> "${GENERATED_KS}" <<'KS_EOF'
KDX_BUNDLE_EOF

tar -xzf /root/kdx-live-bundle.tgz -C /opt/kdx-live-bundle
install -m 0755 /opt/kdx-live-bundle/agent/kdx-agent.py /usr/local/bin/kdx-agent
install -m 0755 /opt/kdx-live-bundle/iso/scripts/kdx-live-debug.sh /usr/local/bin/kdx-live-debug
install -m 0644 /opt/kdx-live-bundle/agent/systemd/kdx-agent.service /etc/systemd/system/kdx-agent.service

if ls /opt/kdx-live-bundle/iso/vendor/hpe/rpms/*.rpm >/dev/null 2>&1; then
  dnf install -y --disablerepo='*' /opt/kdx-live-bundle/iso/vendor/hpe/rpms/*.rpm || \
    rpm -Uvh --nodeps /opt/kdx-live-bundle/iso/vendor/hpe/rpms/*.rpm || true
fi

systemctl daemon-reload
systemctl enable kdx-agent
%end
KS_EOF

LORAX_TEMPLATE_ARGS=()
if [[ -d "${LORAX_TEMPLATES}" ]]; then
  LORAX_TEMPLATE_ARGS=(--lorax-templates "${LORAX_TEMPLATES}")
fi

livemedia-creator \
  --make-iso \
  --no-virt \
  --ks "${GENERATED_KS}" \
  "${LORAX_TEMPLATE_ARGS[@]}" \
  --live-rootfs-size "${LIVE_ROOTFS_SIZE_GB}" \
  --resultdir "${BUILD_DIR}/result" \
  --project "${KDX_PRODUCT_NAME}" \
  --releasever "${KDX_PRODUCT_VERSION}" \
  --volid "KDX-SDT-1-0" \
  --iso-only \
  --iso-name "${ISO_NAME}"

echo "ISO build result: ${BUILD_DIR}/result/${ISO_NAME}"
