import { ReactNode, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
  Link,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
  Grid,
} from '@mui/material';
import CancelIcon from '@mui/icons-material/Cancel';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CleaningServicesIcon from '@mui/icons-material/CleaningServices';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import DevicesIcon from '@mui/icons-material/Devices';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SettingsIcon from '@mui/icons-material/Settings';
import StorageIcon from '@mui/icons-material/Storage';
import SystemUpdateAltIcon from '@mui/icons-material/SystemUpdateAlt';
import { Link as RouterLink, useLocation, useParams } from 'react-router-dom';
import { applyRaidPlan, clearRaidConfig, deleteRaidVolume, fetchServer, planRaid } from '../api/client';
import type { RaidPlanResult, ServerDetail } from '../types';

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

function iloManagementHref(ip: string | null) {
  const value = ip?.trim();
  if (!value) return null;
  return value.startsWith('http://') || value.startsWith('https://') ? value : `https://${value}`;
}

function IpReachability({ ip, reachable, href }: { ip: string | null; reachable: boolean | null; href?: string | null }) {
  const label = href ? (
    <Link
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      underline="hover"
      sx={{ fontWeight: 800, color: 'text.primary', textAlign: 'right', overflowWrap: 'anywhere' }}
    >
      {ip}
    </Link>
  ) : (
    <Typography component="span" sx={{ fontWeight: 800, textAlign: 'right', overflowWrap: 'anywhere' }}>
      {ip ?? '-'}
    </Typography>
  );

  return (
    <Stack direction="row" spacing={1} alignItems="center" justifyContent="flex-end" flexWrap="wrap" useFlexGap>
      {label}
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

function pathOf(value: unknown) {
  const record = asRecord(value);
  const resource = resourceOf(value);
  return textField(record, ['path'], '') || textField(resource, ['@odata.id'], '');
}

function volumeCountOf(resource: Record<string, unknown>) {
  const direct = resource['Volumes@odata.count'];
  if (typeof direct === 'number' && Number.isFinite(direct)) return direct;
  const links = asRecord(resource.Links);
  const volumes = asArray(links.Volumes);
  return volumes.length;
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
    <Stack direction="row" spacing={0.8} alignItems="center" sx={{ whiteSpace: 'nowrap' }}>
      <Box
        sx={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          bgcolor: isOk ? '#22d89a' : isBad ? '#d94841' : '#a8afb3',
          flex: '0 0 auto',
        }}
      />
      <Typography component="span" sx={{ fontWeight: 800, whiteSpace: 'nowrap' }}>
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
  minWidth = 1040,
}: {
  columns: InventoryColumn[];
  rows: InventoryRow[];
  emptyText: string;
  maxHeight?: number;
  minWidth?: number;
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
      <Table size="small" stickyHeader sx={{ minWidth, tableLayout: 'fixed' }}>
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
                    py: 0.95,
                    verticalAlign: 'top',
                    overflowWrap: 'break-word',
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

type InventorySectionKey = 'device' | 'firmware' | 'storage';

function StorageRaidSummary({
  server,
  inventory,
  expanded,
  onExpandedChange,
}: {
  server: ServerDetail;
  inventory: Record<string, unknown>;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}) {
  const raid = asRecord(inventory.raid);
  const controllers = asArray(raid.controllers);
  const drives = asArray(raid.drives);
  const volumes = asArray(raid.volumes);
  const recommendations = asArray(raid.recommendations);
  const [storageConfirmation, setStorageConfirmation] = useState('');
  const [storageBusy, setStorageBusy] = useState<string | null>(null);
  const [storageMessage, setStorageMessage] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const confirmed = storageConfirmation.trim().toLowerCase() === 'confirm';

  function scheduleReload() {
    window.setTimeout(() => window.location.reload(), 900);
  }

  async function clearConfig() {
    setStorageBusy('clear');
    setStorageMessage(null);
    setStorageError(null);
    try {
      await clearRaidConfig(server.id, { confirmation: storageConfirmation });
      setStorageMessage('Storage config clear was submitted. Refreshing inventory...');
      setStorageConfirmation('');
      scheduleReload();
    } catch {
      setStorageError("Storage config clear failed. Type 'confirm' and make sure Redfish credentials are valid.");
    } finally {
      setStorageBusy(null);
    }
  }

  async function deleteVolume(volumePath: string) {
    setStorageBusy(volumePath);
    setStorageMessage(null);
    setStorageError(null);
    try {
      await deleteRaidVolume(server.id, { confirmation: storageConfirmation, volume_path: volumePath });
      setStorageMessage('Logical drive delete was submitted. Refreshing inventory...');
      setStorageConfirmation('');
      scheduleReload();
    } catch {
      setStorageError("Logical drive delete failed. Type 'confirm' and make sure the volume still exists.");
    } finally {
      setStorageBusy(null);
    }
  }

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
      const path = pathOf(item);
      return {
        id: `volume-${index}`,
        type: 'Logical Drive',
        name: textField(resource, ['Name', 'Id'], `Logical Drive ${index + 1}`),
        version: textField(resource, ['RAIDType', 'VolumeType', 'VolumeUsage']),
        capacity: formatCapacity(resource),
        location: locationText(resource),
        status: <HealthValue value={statusText(resource)} />,
        action: path ? (
          <Button
            size="small"
            color="error"
            variant="outlined"
            startIcon={<DeleteOutlineIcon />}
            disabled={!confirmed || storageBusy !== null}
            onClick={() => deleteVolume(path)}
          >
            Delete
          </Button>
        ) : '-',
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
        action: '-',
      };
    }),
  ];

  return (
    <ReadableSection
      icon={<StorageIcon />}
      title="Storage & RAID"
      empty={!rows.length}
      emptyText="No Redfish storage data has been collected yet. Run inventory refresh after iLO credentials are validated."
      expanded={expanded}
      onExpandedChange={onExpandedChange}
    >
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Chip size="small" label={`${textField(raid, ['controller_count'], '0')} controllers`} />
        <Chip size="small" label={`${textField(raid, ['drive_count'], '0')} drives`} />
        <Chip size="small" label={`${textField(raid, ['volume_count'], '0')} volumes`} />
        <Chip size="small" label={raid.apply_supported ? 'RAID apply enabled' : 'RAID preview only'} />
      </Stack>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={1.25}
        alignItems={{ xs: 'stretch', md: 'center' }}
        sx={{ border: '1px solid', borderColor: '#f0d9a3', bgcolor: '#fffaf0', borderRadius: 1, p: 1.25 }}
      >
        <TextField
          label="Type confirm"
          value={storageConfirmation}
          onChange={(event) => setStorageConfirmation(event.target.value)}
          size="small"
          sx={{ minWidth: 190 }}
        />
        <Button
          color="error"
          variant="outlined"
          startIcon={<CleaningServicesIcon />}
          disabled={!confirmed || storageBusy !== null}
          onClick={clearConfig}
        >
          {storageBusy === 'clear' ? 'Clearing...' : 'Config Clear'}
        </Button>
        <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 700 }}>
          Deletes storage configuration; use delete buttons for a single logical drive.
        </Typography>
      </Stack>
      {storageMessage && <Alert severity="success">{storageMessage}</Alert>}
      {storageError && <Alert severity="error">{storageError}</Alert>}
      <InventoryTable
        columns={[
          { key: 'type', label: 'Type', width: '140px' },
          { key: 'name', label: 'Name' },
          { key: 'version', label: 'Version / RAID', width: '160px' },
          { key: 'capacity', label: 'Capacity', width: '120px' },
          { key: 'location', label: 'Location', width: '260px' },
          { key: 'status', label: 'Status', width: '230px' },
          { key: 'action', label: 'Action', width: '140px' },
        ]}
        rows={rows}
        emptyText="No Redfish storage data has been collected yet."
        minWidth={1280}
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
      <RaidConfigPanel server={server} inventory={inventory} />
    </ReadableSection>
  );
}

