#!/usr/bin/env bash
set -u

CONFIG="${1:-/etc/kdx-agent/agent.env}"
CONTROLLER_URL="http://192.168.88.240:8000"

if [ -f "${CONFIG}" ]; then
  # shellcheck disable=SC1090
  . "${CONFIG}"
  CONTROLLER_URL="${KDX_CONTROLLER_URL:-${CONTROLLER_URL}}"
fi

section() {
  printf '\n==== %s ====\n' "$1"
}

run_or_warn() {
  "$@" || printf 'command failed: %s\n' "$*"
}

section "KDX Live Debug"
date
hostnamectl || hostname

section "Agent Config"
if [ -f "${CONFIG}" ]; then
  sed -E 's/(PASSWORD=).*/\1********/; s/(TOKEN=).*/\1********/' "${CONFIG}"
else
  printf 'missing config: %s\n' "${CONFIG}"
fi

section "Network"
run_or_warn ip -br link
run_or_warn ip -br addr
run_or_warn ip route
run_or_warn nmcli device status

section "Controller"
printf 'controller: %s\n' "${CONTROLLER_URL}"
run_or_warn curl -fsS --connect-timeout 5 "${CONTROLLER_URL}/health"

section "DMI sysfs"
for path in \
  /sys/class/dmi/id/sys_vendor \
  /sys/class/dmi/id/product_name \
  /sys/class/dmi/id/product_version \
  /sys/class/dmi/id/product_serial \
  /sys/class/dmi/id/product_uuid \
  /sys/class/dmi/id/board_vendor \
  /sys/class/dmi/id/board_name \
  /sys/class/dmi/id/board_serial \
  /sys/class/dmi/id/chassis_vendor \
  /sys/class/dmi/id/chassis_serial; do
  if [ -r "${path}" ]; then
    printf '%s: %s\n' "${path}" "$(cat "${path}")"
  else
    printf '%s: unreadable\n' "${path}"
  fi
done

section "dmidecode"
for key in system-manufacturer system-product-name system-version system-serial-number baseboard-serial-number chassis-serial-number; do
  printf '%s: ' "${key}"
  dmidecode -s "${key}" 2>/dev/null || true
done

section "HPE tools"
if command -v hponcfg >/dev/null 2>&1; then
  command -v hponcfg
  hponcfg -h 2>&1 | sed -n '1,20p'
else
  printf 'hponcfg not found\n'
fi

section "Agent one-shot"
if command -v kdx-agent >/dev/null 2>&1; then
  kdx-agent --config "${CONFIG}" --once
else
  printf 'kdx-agent not found\n'
fi

section "Agent service"
systemctl --no-pager status kdx-agent || true

section "Recent agent logs"
journalctl -u kdx-agent --no-pager -n 120 || true
