#!/usr/bin/env bash
set -euo pipefail

install -d /etc/kdx-agent
install -m 0755 agent/kdx-agent.py /usr/local/bin/kdx-agent
install -m 0644 agent/systemd/kdx-agent.service /etc/systemd/system/kdx-agent.service

if [ ! -f /etc/kdx-agent/agent.env ]; then
  install -m 0644 agent/config/agent.env.example /etc/kdx-agent/agent.env
fi

systemctl daemon-reload
systemctl enable kdx-agent

echo "Installed kdx-agent."
echo "Edit /etc/kdx-agent/agent.env, then run: systemctl start kdx-agent"
