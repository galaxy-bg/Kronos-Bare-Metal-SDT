import { ReactNode, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Grid,
  Paper,
  Stack,
  Tooltip,
  Typography,
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

function InventoryItem({ title, subtitle, rows }: { title: string; subtitle?: string; rows: Array<[string, ReactNode]> }) {
  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.25, bgcolor: '#ffffff' }}>
      <Typography sx={{ fontWeight: 900, overflowWrap: 'anywhere' }}>{title}</Typography>
      {subtitle && <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{subtitle}</Typography>}
      <Stack spacing={0.6} sx={{ mt: 1 }}>
        {rows.map(([label, value]) => (
          <Stack key={label} direction="row" spacing={1.5} justifyContent="space-between" alignItems="flex-start">
            <Typography variant="body2" color="text.secondary">{label}</Typography>
            <Box sx={{ fontSize: 14, fontWeight: 800, textAlign: 'right', overflowWrap: 'anywhere' }}>{value}</Box>
          </Stack>
        ))}
      </Stack>
    </Box>
  );
}

function StorageRaidSummary({ inventory }: { inventory: Record<string, unknown> }) {
  const raid = asRecord(inventory.raid);
  const controllers = asArray(raid.controllers).slice(0, 6);
  const drives = asArray(raid.drives).slice(0, 16);
  const volumes = asArray(raid.volumes).slice(0, 8);
  const recommendations = asArray(raid.recommendations);

  return (
    <ReadableSection
      title="Storage & RAID"
      empty={!controllers.length && !drives.length && !volumes.length}
      emptyText="No Redfish storage data has been collected yet. Run inventory refresh after iLO credentials are validated."
    >
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Chip size="small" label={`${textField(raid, ['controller_count'], '0')} controllers`} />
        <Chip size="small" label={`${textField(raid, ['drive_count'], '0')} drives`} />
        <Chip size="small" label={`${textField(raid, ['volume_count'], '0')} volumes`} />
        <Chip size="small" label={raid.apply_supported ? 'RAID apply enabled' : 'RAID preview only'} />
      </Stack>
      <Grid container spacing={1.5} sx={{ mt: 0.25 }}>
        {controllers.map((item, index) => {
          const resource = resourceOf(item);
          return (
            <Grid item xs={12} md={6} key={`controller-${index}`}>
              <InventoryItem
                title={textField(resource, ['Name', 'Model', 'Id'], `Controller ${index + 1}`)}
                subtitle={textField(resource, ['Manufacturer', 'PartNumber'], undefined)}
                rows={[
                  ['Firmware', textField(resource, ['FirmwareVersion', 'FirmwarePackageVersion'])],
                  ['Serial', textField(resource, ['SerialNumber'])],
                  ['Status', statusText(resource)],
                ]}
              />
            </Grid>
          );
        })}
        {volumes.map((item, index) => {
          const resource = resourceOf(item);
          return (
            <Grid item xs={12} md={6} key={`volume-${index}`}>
              <InventoryItem
                title={textField(resource, ['Name', 'Id'], `Logical Drive ${index + 1}`)}
                rows={[
                  ['RAID', textField(resource, ['RAIDType', 'VolumeType', 'VolumeUsage'])],
                  ['Capacity', formatCapacity(resource)],
                  ['Status', statusText(resource)],
                ]}
              />
            </Grid>
          );
        })}
        {drives.map((item, index) => {
          const resource = resourceOf(item);
          return (
            <Grid item xs={12} sm={6} md={4} key={`drive-${index}`}>
              <InventoryItem
                title={textField(resource, ['Name', 'Id'], `Drive ${index + 1}`)}
                rows={[
                  ['Capacity', formatCapacity(resource)],
                  ['Media', textField(resource, ['MediaType', 'Protocol'])],
                  ['Serial', textField(resource, ['SerialNumber'])],
                  ['Status', statusText(resource)],
                ]}
              />
            </Grid>
          );
        })}
      </Grid>
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
  const items = asArray(firmware.items).slice(0, 18);
  return (
    <ReadableSection title="Firmware Inventory" empty={!items.length} emptyText="No firmware inventory has been collected yet.">
      <Grid container spacing={1.5}>
        {items.map((item, index) => {
          const resource = resourceOf(item);
          return (
            <Grid item xs={12} sm={6} md={4} key={`firmware-${index}`}>
              <InventoryItem
                title={textField(resource, ['Name', 'Id', 'SoftwareId'], `Firmware ${index + 1}`)}
                subtitle={textField(resource, ['Description', 'Manufacturer'], undefined)}
                rows={[
                  ['Version', textField(resource, ['Version', 'FirmwareVersion'])],
                  ['Updateable', textField(resource, ['Updateable'])],
                  ['Status', statusText(resource)],
                ]}
              />
            </Grid>
          );
        })}
      </Grid>
    </ReadableSection>
  );
}

function DeviceInventorySummary({ inventory }: { inventory: Record<string, unknown> }) {
  const deviceInventory = asRecord(inventory.device_inventory);
  const devices = asArray(deviceInventory.devices).slice(0, 18);
  const summary = asRecord(deviceInventory.summary);
  return (
    <ReadableSection title="Device Inventory" empty={!devices.length} emptyText="No device inventory has been collected yet.">
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Chip size="small" label={`${textField(summary, ['chassis_count'], '0')} chassis`} />
        <Chip size="small" label={`${textField(summary, ['device_count'], '0')} devices`} />
      </Stack>
      <Grid container spacing={1.5} sx={{ mt: 0.25 }}>
        {devices.map((item, index) => {
          const record = asRecord(item);
          const resource = resourceOf(item);
          return (
            <Grid item xs={12} sm={6} md={4} key={`device-${index}`}>
              <InventoryItem
                title={textField(resource, ['Name', 'Model', 'Id'], `Device ${index + 1}`)}
                subtitle={textField(record, ['category'])}
                rows={[
                  ['Manufacturer', textField(resource, ['Manufacturer'])],
                  ['Part', textField(resource, ['PartNumber', 'SKU'])],
                  ['Serial', textField(resource, ['SerialNumber'])],
                  ['Status', statusText(resource)],
                ]}
              />
            </Grid>
          );
        })}
      </Grid>
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
