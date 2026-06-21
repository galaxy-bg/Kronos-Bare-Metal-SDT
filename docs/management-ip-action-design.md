# Management IP Action Design

KDX Live USB agents may not know the iLO, iDRAC or IPMI address during first registration. The first registration should use the temporary OS IP received by DHCP and should not overwrite operator-entered management IP values with `null`.

## Phase-1 Behavior

- Agent registers with `serial_number`, `vendor`, `model`, `product_name` and temporary `agent_ip` when available.
- If `hostname` is not known, the controller stores `iLO-<serial_number>` as the initial hostname.
- If management IP is not known, `bmc_ip` remains empty.
- Operators can use the row action menu to set `iLO / iDRAC / IPMI IP` manually.

## Recommended Automation Path

For first-time HPE discovery, Redfish is not the best primary mechanism because Redfish requires a reachable BMC IP before it can be used. The better first automation path is:

1. Controller creates a `set_management_ip` action for the registered server.
2. KDX Live USB agent polls the controller for pending actions.
3. On HPE hardware, the agent runs HPE iLOrest locally through the host interface to configure the iLO network address.
4. Agent reports action success or failure back to the controller.
5. Controller updates `servers.bmc_ip` and later uses Redfish for inventory refresh, power control and lifecycle actions.

For Dell, the equivalent path should use local RACADM if available. For generic platforms, IPMI tooling can be evaluated, but Redfish should become the common remote API after the management IP is known.