function RaidConfigPanel({ server, inventory }: { server: ServerDetail; inventory: Record<string, unknown> }) {
  const raid = asRecord(inventory.raid);
  const drives = asArray(raid.drives);
  const [diskMode, setDiskMode] = useState<'RAID' | 'NON_RAID'>('RAID');
  const [raidLevel, setRaidLevel] = useState('RAID1');
  const [purpose, setPurpose] = useState('OS Boot');
  const [volumeName, setVolumeName] = useState('os-boot');
  const [bootable, setBootable] = useState(true);
  const [autoJbodRemaining, setAutoJbodRemaining] = useState(true);
  const [selectedDrivePaths, setSelectedDrivePaths] = useState<string[]>([]);
  const [planning, setPlanning] = useState(false);
  const [plan, setPlan] = useState<RaidPlanResult | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [applyConfirmation, setApplyConfirmation] = useState('');
  const [applying, setApplying] = useState(false);
  const [applyMessage, setApplyMessage] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);

  const selectedSet = new Set(selectedDrivePaths);
  const hasRedfishAccess = Boolean(server.bmc_ip && server.management_config_json?.credential?.verified);
  const jbodCandidatePaths = new Set(
    drives
      .map((item, index) => ({ item, path: pathOf(item) || `drive-${index}` }))
      .filter(({ item, path }) => autoJbodRemaining && diskMode === 'RAID' && !selectedSet.has(path) && driveSelectable(resourceOf(item)))
      .map(({ path }) => path),
  );

  function driveSelectable(resource: Record<string, unknown>) {
    const status = asRecord(resource.Status);
    const state = textField(status, ['State'], '').toLowerCase();
    const health = textField(status, ['HealthRollup', 'Health'], '').toLowerCase();
    return state !== 'absent' && ['ok', 'healthy'].includes(health) && volumeCountOf(resource) === 0;
  }

  function toggleDrive(path: string) {
    setPlan(null);
    setApplyMessage(null);
    setApplyError(null);
    setSelectedDrivePaths((current) => (current.includes(path) ? current.filter((item) => item !== path) : [...current, path]));
  }

  async function previewPlan() {
    setPlanning(true);
    setPlan(null);
    setPlanError(null);
    setApplyMessage(null);
    setApplyError(null);
    setApplyConfirmation('');
    try {
      const result = await planRaid(server.id, {
        disk_mode: diskMode,
        raid_level: diskMode === 'RAID' ? raidLevel : 'NON_RAID',
        purpose,
        volume_name: diskMode === 'RAID' ? volumeName : 'non-raid',
        selected_drive_paths: selectedDrivePaths,
        bootable,
        initialize_as_jbod: diskMode === 'NON_RAID',
        auto_jbod_remaining: diskMode === 'RAID' && autoJbodRemaining,
      });
      setPlan(result);
    } catch {
      setPlanError('RAID plan could not be created from Redfish data.');
    } finally {
      setPlanning(false);
    }
  }

  async function stageApply() {
    setApplying(true);
    setApplyMessage(null);
    setApplyError(null);
    try {
      const action = await applyRaidPlan(server.id, {
        disk_mode: diskMode,
        raid_level: diskMode === 'RAID' ? raidLevel : 'NON_RAID',
        purpose,
        volume_name: diskMode === 'RAID' ? volumeName : 'non-raid',
        selected_drive_paths: selectedDrivePaths,
        bootable,
        initialize_as_jbod: diskMode === 'NON_RAID',
        auto_jbod_remaining: diskMode === 'RAID' && autoJbodRemaining,
        confirmation: applyConfirmation,
      });
      setApplyMessage(`Storage apply request staged as task #${action.id}.`);
      setApplyConfirmation('');
    } catch {
      setApplyError("Storage apply could not be staged. Type 'confirm' and make sure the plan is still eligible.");
    } finally {
      setApplying(false);
    }
  }

  return (
    <CollapsiblePanel
      title="RAID Config"
      defaultExpanded={typeof window !== 'undefined' && window.location.hash === '#raid-config'}
      panelId="raid-config"
      icon={<SettingsIcon />}
    >
      <Stack spacing={2}>
        <Alert severity="warning" sx={{ border: '1px solid #f2d6a2', bgcolor: '#fff8eb' }}>
          Preview only. No RAID changes are applied from this screen.
        </Alert>
        {!hasRedfishAccess && (
          <Alert severity="info">
            BMC IP and validated iLO credentials are required before RAID planning can be checked against Redfish.
          </Alert>
        )}
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
          <TextField
            select
            label="Disk Mode"
            value={diskMode}
            onChange={(event) => {
              setPlan(null);
              setApplyMessage(null);
              setApplyError(null);
              setApplyConfirmation('');
              setDiskMode(event.target.value as 'RAID' | 'NON_RAID');
            }}
            size="small"
            sx={{ minWidth: 240 }}
          >
            <MenuItem value="RAID">Create RAID Volume</MenuItem>
            <MenuItem value="NON_RAID">Expose as Non-RAID / JBOD</MenuItem>
          </TextField>
          <TextField select label="Purpose" value={purpose} onChange={(event) => setPurpose(event.target.value)} size="small" sx={{ minWidth: 180 }}>
            <MenuItem value="OS Boot">OS Boot</MenuItem>
            <MenuItem value="Data">Data</MenuItem>
            <MenuItem value="Custom">Custom</MenuItem>
          </TextField>
          {diskMode === 'RAID' && (
            <>
              <TextField select label="RAID Level" value={raidLevel} onChange={(event) => setRaidLevel(event.target.value)} size="small" sx={{ minWidth: 160 }}>
                <MenuItem value="RAID1">RAID1</MenuItem>
                <MenuItem value="RAID5">RAID5</MenuItem>
                <MenuItem value="RAID6">RAID6</MenuItem>
                <MenuItem value="RAID10">RAID10</MenuItem>
              </TextField>
              <TextField label="Volume Name" value={volumeName} onChange={(event) => setVolumeName(event.target.value)} size="small" sx={{ minWidth: 220 }} />
            </>
          )}
          <FormControlLabel
            control={<Checkbox checked={bootable} onChange={(event) => setBootable(event.target.checked)} />}
            label="Bootable"
          />
          {diskMode === 'RAID' && (
            <FormControlLabel
              control={
                <Checkbox
                  checked={autoJbodRemaining}
                  onChange={(event) => {
                    setPlan(null);
                    setApplyMessage(null);
                    setApplyError(null);
                    setAutoJbodRemaining(event.target.checked);
                  }}
                />
              }
              label="Auto JBOD remaining"
            />
          )}
          <Box sx={{ flex: 1 }} />
          <Button
            variant="contained"
            onClick={previewPlan}
            disabled={!hasRedfishAccess || planning || selectedDrivePaths.length === 0 || (diskMode === 'RAID' && !volumeName.trim())}
          >
            {planning ? 'Checking...' : diskMode === 'RAID' ? 'Check RAID Plan' : 'Check Non-RAID Plan'}
          </Button>
        </Stack>

        <TableContainer sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: '#ffffff' }}>
          <Table size="small" sx={{ minWidth: 1180, tableLayout: 'fixed' }}>
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox" />
                <TableCell sx={{ fontWeight: 900 }}>Bay / Location</TableCell>
                <TableCell sx={{ fontWeight: 900 }}>Drive</TableCell>
                <TableCell sx={{ fontWeight: 900, width: 120 }}>Capacity</TableCell>
                <TableCell sx={{ fontWeight: 900, width: 130 }}>Protocol</TableCell>
                <TableCell sx={{ fontWeight: 900, width: 190 }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 900, width: 170 }}>Use</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {drives.map((item, index) => {
                const resource = resourceOf(item);
                const path = pathOf(item) || `drive-${index}`;
                const selectable = driveSelectable(resource);
                const assigned = volumeCountOf(resource) > 0;
                const selectedForRaid = selectedSet.has(path);
                const jbodCandidate = jbodCandidatePaths.has(path);
                return (
                  <TableRow key={path} hover selected={selectedForRaid || jbodCandidate}>
                    <TableCell padding="checkbox">
                      <Checkbox
                        size="small"
                        checked={selectedForRaid}
                        disabled={!selectable}
                        onChange={() => toggleDrive(path)}
                        inputProps={{ 'aria-label': `Select ${locationText(resource)}` }}
                      />
                    </TableCell>
                    <TableCell>{locationText(resource)}</TableCell>
                    <TableCell>
                      <Typography sx={{ fontWeight: 900 }}>
                        {textField(resource, ['Name', 'Model', 'Id'], `Drive ${index + 1}`)}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {textField(resource, ['SerialNumber'], '-')}
                      </Typography>
                    </TableCell>
                    <TableCell>{formatCapacity(resource)}</TableCell>
                    <TableCell>{textField(resource, ['Protocol', 'MediaType'])}</TableCell>
                    <TableCell><HealthValue value={statusText(resource)} /></TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={assigned ? 'Assigned' : selectedForRaid ? 'RAID member' : jbodCandidate ? 'JBOD candidate' : selectable ? 'Available' : 'Unavailable'}
                        color={selectedForRaid ? 'primary' : jbodCandidate || selectable ? 'success' : 'default'}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
              {drives.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7}>
                    <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                      No Redfish drives are available yet. Refresh inventory first.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>

        {planError && <Alert severity="warning">{planError}</Alert>}
        {plan && (
          <Stack spacing={1.5}>
            <Alert severity={plan.eligible ? 'success' : 'warning'}>
              {plan.eligible ? 'Plan is eligible for the next guarded apply step.' : 'Plan is not eligible yet.'} {plan.message}
            </Alert>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Chip size="small" label={plan.disk_mode === 'NON_RAID' ? `Non-RAID / JBOD ${plan.purpose}` : `${plan.raid_level} ${plan.purpose}`} />
              <Chip size="small" label={`${plan.selected_drives.length} selected drives`} />
              {plan.auto_jbod_remaining && <Chip size="small" label={`${plan.jbod_candidate_drives.length} JBOD candidates`} />}
              <Chip size="small" label={plan.bootable ? 'Bootable' : 'Not bootable'} />
              <Chip size="small" label={plan.disk_mode === 'NON_RAID' ? 'Expose to OS' : 'Create volume'} />
              <Chip size="small" label={plan.apply_supported ? 'Apply enabled' : 'Apply disabled'} />
            </Stack>
            {plan.warnings.map((warning) => (
              <Alert key={warning.name} severity="info">
                {warning.message}
              </Alert>
            ))}
            <Stack spacing={0.75}>
              {plan.checks.map((check) => (
                <Stack key={check.name} direction="row" spacing={1} alignItems="center">
                  <Chip size="small" color={check.passed ? 'success' : 'warning'} label={check.passed ? 'OK' : 'Check'} />
                  <Typography color={check.passed ? 'text.primary' : 'warning.main'} sx={{ fontWeight: 800 }}>
                    {check.message}
                  </Typography>
                </Stack>
              ))}
            </Stack>
            {plan.eligible && (
              <Stack spacing={1.25} sx={{ border: '1px solid', borderColor: '#f0d9a3', bgcolor: '#fffaf0', borderRadius: 1, p: 1.5 }}>
                <Alert severity="warning">
                  Stage only. This records a guarded storage apply request; no storage changes are executed until the backend executor is enabled.
                </Alert>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25} alignItems={{ xs: 'stretch', md: 'center' }}>
                  <TextField
                    label="Type confirm"
                    value={applyConfirmation}
                    onChange={(event) => setApplyConfirmation(event.target.value)}
                    size="small"
                    sx={{ minWidth: 190 }}
                  />
                  <Button
                    variant="contained"
                    color="warning"
                    onClick={stageApply}
                    disabled={applying || applyConfirmation.trim().toLowerCase() !== 'confirm'}
                  >
                    {applying ? 'Staging...' : 'Stage Apply Request'}
                  </Button>
                </Stack>
              </Stack>
            )}
            {applyMessage && <Alert severity="success">{applyMessage}</Alert>}
            {applyError && <Alert severity="error">{applyError}</Alert>}
          </Stack>
        )}
      </Stack>
    </CollapsiblePanel>
  );
}

function FirmwareInventorySummary({
  inventory,
  expanded,
  onExpandedChange,
}: {
  inventory: Record<string, unknown>;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}) {
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
    <ReadableSection
      icon={<SystemUpdateAltIcon />}
      title="Firmware Inventory"
      empty={!rows.length}
      emptyText="No firmware inventory has been collected yet."
      expanded={expanded}
      onExpandedChange={onExpandedChange}
    >
      <InventoryTable
        columns={[
          { key: 'name', label: 'Firmware Name' },
          { key: 'version', label: 'Firmware Version', width: '260px' },
          { key: 'location', label: 'Location', width: '360px' },
          { key: 'status', label: 'Status', width: '210px' },
        ]}
        rows={rows}
        emptyText="No firmware inventory has been collected yet."
        minWidth={1180}
      />
    </ReadableSection>
  );
}

