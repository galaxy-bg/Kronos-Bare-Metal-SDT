# KDX Fake Agent Simulator

The fake agent simulator registers a synthetic bare-metal server to the KDX SDT controller, uploads sample inventory, and can send periodic heartbeats.

Use it before the real KDX Live USB agent is ready, or to validate a new control-plane VM.

## One-Shot Register

```bash
python3 agent/simulator/fake_agent.py \
  --controller http://192.168.88.240:8000 \
  --serial LAB-FAKE-001 \
  --hostname fake-dl380-01 \
  --vendor HPE \
  --model "ProLiant DL380 Gen11" \
  --agent-ip 192.168.88.50 \
  --bmc-ip 192.168.88.151 \
  --once
```

## Register And Heartbeat Loop

```bash
python3 agent/simulator/fake_agent.py \
  --controller http://192.168.88.240:8000 \
  --serial LAB-FAKE-001 \
  --hostname fake-dl380-01 \
  --agent-ip 192.168.88.50 \
  --bmc-ip 192.168.88.151 \
  --heartbeat-interval 60
```

## Local Development

If the controller runs on the same machine:

```bash
python3 agent/simulator/fake_agent.py --controller http://localhost:8000 --once
```

## Output

The simulator calls:

- `POST /api/v1/agents/register`
- `POST /api/v1/agents/inventory`
- `POST /api/v1/agents/heartbeat`
