#!/usr/bin/env bash
set -euo pipefail

HPE_SPP_REPO_URL="${HPE_SPP_REPO_URL:-https://downloads.linux.hpe.com/SDR/repo/spp/2021.10.0_supspp_rhel8.5_x86_64}"
OUT_DIR="${OUT_DIR:-$(pwd)/rpms}"

mkdir -p "${OUT_DIR}"

download() {
  local url="$1"
  local name
  name="$(basename "${url}")"

  if [[ -f "${OUT_DIR}/${name}" ]]; then
    echo "Already downloaded: ${name}"
    return
  fi

  echo "Downloading: ${name}"
  curl --fail --location --retry 3 --output "${OUT_DIR}/${name}" "${url}"
}

download "${HPE_SPP_REPO_URL}/hponcfg-5.6.0-0.x86_64.rpm"
download "${HPE_SPP_REPO_URL}/amsd-2.5.0-1675.24.rhel8.x86_64.rpm"
download "${HPE_SPP_REPO_URL}/hp-health-10.93-307.4.rhel8.x86_64.rpm"
download "${HPE_SPP_REPO_URL}/hp-snmp-agents-10.94-689.8.rhel8.x86_64.rpm"
download "${HPE_SPP_REPO_URL}/sut-2.9.0-53.linux.x86_64.rpm"

if [[ -n "${ILOREST_RPM_URL:-}" ]]; then
  download "${ILOREST_RPM_URL}"
else
  echo "Skipping ilorest: set ILOREST_RPM_URL when the official RPM URL is known."
fi

if [[ -n "${SSACLI_RPM_URL:-}" ]]; then
  download "${SSACLI_RPM_URL}"
else
  echo "Skipping ssacli: set SSACLI_RPM_URL when the official RPM URL is known."
fi

echo "Downloaded RPMs:"
find "${OUT_DIR}" -maxdepth 1 -type f -name '*.rpm' -print | sort