function DeviceInventorySummary({
  inventory,
  expanded,
  onExpandedChange,
}: {
  inventory: Record<string, unknown>;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}) {
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
    <ReadableSection
      icon={<DevicesIcon />}
      title="Device Inventory"
      empty={!rows.length}
      emptyText="No device inventory has been collected yet."
      expanded={expanded}
      onExpandedChange={onExpandedChange}
    >
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
          { key: 'status', label: 'Status', width: '180px' },
        ]}
        rows={rows}
        emptyText="No device inventory has been collected yet."
        minWidth={1200}
      />
    </ReadableSection>
  );
}

function ReadableSection({
  title,
  icon,
  empty,
  emptyText,
  defaultExpanded = false,
  expanded,
  onExpandedChange,
  children,
}: {
  title: string;
  icon?: ReactNode;
  empty: boolean;
  emptyText: string;
  defaultExpanded?: boolean;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  children: ReactNode;
}) {
  const [localExpanded, setLocalExpanded] = useState(defaultExpanded);
  const isExpanded = expanded ?? localExpanded;

  return (
    <Accordion
      expanded={isExpanded}
      onChange={(_, nextExpanded) => {
        if (onExpandedChange) {
          onExpandedChange(nextExpanded);
          return;
        }
        setLocalExpanded(nextExpanded);
      }}
      disableGutters
      variant="outlined"
      sx={{
        borderColor: 'divider',
        borderRadius: 1,
        '&:before': { display: 'none' },
        '& + &': { mt: 0 },
      }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Stack direction="row" spacing={1.2} alignItems="center">
          {icon && <Box sx={{ color: 'primary.main', display: 'flex', '& svg': { fontSize: 22 } }}>{icon}</Box>}
          <Typography variant="subtitle1" sx={{ fontWeight: 900 }}>
            {title}
          </Typography>
        </Stack>
      </AccordionSummary>
      <AccordionDetails sx={{ pt: 0 }}>
        {empty ? (
          <Typography color="text.secondary">{emptyText}</Typography>
        ) : (
          <Stack spacing={1.5}>{children}</Stack>
        )}
      </AccordionDetails>
    </Accordion>
  );
}

function CollapsiblePanel({
  title,
  defaultExpanded,
  panelId,
  icon,
  children,
}: {
  title: string;
  defaultExpanded: boolean;
  panelId?: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <Accordion
      id={panelId}
      expanded={expanded}
      onChange={(_, nextExpanded) => setExpanded(nextExpanded)}
      disableGutters
      variant="outlined"
      sx={{
        borderColor: 'divider',
        borderRadius: 1,
        '&:before': { display: 'none' },
      }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: { xs: 2, md: 2.5 } }}>
        <Stack direction="row" spacing={1.2} alignItems="center">
          {icon && <Box sx={{ color: 'primary.main', display: 'flex', '& svg': { fontSize: 23 } }}>{icon}</Box>}
          <Typography variant="h6" sx={{ fontWeight: 900 }}>
            {title}
          </Typography>
        </Stack>
      </AccordionSummary>
      <AccordionDetails sx={{ px: { xs: 2, md: 2.5 }, pt: 0, pb: { xs: 2, md: 2.5 } }}>
        <Divider sx={{ mb: 2, borderColor: 'divider' }} />
        {children}
      </AccordionDetails>
    </Accordion>
  );
}

