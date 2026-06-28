import { ReactNode, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
  Grid,
} from '@mui/material';
import CancelIcon from '@mui/icons-material/Cancel';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { fetchServer } from '../api/client';
import type { ServerDetail } from '../types';

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function vendorLabel(vendor?: string | null) {
  if (!vendor) return 'Unknown vendor';
  const normalized = vendor.toLowerCase();
  if (normalized === 'hpe') return 'HPE';
  if (normalized === 'dell') return 'Dell';
  if (normalized === 'generic_redfish') return 'Generic Redfish';
  if (normalized === 'oem') return 'OEM';
  if (normalized === 'unknown') return 'Unknown vendor';
  return vendor;
}

function ReachabilityChip({ reachable }: { reachable: boolean | null }) {
  const label = reachable === null ? 'Unknown' : reachable ? 'Online' : 'Offline';
  const title = reachable === null ? 'Connection status is unknown' : reachable ? 'Connection available' : 'Connection unavailable';
  const icon = reachable === null ? <HelpOutlineIcon /> : reachable ? <CheckCircleIcon /> : <CancelIcon />;

  return (
    <Tooltip title={title} arrow>
      <Chip
        size="small"
        icon={icon}
        label={label}
        sx={{
          bgcolor: reachable ? '#e7f7ef' : reachable === false ? '#fff1ef' : '#f3f5f5',
          color: reachable ? '#1f7d55' : reachable === false ? '#b23b32' : '#62666f',
          border: '1px solid',
          borderColor: reachable ? '#bfe8d2' : reachable === false ? '#f2c4bf' : '#dfe5e3',
          '& .MuiChip-icon': { color: 'inherit', fontSize: 16 },
        }}
      />
    </Tooltip>
  );
}

function IpReachability({ ip, reachable }: { ip: string | null; reachable: boolean | null }) {
  return (
    <Stack direction="row" spacing={1} alignItems="center" justifyContent="flex-end" flexWrap="wrap" useFlexGap>
      <Typography component="span" sx={{ fontWeight: 800, textAlign: 'right', overflowWrap: 'anywhere' }}>
        {ip ?? '-'}
      </Typography>
      {ip && <ReachabilityChip reachable={reachable} />}
    </Stack>
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function resourceOf(value: unknown): Record<string, unknown> {
  const record = asRecord(value);
  return asRecord(record.resource);
}

function textField(record: Record<string, unknown>, keys: string[], fallback = '-') {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'boolean') return value ? 'yes' : 'no';
  }
  return fallback;
}

function statusText(record: Record<string, unknown>) {
  const status = asRecord(record.Status);
  const state = textField(status, ['State'], '');
  const health = textField(status, ['HealthRollup', 'Health'], '');
  return [state, health].filter(Boolean).join(' / ') || '-';
}

function formatCapacity(record: Record<string, unknown>) {
  const bytes = record.CapacityBytes;
  if (typeof bytes === 'number' && Number.isFinite(bytes)) {
    const gb = bytes / 1000 ** 3;
    return `${gb.toFixed(gb >= 100 ? 0 : 1)} GB`;
  }
  return textField(record, ['CapacityGB', 'CapacityGiB', 'CapacityMiB', 'SizeBytes']);
}

function physicalLocationText(record: Record<string, unknown>) {
  const physical = asRecord(record.PhysicalLocation);
  const part = asRecord(physical.PartLocation);
  return (
    textField(part, ['ServiceLabel', 'LocationOrdinalValue', 'Info'], '') ||
    textField(physical, ['Info', 'InfoFormat'], '')
  );
}

function hpeOemText(record: Record<string, unknown>, keys: string[]) {
  const oem = asRecord(record.Oem);
  const hpe = asRecord(oem.Hpe);
  return textField(hpe, keys, '');
}

