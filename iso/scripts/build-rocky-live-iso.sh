#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BUILD_DIR="${BUILD_DIR:-/var/tmp/kdx-live-iso}"
KS_FILE="${KS_FILE:-${ROOT_DIR}/iso/kickstart/kdx-live.ks}"
ISO_NAME="${ISO_NAME:-kdx-live-rocky9.iso}"

if ! command -v livemedia-creator >/dev/null 2>&1; then
  echo "livemedia-creator is required. Install lorax-lmc-novirt on a Rocky Linux builder VM." >&2
  exit 1
fi

mkdir -p "${BUILD_DIR}"

livemedia-creator \
  --make-iso \
  --no-virt \
  --ks "${KS_FILE}" \
  --resultdir "${BUILD_DIR}/result" \
  --project "KDX Live" \
  --releasever 9 \
  --volid "KDX-LIVE" \
  --iso-only \
  --iso-name "${ISO_NAME}"

echo "ISO build result: ${BUILD_DIR}/result/${ISO_NAME}"