export function ServerDetailPage() {
  const { serverId } = useParams();
  const location = useLocation();
  const [server, setServer] = useState<ServerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openInventorySection, setOpenInventorySection] = useState<InventorySectionKey>('device');

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

  useEffect(() => {
    if (!server || location.hash !== '#raid-config') return;
    window.setTimeout(() => document.getElementById('raid-config')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  }, [server, location.hash]);

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
              ['iLO / iDRAC / IPMI IP', <IpReachability ip={server.bmc_ip} reachable={server.bmc_reachable} href={iloManagementHref(server.bmc_ip)} />],
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

      <CollapsiblePanel title="Inventory Summary" defaultExpanded>
        <Stack spacing={2.5}>
          <DeviceInventorySummary
            inventory={latestInventory}
            expanded={openInventorySection === 'device'}
            onExpandedChange={(nextExpanded) => nextExpanded && setOpenInventorySection('device')}
          />
          <FirmwareInventorySummary
            inventory={latestInventory}
            expanded={openInventorySection === 'firmware'}
            onExpandedChange={(nextExpanded) => nextExpanded && setOpenInventorySection('firmware')}
          />
          <StorageRaidSummary
            server={server}
            inventory={latestInventory}
            expanded={openInventorySection === 'storage'}
            onExpandedChange={(nextExpanded) => nextExpanded && setOpenInventorySection('storage')}
          />
        </Stack>
      </CollapsiblePanel>

      <CollapsiblePanel title="Raw Inventory" defaultExpanded={false}>
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
      </CollapsiblePanel>
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