function relatedItemsText(record: Record<string, unknown>) {
  return asArray(record.RelatedItem)
    .map((item) => textField(asRecord(item), ['@odata.id'], ''))
    .filter(Boolean)
    .map((path) => path.split('/').filter(Boolean).slice(-3).join('/'))
    .join(', ');
}

function locationText(record: Record<string, unknown>, fallback = '-') {
  return (
    textField(record, ['Location', 'Slot', 'LocationInfo', 'DeviceLocation'], '') ||
    hpeOemText(record, ['Location', 'DeviceLocation', 'Position', 'Slot']) ||
    physicalLocationText(record) ||
    relatedItemsText(record) ||
    fallback
  );
}

function HealthValue({ value }: { value: string }) {
  const normalized = value.toLowerCase();
  const isOk = ['ok', 'healthy', 'enabled / ok', 'standbyoffline / ok'].includes(normalized) || normalized.endsWith('/ ok');
  const isBad = normalized.includes('critical') || normalized.includes('warning') || normalized.includes('disabled');

  return (
    <Stack direction="row" spacing={0.8} alignItems="center">
      <Box
        sx={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          bgcolor: isOk ? '#22d89a' : isBad ? '#d94841' : '#a8afb3',
          flex: '0 0 auto',
        }}
      />
      <Typography component="span" sx={{ fontWeight: 800 }}>
        {value || '-'}
      </Typography>
    </Stack>
  );
}

type InventoryColumn = {
  key: string;
  label: string;
  width?: string;
};

type InventoryRow = Record<string, ReactNode>;

