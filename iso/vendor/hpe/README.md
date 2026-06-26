# HPE Vendor Tools

KDX Live ISO uses HPE Linux tooling for first bootstrap on ProLiant servers.

Default HPE SDR source:

```text
https://downloads.linux.hpe.com/SDR/repo/spp/2021.10.0_supspp_rhel8.5_x86_64/
```

The first profile intentionally downloads only selected tools instead of the full SPP repository.

## Selected Packages

From the SPP repository:

- `hponcfg`: local iLO configuration utility. Useful when iLO IP and credentials are unknown.
- `amsd`: Agentless Management Service daemon.
- `hp-health`: HPE health and hardware monitoring utility package.
- `hp-snmp-agents`: optional SNMP/hardware agent package.
- `sut`: Smart Update Tools. Useful later for firmware workflows, not required for first iLO bootstrap.

Expected additional HPE packages:

- `ilorest`: preferred Redfish/iLO REST CLI for iLO bootstrap actions where local access works.
- `ssacli`: Smart Storage Administrator CLI for storage inventory and later RAID actions.

If `ilorest` or `ssacli` are not present in the selected SPP path, keep their RPM URLs in environment variables when running the download script.

## iLO 6/7 Note

On Gen11/Gen12 systems, local iLO configuration should prefer Redfish with a valid iLO user. `hponcfg` can fail on newer iLO firmware with errors such as `CPQCIDRV driver is not loaded`. The KDX flow therefore treats `hponcfg` as a fallback and relies on Redfish after the factory `Administrator` credential is validated or the managed `hpadmin` user is created.

## Download

```bash
cd iso/vendor/hpe
./download-hpe-tools.sh
```

Optional:

```bash
ILOREST_RPM_URL="https://example/hpe/ilorest.rpm" \
SSACLI_RPM_URL="https://example/hpe/ssacli.rpm" \
./download-hpe-tools.sh
```

Downloaded RPMs are ignored by Git. Keep them in the builder workspace or private artifact storage.
