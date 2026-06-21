# Management Network Action Design

KDX Live USB agents may not know the iLO, iDRAC or IPMI address during first registration. The first registration should use the temporary OS IP received by DHCP and should not overwrite operator-entered management values with `null`.

## Phase-1 Behavior

- Agent registers with `serial_number`, `vendor`, `model`, `product_name` and temporary `agent_ip` when available.
- If `hostname` is not known, the controller stores `iLO-<serial_number>` as the initial hostname.
- If management IP is not known, `bmc_ip` remains empty.
- Operators can use the row action menu to set the management network profile.
- The controller stores the profile in `servers.management_config_json` and mirrors the profile `ip` value to `servers.bmc_ip` for list/detail views.

## Management Network Profile

The UI captures these fields:

| Field | Purpose |
| --- | --- |
| `ip` | iLO, iDRAC or IPMI address |
| `subnet` | Subnet mask or CIDR, for example `255.255.255.0` or `/24` |
| `gateway` | Default gateway for the management controller |
| `dns` | DNS server list, comma-separated when multiple values are needed |
| `ntp` | NTP server list, comma-separated when multiple values are needed |
| `vlan` | Optional management VLAN ID |

## Recommended Automation Path

For first-time HPE discovery, Redfish is not the best primary mechanism because Redfish requires a reachable BMC IP before it can be used. The better first automation path is:

1. Controller creates a `set_management_network` action for the registered server.
2. Action payload includes `ip`, `subnet`, `gateway`, `dns`, `ntp` and optional `vlan`.
3. KDX Live USB agent polls the controller for pending actions.
4. On HPE hardware, the agent runs HPE iLOrest locally from KronOS OS through the host interface to configure the iLO network settings.
5. Agent validates the result locally, then asks the controller to check management IP reachability.
6. Agent reports action success or failure back to the controller.
7. Controller updates `servers.bmc_ip`, keeps the full profile in `management_config_json`, and later uses Redfish for inventory refresh, power control and lifecycle actions.

For Dell, the equivalent path should use local RACADM if available. For generic platforms, IPMI tooling can be evaluated, but Redfish should become the common remote API after the management IP is known.

## Future Agent Runner Contract

A later KDX Live USB agent action can use a payload like this:

```json
{
  "action": "set_management_network",
  "server_serial": "CZJ12345678",
  "vendor": "HPE",
  "management": {
    "ip": "192.168.88.160",
    "subnet": "255.255.255.0",
    "gateway": "192.168.88.1",
    "dns": "192.168.88.1,8.8.8.8",
    "ntp": "pool.ntp.org",
    "vlan": "88"
  }
}
```

The HPE runner should be implemented as an agent-side script that validates `ilorest` availability, applies the profile, captures command output, and posts structured result data back to the controller.