function InventoryTable({
  columns,
  rows,
  emptyText,
  maxHeight = 460,
}: {
  columns: InventoryColumn[];
  rows: InventoryRow[];
  emptyText: string;
  maxHeight?: number;
}) {
  if (!rows.length) {
    return <Typography color="text.secondary">{emptyText}</Typography>;
  }

  return (
    <TableContainer
      sx={{
        maxHeight,
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
        bgcolor: '#ffffff',
      }}
    >
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            {columns.map((column) => (
              <TableCell
                key={column.key}
                sx={{
                  width: column.width,
                  bgcolor: '#f1f4f3',
                  color: 'text.primary',
                  fontSize: 15,
                  fontWeight: 900,
                  whiteSpace: 'nowrap',
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                }}
              >
                {column.label}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row, index) => (
            <TableRow key={String(row.id ?? index)} hover>
              {columns.map((column) => (
                <TableCell
                  key={column.key}
                  sx={{
                    py: 1.15,
                    verticalAlign: 'top',
                    overflowWrap: 'anywhere',
                    borderColor: 'divider',
                  }}
                >
                  {row[column.key] ?? '-'}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function StorageRaidSummary({ inventory }: { inventory: Record<string, unknown> }) {
  const raid = asRecord(inventory.raid);
  const controllers = asArray(raid.controllers);
  const drives = asArray(raid.drives);
  const volumes = asArray(raid.volumes);
  const recommendations = asArray(raid.recommendations);
  const rows: InventoryRow[] = [
    ...controllers.map((item, index) => {
      const resource = resourceOf(item);
      return {
        id: `controller-${index}`,
        type: 'Controller',
        name: textField(resource, ['Name', 'Model', 'Id'], `Controller ${index + 1}`),
        version: textField(resource, ['FirmwareVersion', 'FirmwarePackageVersion']),
        capacity: '-',
        location: locationText(resource),
        status: <HealthValue value={statusText(resource)} />,
      };
    }),
    ...volumes.map((item, index) => {
      const resource = resourceOf(item);
      return {
        id: `volume-${index}`,
        type: 'Logical Drive',
        name: textField(resource, ['Name', 'Id'], `Logical Drive ${index + 1}`),
        version: textField(resource, ['RAIDType', 'VolumeType', 'VolumeUsage']),
        capacity: formatCapacity(resource),
        location: locationText(resource),
        status: <HealthValue value={statusText(resource)} />,
      };
    }),
    ...drives.map((item, index) => {
      const resource = resourceOf(item);
      return {
        id: `drive-${index}`,
        type: 'Drive',
        name: textField(resource, ['Name', 'Model', 'Id'], `Drive ${index + 1}`),
        version: textField(resource, ['MediaType', 'Protocol']),
        capacity: formatCapacity(resource),
        location: locationText(resource),
        status: <HealthValue value={statusText(resource)} />,
      };
    }),
  ];

  return (
    <ReadableSection
      title="Storage & RAID"
      empty={!rows.length}
      emptyText="No Redfish storage data has been collected yet. Run inventory refresh after iLO credentials are validated."
    >
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Chip size="small" label={`${textField(raid, ['controller_count'], '0')} controllers`} />
        <Chip size="small" label={`${textField(raid, ['drive_count'], '0')} drives`} />
        <Chip size="small" label={`${textField(raid, ['volume_count'], '0')} volumes`} />
        <Chip size="small" label={raid.apply_supported ? 'RAID apply enabled' : 'RAID preview only'} />
      </Stack>
      <InventoryTable
        columns={[
          { key: 'type', label: 'Type', width: '140px' },
          { key: 'name', label: 'Name' },
          { key: 'version', label: 'Version / RAID', width: '180px' },
          { key: 'capacity', label: 'Capacity', width: '140px' },
          { key: 'location', label: 'Location', width: '260px' },
          { key: 'status', label: 'Status', width: '160px' },
        ]}
        rows={rows}
        emptyText="No Redfish storage data has been collected yet."
      />
      {recommendations.length > 0 && (
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
          {recommendations.map((item, index) => {
            const recommendation = asRecord(item);
            return (
              <Tooltip key={`recommendation-${index}`} title={textField(recommendation, ['message'], '')}>
                <Chip
                  size="small"
                  color={recommendation.eligible ? 'success' : 'default'}
                  label={`${textField(recommendation, ['raid_level'], 'No RAID')} ${recommendation.eligible ? 'eligible' : 'not eligible'}`}
                />
              </Tooltip>
            );
          })}
        </Stack>
      )}
    </ReadableSection>
  );
}

function FirmwareInventorySummary({ inventory }: { inventory: Record<string, unknown> }) {
  const firmware = asRecord(inventory.firmware_inventory);
  const rows = asArray(firmware.items).map((item, index) => {
    const resource = resourceOf(item);
    return {
      id: `firmware-${index}`,
      name: textField(resource, ['Name', 'Id', 'SoftwareId'], `Firmware ${index + 1}`),
      version: textField(resource, ['Version', 'FirmwareVersion']),
      location: locationText(resource),
      status: <HealthValue value={statusText(resource)} />,
    };
  });

  return (
    <ReadableSection title="Firmware Inventory" empty={!rows.length} emptyText="No firmware inventory has been collected yet.">
      <InventoryTable
        columns={[
          { key: 'name', label: 'Firmware Name' },
          { key: 'version', label: 'Firmware Version', width: '220px' },
          { key: 'location', label: 'Location', width: '340px' },
          { key: 'status', label: 'Status', width: '160px' },
        ]}
        rows={rows}
        emptyText="No firmware inventory has been collected yet."
      />
    </ReadableSection>
  );
}

function DeviceInventorySummary({ inventory }: { inventory: Record<string, unknown> }) {
  const deviceInventory = asRecord(inventory.device_inventory);
  const rows = asArray(deviceInventory.devices).map((item, index) => {
    const record = asRecord(item);
    const resource = resourceOf(item);
    return {
      id: `device-${index}`,
      location: locationText(resource, textField(record, ['category'], '-')),
      name: textField(resource, ['Name', 'Model', 'Id'], `Device ${index + 1}`),
      revision: textField(resource, ['Revision', 'HardwareRevision', 'PartNumber', 'SKU'], hpeOemText(resource, ['Revision', 'HardwareRevision', 'PartNumber'])),
      firmware: textField(resource, ['FirmwareVersion', 'FirmwarePackageVersion', 'Version'], hpeOemText(resource, ['FirmwareVersion', 'CurrentVersion', 'Version'])),
      state: textField(asRecord(resource.Status), ['State'], '-'),
      status: <HealthValue value={textField(asRecord(resource.Status), ['HealthRollup', 'Health'], '-')} />,
    };
  });
  const summary = asRecord(deviceInventory.summary);
  return (
    <ReadableSection title="Device Inventory" empty={!rows.length} emptyText="No device inventory has been collected yet.">
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Chip size="small" label={`${textField(summary, ['chassis_count'], '0')} chassis`} />
        <Chip size="small" label={`${textField(summary, ['device_count'], '0')} devices`} />
      </Stack>
      <InventoryTable
        columns={[
          { key: 'location', label: 'Location', width: '180px' },
          { key: 'name', label: 'Device Name' },
          { key: 'revision', label: 'Revision', width: '160px' },
          { key: 'firmware', label: 'Firmware Version', width: '190px' },
          { key: 'state', label: 'State', width: '140px' },
          { key: 'status', label: 'Status', width: '140px' },
        ]}
        rows={rows}
        emptyText="No device inventory has been collected yet."
      />
    </ReadableSection>
  );
}

function ReadableSection({ title, empty, emptyText, children }: { title: string; empty: boolean; emptyText: string; children: ReactNode }) {
  return (
    <Box>
      <Typography variant="subtitle1" sx={{ fontWeight: 900, mb: 1 }}>
        {title}
      </Typography>
      {empty ? (
        <Typography color="text.secondary">{emptyText}</Typography>
      ) : (
        <Stack spacing={1.5}>{children}</Stack>
      )}
    </Box>
  );
}

export function ServerDetailPage() {
  const { serverId } = useParams();
  const [server, setServer] = useState<ServerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      if (!serverId) return;
      try {
        setServer(await fetchServer(serverId));
      } catch {
        setError('Server details could not be loaded.');
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [serverId]);

  const latestInventory = useMemo<Record<string, unknown>>(
    () => server?.latest_inventory_json ?? server?.inventories[0]?.inventory_json ?? {},
    [server],
  );

  if (loading) {
    return (
      <Stack sx={{ py: 10 }} alignItems="center">
        <CircularProgress />
      </Stack>
    );
  }

  if (error || !server) {
    return <Alert severity="error">{error ?? 'Server not found.'}</Alert>;
  }

  return (
    <Stack spacing={3}>
      <Stack direction="row" spacing={2} alignItems="center">
        <Button component={RouterLink} to="/" startIcon={<ArrowBackIcon />} variant="outlined">
          Back
        </Button>
        <Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="h4" sx={{ fontWeight: 900 }}>
              {server.hostname ?? server.serial_number}
            </Typography>
            <Chip
              size="small"
              label={server.status.toUpperCase()}
              sx={{
                bgcolor: server.status === 'online' ? '#e7f7ef' : '#f3f5f5',
                color: server.status === 'online' ? '#1f7d55' : '#62666f',
                border: '1px solid',
                borderColor: server.status === 'online' ? '#bfe8d2' : '#dfe5e3',
              }}
            />
          </Stack>
          <Typography color="text.secondary">
            {vendorLabel(server.vendor)} {server.model ?? ''}
          </Typography>
        </Box>
      </Stack>

      <Grid container spacing={2}>
        <Grid item xs={12} md={4}>
          <InfoPanel
            title="System Information"
            rows={[
              ['Serial Number', server.serial_number],
              ['UUID', server.uuid],
              ['Product', server.product_name ?? '-'],
              ['Last Seen', formatDate(server.last_seen)],
            ]}
          />
        </Grid>
        <Grid item xs={12} md={4}>
          <InfoPanel
            title="Management"
            rows={[
              ['Agent IP', <IpReachability ip={server.agent_ip} reachable={server.agent_reachable} />],
              ['Agent Version', server.management_config_json?.agent?.version ?? '-'],
              ['Agent Build', server.management_config_json?.agent?.build ?? '-'],
              ['Agent Reported', server.management_config_json?.agent?.reported_at ? formatDate(server.management_config_json.agent.reported_at) : '-'],
              ['iLO / iDRAC / IPMI IP', <IpReachability ip={server.bmc_ip} reachable={server.bmc_reachable} />],
              ['Subnet', server.management_config_json?.subnet ?? '-'],
              ['Gateway', server.management_config_json?.gateway ?? '-'],
              ['DNS', server.management_config_json?.dns ?? '-'],
              ['NTP', server.management_config_json?.ntp ?? '-'],
              ['VLAN', server.management_config_json?.vlan === '0' ? '0 (Access / Untagged)' : server.management_config_json?.vlan ?? '-'],
              ['iLO License', server.management_config_json?.license?.edition ?? '-'],
              ['Hardware Health', server.management_config_json?.health?.overall ?? '-'],
              ['Power State', server.management_config_json?.health?.power_state ?? '-'],
              ['Created', formatDate(server.created_at)],
              ['Updated', formatDate(server.updated_at)],
            ]}
          />
        </Grid>
        <Grid item xs={12} md={4}>
          <InfoPanel
            title="Inventory"
            rows={[
              ['Snapshots', String(server.inventories.length)],
              ['Latest Upload', server.inventories[0] ? formatDate(server.inventories[0].created_at) : '-'],
            ]}
          />
        </Grid>
      </Grid>

      <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 }, borderColor: 'divider' }}>
        <Typography variant="h6" sx={{ fontWeight: 900 }}>
          Inventory Summary
        </Typography>
        <Divider sx={{ my: 2, borderColor: 'divider' }} />
        <Stack spacing={2.5}>
          <StorageRaidSummary inventory={latestInventory} />
          <FirmwareInventorySummary inventory={latestInventory} />
          <DeviceInventorySummary inventory={latestInventory} />
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 }, borderColor: 'divider' }}>
        <Typography variant="h6" sx={{ fontWeight: 900 }}>
          Raw Inventory
        </Typography>
        <Divider sx={{ my: 2, borderColor: 'divider' }} />
        <Grid container spacing={2}>
          {['system', 'cpu', 'memory', 'storage', 'storage_redfish', 'raid', 'firmware_inventory', 'device_inventory', 'network', 'bmc'].map((section) => (
            <Grid item xs={12} md={6} key={section}>
              <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 900, color: 'primary.dark', textTransform: 'uppercase' }}>
                {section}
              </Typography>
              <Box
                component="pre"
                sx={{
                  m: 0,
                  p: 1.5,
                  bgcolor: '#202326',
                  color: '#eef8f4',
                  borderRadius: 1,
                  overflow: 'auto',
                  border: '1px solid #2f3a36',
                }}
              >
                {JSON.stringify(latestInventory[section] ?? {}, null, 2)}
              </Box>
            </Grid>
          ))}
        </Grid>
      </Paper>
    </Stack>
  );
}

function InfoPanel({ title, rows }: { title: string; rows: Array<[string, ReactNode]> }) {
  return (
    <Paper variant="outlined" sx={{ p: 2.5, height: '100%', borderColor: 'divider' }}>
      <Typography variant="h6" sx={{ fontWeight: 900 }}>
        {title}
      </Typography>
      <Stack spacing={1.2} sx={{ mt: 2 }}>
        {rows.map(([label, value]) => (
          <Stack key={label} direction="row" justifyContent="space-between" spacing={2} alignItems="center">
            <Typography color="text.secondary">{label}</Typography>
            <Box sx={{ fontWeight: 800, textAlign: 'right', overflowWrap: 'anywhere' }}>{value}</Box>
          </Stack>
        ))}
      </Stack>
    </Paper>
  );
}
