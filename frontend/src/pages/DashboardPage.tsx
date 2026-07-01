import { MouseEvent, ReactElement, ReactNode, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Grid,
  IconButton,
  InputAdornment,
  Link,
  Menu,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import CancelIcon from '@mui/icons-material/Cancel';
import AssessmentIcon from '@mui/icons-material/Assessment';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ClearIcon from '@mui/icons-material/Clear';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import DnsIcon from '@mui/icons-material/Dns';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DownloadIcon from '@mui/icons-material/Download';
import EditIcon from '@mui/icons-material/Edit';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import LanIcon from '@mui/icons-material/Lan';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import PendingActionsIcon from '@mui/icons-material/PendingActions';
import PersonAddAlt1Icon from '@mui/icons-material/PersonAddAlt1';
import PowerSettingsNewIcon from '@mui/icons-material/PowerSettingsNew';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import RefreshIcon from '@mui/icons-material/Refresh';
import SearchIcon from '@mui/icons-material/Search';
import SettingsEthernetIcon from '@mui/icons-material/SettingsEthernet';
import StorageIcon from '@mui/icons-material/Storage';
import TaskAltIcon from '@mui/icons-material/TaskAlt';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import VpnKeyIcon from '@mui/icons-material/VpnKey';
import { Link as RouterLink } from 'react-router-dom';
import {
  bulkDeleteServers,
  createIloEnrollment,
  createIloLicenseAction,
  createIloNetworkAction,
  createIloUserAction,
  createHpeStorageInventoryAction,
  createOsStorageValidationAction,
  deleteServer,
  deregisterServer,
  executeStorageApplyAction,
  fetchRecentActions,
  fetchServers,
  fetchStats,
  refreshServerInventory,
  updateServer,
} from '../api/client';
import { QrCode } from '../components/QrCode';
import type { DashboardStats, ManagementConfig, ServerAction, ServerSummary, ServerUpdate } from '../types';

const emptyStats: DashboardStats = {
  total_servers: 0,
  online_servers: 0,
  offline_servers: 0,
};
const ACTIVE_TASK_REFRESH_MS = 4000;
const IDLE_TASK_REFRESH_MS = 10000;
const RUNNING_TASK_TIMEOUT_MINUTES = 10;

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatOptionalDate(value: string | null) {
  return value ? formatDate(value) : '-';
}

function csvValue(value: unknown) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function credentialFor(server: ServerSummary) {
  return server.management_config_json?.credential ?? null;
}

function managedUserFor(server: ServerSummary) {
  return server.management_config_json?.managed_user ?? null;
}

function actionCredentialFor(server: ServerSummary) {
  const managedUser = managedUserFor(server);
  if (managedUser?.username && managedUser?.password) {
    return managedUser;
  }
  return credentialFor(server);
}

function hasUsableActionCredential(server: ServerSummary | null) {
  if (!server) return false;
  const credential = actionCredentialFor(server);
  return Boolean(credential?.username && credential?.password);
}

function networkInterfacesFor(server: ServerSummary) {
  const network = server.latest_inventory_json?.network;
  return Array.isArray(network) ? network.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object') : [];
}

function agentVersionLabel(server: ServerSummary) {
  const agent = server.management_config_json?.agent;
  if (!agent?.version) return '-';
  return agent.build ? `${agent.version} (${agent.build})` : agent.version;
}

function vendorLabel(vendor?: string | null) {
  if (!vendor) return '-';
  const normalized = vendor.toLowerCase();
  if (normalized === 'hpe') return 'HPE';
  if (normalized === 'dell') return 'Dell';
  if (normalized === 'generic_redfish') return 'Generic Redfish';
  if (normalized === 'oem') return 'OEM';
  if (normalized === 'unknown') return 'Unknown';
  return vendor;
}

type ServerSortKey =
  | 'hostname'
  | 'vendor'
  | 'model'
  | 'serial_number'
  | 'agent_ip'
  | 'bmc_ip'
  | 'status'
  | 'last_seen';

type SortDirection = 'asc' | 'desc';

function serverSortValue(server: ServerSummary, key: ServerSortKey) {
  if (key === 'last_seen') return new Date(server.last_seen).getTime();
  return String(server[key] ?? '').toLowerCase();
}

function sortServers(servers: ServerSummary[], key: ServerSortKey, direction: SortDirection) {
  const multiplier = direction === 'asc' ? 1 : -1;
  return [...servers].sort((left, right) => {
    const leftValue = serverSortValue(left, key);
    const rightValue = serverSortValue(right, key);
    if (leftValue < rightValue) return -1 * multiplier;
    if (leftValue > rightValue) return 1 * multiplier;
    return String(left.serial_number).localeCompare(String(right.serial_number));
  });
}

function actionLabel(actionType: string) {
  const labels: Record<string, string> = {
    hpe_create_ilo_user: 'Create iLO User',
    hpe_set_ilo_network: 'Set Management Network',
    hpe_verify_ilo_credential: 'Verify iLO Credential',
    hpe_install_ilo_license: 'Install iLO License',
    validate_os_storage: 'Validate OS Storage',
    hpe_refresh_storage_inventory: 'HPE Storage Inventory',
  };
  return labels[actionType] ?? actionType.split('_').join(' ');
}

function actionDetailLines(action: ServerAction, target?: ServerSummary) {
  const payload = action.payload_json ?? {};
  const result = action.result_json ?? {};
  const management = payload.management && typeof payload.management === 'object' ? payload.management as Record<string, unknown> : null;
  const auth = payload.auth && typeof payload.auth === 'object' ? payload.auth as Record<string, unknown> : null;
  const bmc = result.bmc && typeof result.bmc === 'object' ? result.bmc as Record<string, unknown> : null;
  const lines = [
    `Target: ${target?.hostname ?? target?.serial_number ?? `Server #${action.server_id}`}`,
    `Status: ${action.status}`,
  ];

  if (payload.bmc_ip) lines.push(`BMC IP: ${String(payload.bmc_ip)}`);
  if (management?.ip) lines.push(`Requested IP: ${String(management.ip)}`);
  if (management?.vlan) lines.push(`VLAN: ${String(management.vlan)}${String(management.vlan) === '0' ? ' (access)' : ' (tagged)'}`);
  if (payload.username) lines.push(`User: ${String(payload.username)}`);
  if (payload.license_key) lines.push('License key: ********');
  if (auth?.username) lines.push(`Auth: ${String(auth.username)}`);
  if (bmc?.ip) lines.push(`Detected BMC IP: ${String(bmc.ip)}`);
  if (result.action) lines.push(`Redfish action: ${String(result.action)}`);
  if (typeof result.disk_count === 'number') lines.push(`OS disks: ${result.disk_count}`);
  if (typeof result.tool_available === 'boolean') lines.push(`${String(result.tool ?? 'tool')}: ${result.tool_available ? 'available' : 'missing'}`);
  if (result.tool_path) lines.push(`Tool path: ${String(result.tool_path)}`);
  const osStorage = result.os_storage && typeof result.os_storage === 'object' ? result.os_storage as Record<string, unknown> : null;
  if (typeof osStorage?.disk_count === 'number') lines.push(`OS disks: ${osStorage.disk_count}`);
  const storage = Array.isArray(result.storage) ? result.storage : [];
  const nestedStorage = osStorage && Array.isArray(osStorage.storage) ? osStorage.storage : [];
  const storageRows = storage.length > 0 ? storage : nestedStorage;
  storageRows.slice(0, 8).forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const disk = item as Record<string, unknown>;
    lines.push(
      `Disk ${index + 1}: ${String(disk.name ?? '-')} ${String(disk.size_gb ?? '-')}GB ${String(disk.model ?? '-')}`,
    );
  });
  if (action.error_message) lines.push(`Error: ${action.error_message}`);
  if (!action.error_message && action.status === 'succeeded') lines.push('Result: Completed successfully');

  return lines;
}

function StatusChip({ status }: { status: string }) {
  const online = status === 'online';
  return (
    <Chip
      size="small"
      label={status.toUpperCase()}
      sx={{
        bgcolor: online ? '#e7f7ef' : '#f3f5f5',
        color: online ? '#1f7d55' : '#62666f',
        border: '1px solid',
        borderColor: online ? '#bfe8d2' : '#dfe5e3',
      }}
    />
  );
}

function ActionStatusChip({ status }: { status: string }) {
  const variants: Record<string, { label: string; color: string; bg: string; border: string; icon: ReactElement }> = {
    planned: {
      label: 'Planned',
      color: '#5f4a98',
      bg: '#f3efff',
      border: '#d8cdf7',
      icon: <PendingActionsIcon />,
    },
    pending: {
      label: 'Queued',
      color: '#75611d',
      bg: '#fff8df',
      border: '#ead58a',
      icon: <PendingActionsIcon />,
    },
    running: {
      label: 'Running',
      color: '#1d6680',
      bg: '#eaf7fb',
      border: '#addce9',
      icon: <CircularProgress size={13} color="inherit" />,
    },
    succeeded: {
      label: 'Completed',
      color: '#1f7d55',
      bg: '#e7f7ef',
      border: '#bfe8d2',
      icon: <TaskAltIcon />,
    },
    failed: {
      label: 'Failed',
      color: '#b23b32',
      bg: '#fff1ef',
      border: '#f2c4bf',
      icon: <ErrorOutlineIcon />,
    },
  };
  const variant = variants[status] ?? {
    label: status,
    color: '#62666f',
    bg: '#f3f5f5',
    border: '#dfe5e3',
    icon: <HelpOutlineIcon />,
  };

  return (
    <Chip
      size="small"
      icon={variant.icon}
      label={variant.label}
      sx={{
        bgcolor: variant.bg,
        color: variant.color,
        border: '1px solid',
        borderColor: variant.border,
        fontWeight: 800,
        '& .MuiChip-icon': { color: 'inherit', fontSize: 16 },
      }}
    />
  );
}

function CredentialChip({ server }: { server: ServerSummary }) {
  const credential = credentialFor(server);
  const managedUser = managedUserFor(server);
  const managedReady = Boolean(managedUser?.username && managedUser?.password && managedUser?.created);
  const verified = Boolean(credential?.verified);
  const usable = hasUsableActionCredential(server);
  const label = managedReady ? 'hpadmin ready' : verified ? 'iLO verified' : usable ? 'credential stored' : 'credential needed';
  const color = managedReady || verified ? '#1f7d55' : usable ? '#75611d' : '#62666f';
  const bg = managedReady || verified ? '#e7f7ef' : usable ? '#fff8df' : '#f3f5f5';
  const border = managedReady || verified ? '#bfe8d2' : usable ? '#ead58a' : '#dfe5e3';
  const icon = managedReady || verified ? <CheckCircleIcon /> : usable ? <PendingActionsIcon /> : <HelpOutlineIcon />;
  const title = managedReady
    ? `Managed user ${managedUser?.username} is available for iLO actions.`
    : verified
      ? `Credential ${credential?.username ?? ''} was validated${credential?.verified_at ? ` at ${formatDate(credential.verified_at)}` : ''}.`
      : usable
        ? 'A stored credential is available, but validation status is not confirmed.'
        : 'Scan/enter the iLO Administrator credential before protected iLO actions.';

  return (
    <Tooltip title={title} arrow>
      <Chip
        size="small"
        icon={icon}
        label={label}
        sx={{
          bgcolor: bg,
          color,
          border: '1px solid',
          borderColor: border,
          fontWeight: 800,
          '& .MuiChip-icon': { color: 'inherit', fontSize: 16 },
        }}
      />
    </Tooltip>
  );
}

function ReadinessChip({ server }: { server: ServerSummary }) {
  const variants: Record<string, { label: string; color: string; bg: string; border: string; icon: ReactElement }> = {
    ready: { label: 'Ready', color: '#1f7d55', bg: '#e7f7ef', border: '#bfe8d2', icon: <TaskAltIcon /> },
    credential_validated: { label: 'Credential OK', color: '#1f7d55', bg: '#e7f7ef', border: '#bfe8d2', icon: <CheckCircleIcon /> },
    needs_credential: { label: 'Needs Credential', color: '#75611d', bg: '#fff8df', border: '#ead58a', icon: <VpnKeyIcon /> },
    registered: { label: 'Registered', color: '#62666f', bg: '#f3f5f5', border: '#dfe5e3', icon: <HelpOutlineIcon /> },
    conflict: { label: 'Conflict', color: '#b23b32', bg: '#fff1ef', border: '#f2c4bf', icon: <ErrorOutlineIcon /> },
    deregistered: { label: 'Deregistered', color: '#62666f', bg: '#f3f5f5', border: '#dfe5e3', icon: <CancelIcon /> },
  };
  const variant = variants[server.readiness_status] ?? variants.registered;
  const title = server.readiness_reasons.length > 0 ? server.readiness_reasons.join('\n') : variant.label;

  return (
    <Tooltip title={<Box sx={{ whiteSpace: 'pre-line' }}>{title}</Box>} arrow>
      <Chip
        size="small"
        icon={variant.icon}
        label={variant.label}
        sx={{
          bgcolor: variant.bg,
          color: variant.color,
          border: '1px solid',
          borderColor: variant.border,
          fontWeight: 800,
          '& .MuiChip-icon': { color: 'inherit', fontSize: 16 },
        }}
      />
    </Tooltip>
  );
}

function LicenseChip({ server }: { server: ServerSummary }) {
  const license = server.management_config_json?.license;
  const edition = license?.edition ?? 'Unknown';
  const active = edition === 'Advanced' || edition === 'Essentials' || Boolean(license?.installed);
  const standard = edition === 'Standard';
  const label = edition === 'Unknown' ? 'License Unknown' : `iLO ${edition}`;
  const title = [
    `Edition: ${edition}`,
    license?.updated_at ? `Updated: ${formatDate(license.updated_at)}` : null,
    license?.detected_by ? `Detected by: ${license.detected_by}` : null,
    license?.source ? `Source: ${license.source}` : null,
  ].filter(Boolean).join('\n');

  return (
    <Tooltip title={<Box sx={{ whiteSpace: 'pre-line' }}>{title}</Box>} arrow>
      <Chip
        size="small"
        icon={<VpnKeyIcon />}
        label={label}
        sx={{
          bgcolor: active ? '#e7f7ef' : standard ? '#f3f5f5' : '#fff8df',
          color: active ? '#1f7d55' : standard ? '#62666f' : '#75611d',
          border: '1px solid',
          borderColor: active ? '#bfe8d2' : standard ? '#dfe5e3' : '#ead58a',
          fontWeight: 800,
          '& .MuiChip-icon': { color: 'inherit', fontSize: 16 },
        }}
      />
    </Tooltip>
  );
}

function HealthChip({ server }: { server: ServerSummary }) {
  const health = server.management_config_json?.health;
  const overall = (health?.overall ?? 'unknown').toLowerCase();
  const variants: Record<string, { label: string; color: string; bg: string; border: string; icon: ReactElement }> = {
    healthy: { label: 'Healthy', color: '#1f7d55', bg: '#e7f7ef', border: '#bfe8d2', icon: <CheckCircleIcon /> },
    degraded: { label: 'Degraded', color: '#75611d', bg: '#fff8df', border: '#ead58a', icon: <ErrorOutlineIcon /> },
    critical: { label: 'Critical', color: '#b23b32', bg: '#fff1ef', border: '#f2c4bf', icon: <ErrorOutlineIcon /> },
    unknown: { label: 'Unknown', color: '#62666f', bg: '#f3f5f5', border: '#dfe5e3', icon: <HelpOutlineIcon /> },
  };
  const variant = variants[overall] ?? variants.unknown;
  const title = [
    `Overall: ${variant.label}`,
    health?.manager ? `Manager: ${health.manager}` : null,
    health?.system ? `System: ${health.system}` : null,
    health?.chassis ? `Chassis: ${health.chassis}` : null,
    health?.power_state ? `Power: ${health.power_state}` : null,
    health?.updated_at ? `Updated: ${formatDate(health.updated_at)}` : null,
    health?.detected_by ? `Detected by: ${health.detected_by}` : null,
  ].filter(Boolean).join('\n');

  return (
    <Tooltip title={<Box sx={{ whiteSpace: 'pre-line' }}>{title}</Box>} arrow>
      <Chip
        size="small"
        icon={variant.icon}
        label={variant.label}
        sx={{
          bgcolor: variant.bg,
          color: variant.color,
          border: '1px solid',
          borderColor: variant.border,
          fontWeight: 800,
          '& .MuiChip-icon': { color: 'inherit', fontSize: 16 },
        }}
      />
    </Tooltip>
  );
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
    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
      <Typography component="span" sx={{ fontWeight: 800 }}>
        {ip ?? '-'}
      </Typography>
      {ip && <ReachabilityChip reachable={reachable} />}
    </Stack>
  );
}

export function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats>(emptyStats);
  const [servers, setServers] = useState<ServerSummary[]>([]);
  const [actions, setActions] = useState<ServerAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [selectedServer, setSelectedServer] = useState<ServerSummary | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [managementIpOpen, setManagementIpOpen] = useState(false);
  const [iloUserOpen, setIloUserOpen] = useState(false);
  const [iloLicenseOpen, setIloLicenseOpen] = useState(false);
  const [enrollmentOpen, setEnrollmentOpen] = useState(false);
  const [enrollmentUrl, setEnrollmentUrl] = useState('');
  const [enrollmentExpiresAt, setEnrollmentExpiresAt] = useState<string | null>(null);
  const [managementConfig, setManagementConfig] = useState<ManagementConfig>({});
  const [iloUserForm, setIloUserForm] = useState({
    username: 'hpadmin',
    password: '',
    confirmPassword: '',
    adminUsername: 'Administrator',
    adminPassword: '',
  });
  const [iloLicenseForm, setIloLicenseForm] = useState({
    licenseKey: '',
    adminUsername: 'hpadmin',
    adminPassword: '',
  });
  const [showIloPassword, setShowIloPassword] = useState(false);
  const [showIloConfirmPassword, setShowIloConfirmPassword] = useState(false);
  const [showIloAdminPassword, setShowIloAdminPassword] = useState(false);
  const [showLicenseAdminPassword, setShowLicenseAdminPassword] = useState(false);
  const [showNetworkAdminPassword, setShowNetworkAdminPassword] = useState(false);
  const [form, setForm] = useState<ServerUpdate>({});
  const [saving, setSaving] = useState(false);
  const [refreshingInventoryId, setRefreshingInventoryId] = useState<number | null>(null);
  const [executingActionId, setExecutingActionId] = useState<number | null>(null);
  const [inventoryRefreshMessage, setInventoryRefreshMessage] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [filterText, setFilterText] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [tasksOpen, setTasksOpen] = useState(true);
  const [includeReportPasswords, setIncludeReportPasswords] = useState(false);
  const [includeReportNicMacs, setIncludeReportNicMacs] = useState(true);
  const [sortKey, setSortKey] = useState<ServerSortKey>('serial_number');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  const normalizedFilter = filterText.trim().toLowerCase();
  const filteredServers = sortServers(servers.filter((server) => {
    const matchesStatus = statusFilter === 'all' || server.status === statusFilter;
    const searchable = [
      server.hostname,
      server.vendor,
      server.model,
      server.product_name,
      server.serial_number,
      server.agent_ip,
      server.bmc_ip,
      server.status,
      server.readiness_status,
      server.readiness_reasons.join(' '),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return matchesStatus && (!normalizedFilter || searchable.includes(normalizedFilter));
  }), sortKey, sortDirection);
  const selectedVisibleIds = filteredServers.filter((server) => selectedIds.includes(server.id)).map((server) => server.id);
  const allVisibleSelected = filteredServers.length > 0 && selectedVisibleIds.length === filteredServers.length;
  const partiallyVisibleSelected = selectedVisibleIds.length > 0 && selectedVisibleIds.length < filteredServers.length;
  const serverById = new Map(servers.map((server) => [server.id, server]));
  const activeActionCount = actions.filter((action) => action.status === 'pending' || action.status === 'running').length;
  const taskRefreshLabel = activeActionCount > 0 ? `${ACTIVE_TASK_REFRESH_MS / 1000}s` : `${IDLE_TASK_REFRESH_MS / 1000}s`;
  const selectedServerCanRefreshInventory = Boolean(selectedServer?.bmc_ip && hasUsableActionCredential(selectedServer));

  async function load() {
    try {
      setError(null);
      setInventoryRefreshMessage(null);
      const [statsData, serverData, actionData] = await Promise.all([fetchStats(), fetchServers(), fetchRecentActions()]);
      setStats(statsData);
      setServers(serverData);
      setActions(actionData);
      setSelectedIds((current) => current.filter((id) => serverData.some((server) => server.id === id)));
    } catch {
      setError('Backend API is not reachable.');
    } finally {
      setLoading(false);
    }
  }

  async function refreshTasks() {
    const actionData = await fetchRecentActions();
    setActions(actionData);
    if (actionData.some((action) => action.status === 'pending' || action.status === 'running')) {
      const [statsData, serverData] = await Promise.all([fetchStats(), fetchServers()]);
      setStats(statsData);
      setServers(serverData);
      setSelectedIds((current) => current.filter((id) => serverData.some((server) => server.id === id)));
    }
  }

  async function executeStorageApply(action: ServerAction) {
    setExecutingActionId(action.id);
    setError(null);
    try {
      const updated = await executeStorageApplyAction(action.id);
      setActions((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      await refreshTasks();
    } catch {
      setError('Storage apply action could not be executed.');
    } finally {
      setExecutingActionId(null);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (activeActionCount === 0) return undefined;
    const timer = window.setInterval(() => {
      refreshTasks().catch(() => undefined);
    }, ACTIVE_TASK_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [activeActionCount]);

  useEffect(() => {
    if (activeActionCount > 0) return undefined;
    const timer = window.setInterval(() => {
      refreshTasks().catch(() => undefined);
    }, IDLE_TASK_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [activeActionCount]);

  function openMenu(event: MouseEvent<HTMLElement>, server: ServerSummary) {
    event.preventDefault();
    event.stopPropagation();
    setMenuAnchor(event.currentTarget);
    setSelectedServer(server);
  }

  function closeMenu() {
    setMenuAnchor(null);
  }

  function openEdit() {
    if (!selectedServer) return;
    setForm({
      hostname: selectedServer.hostname,
      vendor: selectedServer.vendor,
      model: selectedServer.model,
      product_name: selectedServer.product_name,
      agent_ip: selectedServer.agent_ip,
      bmc_ip: selectedServer.bmc_ip,
    });
    setEditOpen(true);
    closeMenu();
  }

  function openManagementIp() {
    if (!selectedServer) return;
    const credential = actionCredentialFor(selectedServer);
    setManagementConfig({
      ...(selectedServer.management_config_json ?? {}),
      ip: selectedServer.management_config_json?.ip ?? selectedServer.bmc_ip ?? '',
      vlan: selectedServer.management_config_json?.vlan ?? '0',
      admin_username: credential?.username ?? 'hpadmin',
      admin_password: credential?.password ?? '',
    });
    setShowNetworkAdminPassword(false);
    setManagementIpOpen(true);
    closeMenu();
  }

  function openIloUser() {
    if (!selectedServer) return;
    const credential = actionCredentialFor(selectedServer);
    const hasManagedUser = Boolean(selectedServer.management_config_json?.managed_user?.username);
    setIloUserForm({
      username: hasManagedUser ? '' : 'hpadmin',
      password: hasManagedUser ? '' : 'HP1nv3nt',
      confirmPassword: hasManagedUser ? '' : 'HP1nv3nt',
      adminUsername: credential?.username ?? 'Administrator',
      adminPassword: credential?.password ?? '',
    });
    setShowIloPassword(false);
    setShowIloConfirmPassword(false);
    setShowIloAdminPassword(false);
    setIloUserOpen(true);
    closeMenu();
  }

  function openIloLicense() {
    if (!selectedServer) return;
    const credential = actionCredentialFor(selectedServer);
    setIloLicenseForm({
      licenseKey: '',
      adminUsername: credential?.username ?? 'hpadmin',
      adminPassword: credential?.password ?? '',
    });
    setShowLicenseAdminPassword(false);
    setIloLicenseOpen(true);
    closeMenu();
  }

  async function openIloEnrollment() {
    if (!selectedServer) return;
    try {
      setError(null);
      const enrollment = await createIloEnrollment(selectedServer.id);
      setEnrollmentUrl(enrollment.url);
      setEnrollmentExpiresAt(enrollment.expires_at);
      setEnrollmentOpen(true);
    } catch {
      setError('iLO enrollment link could not be created.');
    } finally {
      closeMenu();
    }
  }

  function closeManagementIp() {
    setManagementIpOpen(false);
    setSelectedServer(null);
    setManagementConfig({});
  }

  function closeIloUser() {
    setIloUserOpen(false);
    setSelectedServer(null);
    setIloUserForm({ username: 'hpadmin', password: '', confirmPassword: '', adminUsername: 'Administrator', adminPassword: '' });
    setShowIloPassword(false);
    setShowIloConfirmPassword(false);
    setShowIloAdminPassword(false);
  }

  function closeIloLicense() {
    setIloLicenseOpen(false);
    setSelectedServer(null);
    setIloLicenseForm({ licenseKey: '', adminUsername: 'hpadmin', adminPassword: '' });
    setShowLicenseAdminPassword(false);
  }

  function closeEnrollment() {
    setEnrollmentOpen(false);
    setSelectedServer(null);
    setEnrollmentUrl('');
    setEnrollmentExpiresAt(null);
  }

  async function saveManagementIp() {
    if (!selectedServer) return;
    setSaving(true);
    try {
      const normalizedConfig: ManagementConfig = {
        ip: managementConfig.ip?.trim() || null,
        subnet: managementConfig.subnet?.trim() || null,
        gateway: managementConfig.gateway?.trim() || null,
        dns: managementConfig.dns?.trim() || null,
        ntp: managementConfig.ntp?.trim() || null,
        vlan: managementConfig.vlan?.trim() || '0',
        admin_username: managementConfig.admin_username?.trim() || null,
        admin_password: managementConfig.admin_password?.trim() || null,
      };
      if (!normalizedConfig.ip) {
        setError('iLO IP is required.');
        return;
      }
      if (!normalizedConfig.admin_username || !normalizedConfig.admin_password) {
        setError('Validated iLO credentials or an iLO admin username/password are required.');
        return;
      }
      await createIloNetworkAction(selectedServer.id, normalizedConfig);
      await load();
      closeManagementIp();
    } catch {
      setError('Management network action could not be queued.');
    } finally {
      setSaving(false);
    }
  }

  async function saveIloUser() {
    if (!selectedServer) return;
    const username = iloUserForm.username.trim();
    const password = iloUserForm.password.trim();
    const confirmPassword = iloUserForm.confirmPassword.trim();
    const adminUsername = iloUserForm.adminUsername.trim();
    const adminPassword = iloUserForm.adminPassword.trim();
    if (!username || !password) {
      setError('iLO username and password are required.');
      return;
    }
    if (password !== confirmPassword) {
      setError('iLO password confirmation does not match.');
      return;
    }
    if (!adminUsername || !adminPassword) {
      setError('Validated iLO credentials or the Administrator username/password are required.');
      return;
    }

    setSaving(true);
    try {
      await createIloUserAction(selectedServer.id, {
        username,
        password,
        admin_username: adminUsername || null,
        admin_password: adminPassword || null,
      });
      await load();
      closeIloUser();
    } catch {
      setError('iLO user action could not be queued.');
    } finally {
      setSaving(false);
    }
  }

  async function saveIloLicense() {
    if (!selectedServer) return;
    const licenseKey = iloLicenseForm.licenseKey.trim();
    const adminUsername = iloLicenseForm.adminUsername.trim();
    const adminPassword = iloLicenseForm.adminPassword.trim();
    if (!licenseKey) {
      setError('iLO license key is required.');
      return;
    }
    if (!adminUsername || !adminPassword) {
      setError('Validated iLO credentials or an iLO admin username/password are required.');
      return;
    }

    setSaving(true);
    try {
      await createIloLicenseAction(selectedServer.id, {
        license_key: licenseKey,
        admin_username: adminUsername,
        admin_password: adminPassword,
      });
      await load();
      closeIloLicense();
    } catch {
      setError('iLO license action could not be queued.');
    } finally {
      setSaving(false);
    }
  }

  async function refreshSelectedServerInventory() {
    if (!selectedServer) return;
    const server = selectedServer;
    closeMenu();
    if (!server.bmc_ip || !hasUsableActionCredential(server)) {
      setInventoryRefreshMessage(null);
      setError('Validated iLO credentials and a BMC IP are required before Redfish inventory refresh.');
      return;
    }

    setError(null);
    setInventoryRefreshMessage(`Refreshing Redfish inventory for ${server.hostname ?? server.serial_number}...`);
    setRefreshingInventoryId(server.id);
    try {
      await refreshServerInventory(server.id);
      await load();
      setInventoryRefreshMessage(`Redfish inventory refreshed for ${server.hostname ?? server.serial_number}.`);
    } catch {
      setInventoryRefreshMessage(null);
      setError('Redfish inventory refresh failed.');
    } finally {
      setRefreshingInventoryId(null);
    }
  }

  async function queueOsStorageValidation() {
    if (!selectedServer) return;
    const server = selectedServer;
    closeMenu();
    setError(null);
    try {
      await createOsStorageValidationAction(server.id);
      await load();
    } catch {
      setError('OS storage validation task could not be queued.');
    }
  }

  async function queueHpeStorageInventory() {
    if (!selectedServer) return;
    const server = selectedServer;
    closeMenu();
    setError(null);
    try {
      await createHpeStorageInventoryAction(server.id);
      await load();
    } catch {
      setError('HPE storage inventory task could not be queued.');
    }
  }

  function closeEdit() {
    setEditOpen(false);
    setSelectedServer(null);
    setForm({});
  }

  async function saveEdit() {
    if (!selectedServer) return;
    setSaving(true);
    try {
      const updated = await updateServer(selectedServer.id, form);
      setServers((current) => current.map((server) => (server.id === updated.id ? updated : server)));
      await load();
      closeEdit();
    } catch {
      setError('Server could not be updated.');
    } finally {
      setSaving(false);
    }
  }

  async function removeSelectedServer() {
    if (!selectedServer) return;
    const confirmed = window.confirm(`Delete ${selectedServer.hostname ?? selectedServer.serial_number}?`);
    closeMenu();
    if (!confirmed) return;

    try {
      await deleteServer(selectedServer.id);
      setSelectedServer(null);
      await load();
    } catch {
      setError('Server could not be deleted.');
    }
  }

  async function deregisterSelectedServer() {
    if (!selectedServer) return;
    const confirmed = window.confirm(`Deregister ${selectedServer.hostname ?? selectedServer.serial_number}?`);
    closeMenu();
    if (!confirmed) return;

    try {
      await deregisterServer(selectedServer.id);
      setSelectedServer(null);
      await load();
    } catch {
      setError('Server could not be deregistered.');
    }
  }

  function toggleServerSelection(serverId: number) {
    setSelectedIds((current) => (current.includes(serverId) ? current.filter((id) => id !== serverId) : [...current, serverId]));
  }

  function toggleVisibleSelection() {
    if (allVisibleSelected) {
      setSelectedIds((current) => current.filter((id) => !filteredServers.some((server) => server.id === id)));
      return;
    }

    setSelectedIds((current) => Array.from(new Set([...current, ...filteredServers.map((server) => server.id)])));
  }

  function clearFilters() {
    setFilterText('');
    setStatusFilter('all');
  }

  function changeSort(key: ServerSortKey) {
    if (sortKey === key) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDirection(key === 'last_seen' ? 'desc' : 'asc');
  }

  function sortableHeader(label: string, key: ServerSortKey) {
    return (
      <TableSortLabel
        active={sortKey === key}
        direction={sortKey === key ? sortDirection : 'asc'}
        onClick={() => changeSort(key)}
      >
        {label}
      </TableSortLabel>
    );
  }

  async function removeSelectedServers() {
    const selectedServers = servers.filter((server) => selectedIds.includes(server.id));
    if (selectedServers.length === 0) return;

    const confirmed = window.confirm(`Delete ${selectedServers.length} selected server${selectedServers.length > 1 ? 's' : ''}?`);
    if (!confirmed) return;

    try {
      await bulkDeleteServers(selectedServers.map((server) => server.id));
      setSelectedIds([]);
      await load();
    } catch {
      setError('Selected servers could not be deleted.');
    }
  }

  async function refreshList() {
    closeMenu();
    await load();
  }

  function exportCsv() {
    const baseHeader = [
      'Hostname',
      'Vendor',
      'Model',
      'Product ID',
      'Serial Number',
      'Agent IP',
      'Agent Version',
      'Agent Build',
      'Agent Reported At',
      'iLO / iDRAC / IPMI IP',
      'iLO DNS Name',
      'iLO Credential Validated',
      'iLO Credential Validated At',
      'Administrator Username',
      'Managed iLO Username',
      'Managed iLO User Created',
      'Readiness',
      'Readiness Notes',
      'iLO License Edition',
      'iLO License Updated At',
      'Hardware Health',
      'Power State',
      'Status',
      'Last Seen',
    ];
    const passwordHeader = ['Administrator Password', 'Managed iLO Password', 'iLO License Key'];
    const nicHeader = ['NIC Interfaces', 'NIC MAC Addresses'];
    const header = [
      ...baseHeader,
      ...(includeReportPasswords ? passwordHeader : []),
      ...(includeReportNicMacs ? nicHeader : []),
    ];
    const rows = filteredServers.map((server) => {
      const credential = credentialFor(server);
      const managedUser = managedUserFor(server);
      const interfaces = networkInterfacesFor(server);
      const baseRow = [
        server.hostname ?? '',
        vendorLabel(server.vendor),
        server.model ?? '',
        server.product_name ?? '',
        server.serial_number,
        server.agent_ip ?? '',
        server.management_config_json?.agent?.version ?? '',
        server.management_config_json?.agent?.build ?? '',
        server.management_config_json?.agent?.reported_at ?? '',
        server.bmc_ip ?? '',
        server.management_config_json?.dns_name ?? '',
        credential?.verified ? 'yes' : 'no',
        credential?.verified_at ?? '',
        credential?.username ?? '',
        managedUser?.username ?? '',
        managedUser?.created ? 'yes' : 'no',
        server.readiness_status,
        server.readiness_reasons.join('; '),
        server.management_config_json?.license?.edition ?? '',
        server.management_config_json?.license?.updated_at ?? server.management_config_json?.license?.installed_at ?? '',
        server.management_config_json?.health?.overall ?? '',
        server.management_config_json?.health?.power_state ?? '',
        server.status,
        server.last_seen,
      ];
      const passwordRow = [credential?.password ?? '', managedUser?.password ?? '', server.management_config_json?.license?.license_key ?? ''];
      const nicRow = [
        interfaces.map((item) => item.name).filter(Boolean).join('; '),
        interfaces.map((item) => item.mac).filter(Boolean).join('; '),
      ];
      return [
        ...baseRow,
        ...(includeReportPasswords ? passwordRow : []),
        ...(includeReportNicMacs ? nicRow : []),
      ];
    });
    const csv = [header, ...rows].map((row) => row.map(csvValue).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `kdx-sdt-servers-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return (
      <Stack sx={{ py: 10 }} alignItems="center">
        <CircularProgress />
      </Stack>
    );
  }

  return (
    <Stack spacing={3}>
      <Box
        sx={{
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: '#ffffff',
          p: { xs: 2.5, md: 3 },
          borderRadius: 2,
        }}
      >
        <Typography variant="overline" sx={{ color: 'primary.main', fontWeight: 900, letterSpacing: 1.6 }}>
          KDX SDT Control Plane
        </Typography>
        <Typography variant="h4" sx={{ fontWeight: 900, mt: 0.5 }}>
          Server Discovery
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.75, maxWidth: 760, fontSize: 17 }}>
          Discover, register and manage bare-metal servers from KDX Live USB agents.
        </Typography>
      </Box>

      {error && (
        <Alert severity="warning" sx={{ border: '1px solid #f2d6a2', bgcolor: '#fff8eb' }}>
          {error}
        </Alert>
      )}
      {inventoryRefreshMessage && (
        <Alert severity="info" sx={{ border: '1px solid #cfe0ef', bgcolor: '#f1f7fc' }}>
          {inventoryRefreshMessage}
        </Alert>
      )}

      <Grid container spacing={2}>
        <Grid item xs={12} md={4}>
          <Metric title="Total Servers" value={stats.total_servers} icon={<DnsIcon />} />
        </Grid>
        <Grid item xs={12} md={4}>
          <Metric title="Online Servers" value={stats.online_servers} icon={<LanIcon />} />
        </Grid>
        <Grid item xs={12} md={4}>
          <Metric title="Offline Servers" value={stats.offline_servers} icon={<PowerSettingsNewIcon />} />
        </Grid>
      </Grid>

      <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 }, borderColor: 'divider', bgcolor: '#ffffff' }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ xs: 'stretch', md: 'center' }}>
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: { md: 260 } }}>
            <AssessmentIcon sx={{ color: 'primary.main' }} />
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 900 }}>
                Deployment Report
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Export customer handover data for the filtered servers.
              </Typography>
            </Box>
          </Stack>
          <FormControlLabel
            control={<Checkbox checked={includeReportNicMacs} onChange={(event) => setIncludeReportNicMacs(event.target.checked)} />}
            label="Include NIC MAC addresses"
          />
          <FormControlLabel
            control={<Checkbox checked={includeReportPasswords} onChange={(event) => setIncludeReportPasswords(event.target.checked)} />}
            label="Include iLO passwords"
          />
          <Box sx={{ flex: 1 }} />
          <Button startIcon={<DownloadIcon />} variant="contained" onClick={exportCsv} disabled={filteredServers.length === 0}>
            Export Report CSV
          </Button>
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ overflow: 'hidden', borderColor: 'divider' }}>
        <Box sx={{ px: { xs: 2, md: 2.5 }, py: 2, borderBottom: '1px solid', borderColor: 'divider', bgcolor: '#ffffff' }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
          <Typography variant="h6" sx={{ fontWeight: 900 }}>
            Managed Servers
          </Typography>
            <Stack direction="row" spacing={1}>
              <Button startIcon={<RefreshIcon />} size="small" variant="outlined" onClick={load}>
                Refresh
              </Button>
            </Stack>
          </Stack>
        </Box>
        <Box sx={{ px: { xs: 2, md: 2.5 }, py: 1.5, borderBottom: '1px solid', borderColor: 'divider', bgcolor: '#fbfdfc' }}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', md: 'center' }}>
            {selectedIds.length > 0 ? (
              <>
                <Typography sx={{ fontWeight: 900, minWidth: 170 }}>{selectedIds.length} selected</Typography>
                <Button color="error" variant="outlined" size="small" startIcon={<DeleteOutlineIcon />} onClick={removeSelectedServers}>
                  Delete Selected
                </Button>
                <Button size="small" startIcon={<ClearIcon />} onClick={() => setSelectedIds([])}>
                  Clear Selection
                </Button>
              </>
            ) : (
              <>
                <TextField
                  size="small"
                  label="Filter servers"
                  placeholder="Hostname, serial, IP, vendor"
                  value={filterText}
                  onChange={(event) => setFilterText(event.target.value)}
                  sx={{ minWidth: { md: 340 } }}
                  InputProps={{ startAdornment: <SearchIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} /> }}
                />
                <TextField
                  select
                  size="small"
                  label="Status"
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  sx={{ minWidth: { md: 160 } }}
                >
                  <MenuItem value="all">All</MenuItem>
                  <MenuItem value="online">Online</MenuItem>
                  <MenuItem value="offline">Offline</MenuItem>
                  <MenuItem value="deregistered">Deregistered</MenuItem>
                </TextField>
                {(filterText || statusFilter !== 'all') && (
                  <Button size="small" startIcon={<ClearIcon />} onClick={clearFilters}>
                    Clear
                  </Button>
                )}
                <Box sx={{ flex: 1 }} />
                <Typography color="text.secondary" sx={{ fontWeight: 800 }}>
                  {filteredServers.length} shown
                </Typography>
              </>
            )}
          </Stack>
        </Box>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox">
                  <Checkbox
                    size="small"
                    checked={allVisibleSelected}
                    indeterminate={partiallyVisibleSelected}
                    onChange={toggleVisibleSelection}
                    disabled={filteredServers.length === 0}
                    inputProps={{ 'aria-label': 'Select visible servers' }}
                  />
                </TableCell>
                <TableCell>{sortableHeader('Hostname', 'hostname')}</TableCell>
                <TableCell>{sortableHeader('Vendor', 'vendor')}</TableCell>
                <TableCell>{sortableHeader('Model', 'model')}</TableCell>
                <TableCell>{sortableHeader('Serial Number', 'serial_number')}</TableCell>
                <TableCell>{sortableHeader('Agent', 'agent_ip')}</TableCell>
                <TableCell>{sortableHeader('iLO / iDRAC / IPMI IP', 'bmc_ip')}</TableCell>
                <TableCell>Readiness</TableCell>
                <TableCell>Health</TableCell>
                <TableCell>{sortableHeader('Status', 'status')}</TableCell>
                <TableCell>{sortableHeader('Last Seen', 'last_seen')}</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredServers.map((server) => {
                const selected = selectedIds.includes(server.id);
                return (
                <TableRow key={server.id} hover selected={selected}>
                  <TableCell padding="checkbox">
                    <Checkbox
                      size="small"
                      checked={selected}
                      onChange={() => toggleServerSelection(server.id)}
                      inputProps={{ 'aria-label': `Select ${server.hostname ?? server.serial_number}` }}
                    />
                  </TableCell>
                  <TableCell>
                    <Link component={RouterLink} to={`/servers/${server.id}`} underline="hover" sx={{ fontWeight: 900, color: 'text.primary' }}>
                      {server.hostname ?? server.serial_number}
                    </Link>
                  </TableCell>
                  <TableCell>{vendorLabel(server.vendor)}</TableCell>
                  <TableCell>{server.model ?? '-'}</TableCell>
                  <TableCell>{server.serial_number}</TableCell>
                  <TableCell>
                    <Stack spacing={0.75} alignItems="flex-start">
                      <IpReachability ip={server.agent_ip} reachable={server.agent_reachable} />
                      <Tooltip title={server.management_config_json?.agent?.reported_at ? `Reported ${formatDate(server.management_config_json.agent.reported_at)}` : 'Agent version not reported yet'}>
                        <Chip
                          size="small"
                          label={agentVersionLabel(server)}
                          variant={server.management_config_json?.agent?.version ? 'filled' : 'outlined'}
                          sx={{ fontWeight: 800 }}
                        />
                      </Tooltip>
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Stack spacing={0.75} alignItems="flex-start">
                      <IpReachability ip={server.bmc_ip} reachable={server.bmc_reachable} />
                      <CredentialChip server={server} />
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Stack spacing={0.75} alignItems="flex-start">
                      <ReadinessChip server={server} />
                      {server.management_config_json?.license && <LicenseChip server={server} />}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <HealthChip server={server} />
                  </TableCell>
                  <TableCell>
                    <StatusChip status={server.status} />
                  </TableCell>
                  <TableCell>{formatDate(server.last_seen)}</TableCell>
                  <TableCell align="right">
                    <IconButton
                      aria-label={`Actions for ${server.hostname ?? server.serial_number}`}
                      size="small"
                      onClick={(event) => openMenu(event, server)}
                      sx={{ border: '1px solid', borderColor: 'divider', bgcolor: '#ffffff' }}
                    >
                      <MoreVertIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              );
              })}
              {filteredServers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={11}>
                    <Typography sx={{ py: 4, textAlign: 'center' }} color="text.secondary">
                      {servers.length === 0 ? 'No servers registered yet.' : 'No servers match the current filters.'}
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Paper variant="outlined" sx={{ overflow: 'hidden', borderColor: 'divider', bgcolor: '#ffffff' }}>
        <Box
          role="button"
          tabIndex={0}
          onClick={() => setTasksOpen((current) => !current)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              setTasksOpen((current) => !current);
            }
          }}
          sx={{
            px: { xs: 2, md: 2.5 },
            py: 1.25,
            borderBottom: tasksOpen ? '1px solid' : 0,
            borderColor: 'divider',
            bgcolor: '#eef4f3',
            cursor: 'pointer',
          }}
        >
          <Stack direction="row" alignItems="center" spacing={1.5}>
            <PendingActionsIcon fontSize="small" sx={{ color: 'primary.main' }} />
            <Typography variant="subtitle1" sx={{ fontWeight: 900 }}>
              Recent Tasks
            </Typography>
            {activeActionCount > 0 && (
              <Chip size="small" label={`${activeActionCount} active`} sx={{ bgcolor: '#fff8df', color: '#75611d', fontWeight: 900 }} />
            )}
            <Chip size="small" label={`Auto ${taskRefreshLabel}`} sx={{ bgcolor: '#f3f5f5', color: '#62666f', fontWeight: 800 }} />
            <Chip size="small" label={`Timeout ${RUNNING_TASK_TIMEOUT_MINUTES}m`} sx={{ bgcolor: '#fff1ef', color: '#8b3a33', fontWeight: 800 }} />
            <Box sx={{ flex: 1 }} />
            <Tooltip title="Refresh tasks" arrow>
              <IconButton
                size="small"
                onClick={(event) => {
                  event.stopPropagation();
                  refreshTasks().catch(() => undefined);
                }}
              >
                <RefreshIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title={tasksOpen ? 'Collapse tasks' : 'Expand tasks'} arrow>
              <IconButton size="small">
                {tasksOpen ? <ExpandMoreIcon fontSize="small" /> : <ExpandLessIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
          </Stack>
        </Box>
        <Collapse in={tasksOpen} timeout="auto" unmountOnExit>
          <TableContainer sx={{ maxHeight: 300 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>Task</TableCell>
                  <TableCell>Target</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Queued</TableCell>
                  <TableCell>Started</TableCell>
                  <TableCell>Completed</TableCell>
                  <TableCell>Result</TableCell>
                  <TableCell align="right">Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {actions.map((action) => {
                  const target = serverById.get(action.server_id);
                  const diskCount = typeof action.result_json?.disk_count === 'number'
                    ? action.result_json.disk_count
                    : action.result_json?.os_storage && typeof action.result_json.os_storage === 'object' && typeof (action.result_json.os_storage as Record<string, unknown>).disk_count === 'number'
                      ? (action.result_json.os_storage as Record<string, number>).disk_count
                      : null;
                  const toolAvailable = typeof action.result_json?.tool_available === 'boolean' ? action.result_json.tool_available : null;
                  const resultText = action.error_message || (
                    diskCount !== null
                      ? `OS disks: ${diskCount}${toolAvailable === false ? ' / ssacli missing' : ''}`
                      : action.status === 'succeeded'
                        ? 'Completed successfully'
                        : '-'
                  );
                  const detailLines = actionDetailLines(action, target);
                  return (
                    <TableRow key={action.id} hover>
                      <TableCell sx={{ fontWeight: 800 }}>
                        <Tooltip
                          arrow
                          title={
                            <Box>
                              {detailLines.map((line) => (
                                <Typography key={line} variant="caption" component="div">
                                  {line}
                                </Typography>
                              ))}
                            </Box>
                          }
                        >
                          <Stack direction="row" spacing={0.75} alignItems="center" sx={{ width: 'fit-content' }}>
                            <HelpOutlineIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                            <span>{actionLabel(action.action_type)}</span>
                          </Stack>
                        </Tooltip>
                      </TableCell>
                      <TableCell>
                        {target ? (
                          <Link component={RouterLink} to={`/servers/${target.id}`} underline="hover" sx={{ fontWeight: 800 }}>
                            {target.hostname ?? target.serial_number}
                          </Link>
                        ) : (
                          `Server #${action.server_id}`
                        )}
                      </TableCell>
                      <TableCell>
                        <ActionStatusChip status={action.status} />
                      </TableCell>
                      <TableCell>{formatDate(action.requested_at)}</TableCell>
                      <TableCell>{formatOptionalDate(action.started_at)}</TableCell>
                      <TableCell>{formatOptionalDate(action.completed_at)}</TableCell>
                      <TableCell>
                        <Typography
                          variant="body2"
                          color={action.status === 'failed' ? 'error.main' : 'text.secondary'}
                          sx={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          title={resultText}
                        >
                          {resultText}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        {action.action_type === 'hpe_storage_apply_plan' && action.status === 'planned' && (
                          <Button
                            size="small"
                            variant="contained"
                            color="warning"
                            onClick={() => executeStorageApply(action)}
                            disabled={executingActionId === action.id}
                          >
                            {executingActionId === action.id ? 'Running...' : 'Execute'}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {actions.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8}>
                      <Typography sx={{ py: 3, textAlign: 'center' }} color="text.secondary">
                        No queued actions yet.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Collapse>
      </Paper>

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={closeMenu}>
        <MenuItem onClick={openEdit}>
          <EditIcon fontSize="small" sx={{ mr: 1 }} />
          Edit
        </MenuItem>
        <MenuItem onClick={openManagementIp}>
          <SettingsEthernetIcon fontSize="small" sx={{ mr: 1 }} />
          Set Management Network
        </MenuItem>
        <MenuItem onClick={openIloUser}>
          <PersonAddAlt1Icon fontSize="small" sx={{ mr: 1 }} />
          Create iLO User
        </MenuItem>
        <MenuItem onClick={openIloLicense}>
          <VpnKeyIcon fontSize="small" sx={{ mr: 1 }} />
          Install iLO License
        </MenuItem>
        <MenuItem onClick={openIloEnrollment}>
          <QrCodeScannerIcon fontSize="small" sx={{ mr: 1 }} />
          Scan iLO Tag
        </MenuItem>
        <MenuItem
          onClick={refreshSelectedServerInventory}
          disabled={!selectedServerCanRefreshInventory || refreshingInventoryId === selectedServer?.id}
        >
          {refreshingInventoryId === selectedServer?.id ? (
            <CircularProgress size={18} sx={{ mr: 1 }} />
          ) : (
            <RefreshIcon fontSize="small" sx={{ mr: 1 }} />
          )}
          {refreshingInventoryId === selectedServer?.id ? 'Refreshing Inventory...' : 'Refresh Redfish Inventory'}
        </MenuItem>
        <MenuItem
          component={RouterLink}
          to={selectedServer ? `/servers/${selectedServer.id}#raid-config` : '/'}
          onClick={closeMenu}
          disabled={!selectedServer}
        >
          <StorageIcon fontSize="small" sx={{ mr: 1 }} />
          RAID Config
        </MenuItem>
        <MenuItem onClick={queueOsStorageValidation} disabled={!selectedServer || selectedServer.status === 'deregistered'}>
          <TaskAltIcon fontSize="small" sx={{ mr: 1 }} />
          Validate OS Storage
        </MenuItem>
        <MenuItem onClick={queueHpeStorageInventory} disabled={!selectedServer || selectedServer.status === 'deregistered'}>
          <StorageIcon fontSize="small" sx={{ mr: 1 }} />
          HPE Storage Inventory
        </MenuItem>
        <MenuItem onClick={refreshList}>
          <RefreshIcon fontSize="small" sx={{ mr: 1 }} />
          Refresh
        </MenuItem>
        <MenuItem onClick={removeSelectedServer} sx={{ color: 'error.main' }}>
          <DeleteOutlineIcon fontSize="small" sx={{ mr: 1 }} />
          Delete
        </MenuItem>
        <MenuItem onClick={deregisterSelectedServer} sx={{ color: 'text.secondary' }}>
          <CancelIcon fontSize="small" sx={{ mr: 1 }} />
          Deregister
        </MenuItem>
      </Menu>

      <Dialog open={enrollmentOpen} onClose={closeEnrollment} fullWidth maxWidth="sm">
        <DialogTitle sx={{ fontWeight: 900 }}>Scan iLO Tag</DialogTitle>
        <DialogContent>
          <Stack spacing={2} alignItems="center" sx={{ pt: 1 }}>
            <Typography color="text.secondary">
              {selectedServer?.hostname ?? selectedServer?.serial_number}
            </Typography>
            <QrCode value={enrollmentUrl} />
            <TextField
              fullWidth
              label="Mobile enrollment link"
              value={enrollmentUrl}
              InputProps={{ readOnly: true }}
            />
            {enrollmentExpiresAt && (
              <Typography variant="body2" color="text.secondary">
                Expires {formatDate(enrollmentExpiresAt)}
              </Typography>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeEnrollment}>Close</Button>
          <Button
            startIcon={<ContentCopyIcon />}
            variant="outlined"
            onClick={() => {
              if (enrollmentUrl) navigator.clipboard?.writeText(enrollmentUrl);
            }}
          >
            Copy
          </Button>
          <Button component="a" href={enrollmentUrl} target="_blank" rel="noreferrer" variant="contained" disabled={!enrollmentUrl}>
            Open
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={managementIpOpen} onClose={closeManagementIp} fullWidth maxWidth="sm">
        <DialogTitle sx={{ fontWeight: 900 }}>Set Management Network</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography color="text.secondary">
              {selectedServer?.hostname ?? selectedServer?.serial_number}
            </Typography>
            {!hasUsableActionCredential(selectedServer) && (
              <Alert severity="warning">
                iLO credential is not validated yet. Enter the Administrator username/password to queue this action.
              </Alert>
            )}
            {selectedServer && !selectedServer.bmc_ip && (
              <Alert severity="info">
                No BMC IP is stored yet. The agent will try the local Redfish endpoint first; once credentials are valid, the BMC IP should be refreshed.
              </Alert>
            )}
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <TextField
                  autoFocus
                  fullWidth
                  label="iLO / iDRAC / IPMI IP"
                  placeholder="192.168.88.160"
                  value={managementConfig.ip ?? ''}
                  onChange={(event) => setManagementConfig({ ...managementConfig, ip: event.target.value })}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Subnet Mask / CIDR"
                  placeholder="255.255.255.0 or /24"
                  value={managementConfig.subnet ?? ''}
                  onChange={(event) => setManagementConfig({ ...managementConfig, subnet: event.target.value })}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Gateway"
                  placeholder="192.168.88.1"
                  value={managementConfig.gateway ?? ''}
                  onChange={(event) => setManagementConfig({ ...managementConfig, gateway: event.target.value })}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="DNS"
                  placeholder="192.168.88.1, 8.8.8.8"
                  value={managementConfig.dns ?? ''}
                  onChange={(event) => setManagementConfig({ ...managementConfig, dns: event.target.value })}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="NTP"
                  placeholder="pool.ntp.org"
                  value={managementConfig.ntp ?? ''}
                  onChange={(event) => setManagementConfig({ ...managementConfig, ntp: event.target.value })}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="VLAN ID"
                  placeholder="0"
                  helperText="0 = access / untagged; any other VLAN ID = tagged"
                  value={managementConfig.vlan ?? ''}
                  onChange={(event) => setManagementConfig({ ...managementConfig, vlan: event.target.value })}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="iLO Admin Username"
                  placeholder="Administrator"
                  value={managementConfig.admin_username ?? ''}
                  onChange={(event) => setManagementConfig({ ...managementConfig, admin_username: event.target.value })}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="iLO Admin Password"
                  type={showNetworkAdminPassword ? 'text' : 'password'}
                  value={managementConfig.admin_password ?? ''}
                  onChange={(event) => setManagementConfig({ ...managementConfig, admin_password: event.target.value })}
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        <Tooltip title={showNetworkAdminPassword ? 'Hide password' : 'Show password'} arrow>
                          <IconButton size="small" onClick={() => setShowNetworkAdminPassword((current) => !current)} edge="end">
                            {showNetworkAdminPassword ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                          </IconButton>
                        </Tooltip>
                      </InputAdornment>
                    ),
                  }}
                />
              </Grid>
            </Grid>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeManagementIp}>Cancel</Button>
          <Button
            onClick={saveManagementIp}
            variant="contained"
            disabled={
              saving ||
              !managementConfig.ip?.trim() ||
              !managementConfig.admin_username?.trim() ||
              !managementConfig.admin_password?.trim()
            }
          >
            Queue Network Action
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={iloUserOpen} onClose={closeIloUser} fullWidth maxWidth="sm">
        <DialogTitle sx={{ fontWeight: 900 }}>Create iLO User</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography color="text.secondary">
              {selectedServer?.hostname ?? selectedServer?.serial_number}
            </Typography>
            {!hasUsableActionCredential(selectedServer) && (
              <Alert severity="warning">
                First-time setup needs the iLO Administrator credential. After hpadmin is created, later actions will use hpadmin.
              </Alert>
            )}
            {selectedServer?.management_config_json?.managed_user?.created && (
              <Alert severity="success">
                Managed iLO user already exists. Protected actions will use hpadmin; enter a different username only if another iLO user is needed.
              </Alert>
            )}
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="iLO Admin Username"
                  value={iloUserForm.adminUsername}
                  onChange={(event) => setIloUserForm({ ...iloUserForm, adminUsername: event.target.value })}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="iLO Admin Password"
                  type={showIloAdminPassword ? 'text' : 'password'}
                  value={iloUserForm.adminPassword}
                  onChange={(event) => setIloUserForm({ ...iloUserForm, adminPassword: event.target.value })}
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        <Tooltip title={showIloAdminPassword ? 'Hide password' : 'Show password'} arrow>
                          <IconButton size="small" onClick={() => setShowIloAdminPassword((current) => !current)} edge="end">
                            {showIloAdminPassword ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                          </IconButton>
                        </Tooltip>
                      </InputAdornment>
                    ),
                  }}
                />
              </Grid>
            </Grid>
            <TextField
              autoFocus
              fullWidth
              label="New iLO Username"
              value={iloUserForm.username}
              onChange={(event) => setIloUserForm({ ...iloUserForm, username: event.target.value })}
            />
            <TextField
              fullWidth
              label="New iLO Password"
              type={showIloPassword ? 'text' : 'password'}
              value={iloUserForm.password}
              onChange={(event) => setIloUserForm({ ...iloUserForm, password: event.target.value })}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <Tooltip title={showIloPassword ? 'Hide password' : 'Show password'} arrow>
                      <IconButton size="small" onClick={() => setShowIloPassword((current) => !current)} edge="end">
                        {showIloPassword ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                      </IconButton>
                    </Tooltip>
                  </InputAdornment>
                ),
              }}
            />
            <TextField
              fullWidth
              label="Confirm Password"
              type={showIloConfirmPassword ? 'text' : 'password'}
              value={iloUserForm.confirmPassword}
              onChange={(event) => setIloUserForm({ ...iloUserForm, confirmPassword: event.target.value })}
              error={Boolean(iloUserForm.confirmPassword) && iloUserForm.password !== iloUserForm.confirmPassword}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <Tooltip title={showIloConfirmPassword ? 'Hide password' : 'Show password'} arrow>
                      <IconButton size="small" onClick={() => setShowIloConfirmPassword((current) => !current)} edge="end">
                        {showIloConfirmPassword ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                      </IconButton>
                    </Tooltip>
                  </InputAdornment>
                ),
              }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeIloUser}>Cancel</Button>
          <Button
            onClick={saveIloUser}
            variant="contained"
            disabled={
              saving ||
              !iloUserForm.username.trim() ||
              !iloUserForm.password.trim() ||
              !iloUserForm.confirmPassword.trim() ||
              iloUserForm.password !== iloUserForm.confirmPassword ||
              !iloUserForm.adminUsername.trim() ||
              !iloUserForm.adminPassword.trim()
            }
          >
            Queue User Action
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={iloLicenseOpen} onClose={closeIloLicense} fullWidth maxWidth="sm">
        <DialogTitle sx={{ fontWeight: 900 }}>Install iLO License</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography color="text.secondary">
              {selectedServer?.hostname ?? selectedServer?.serial_number}
            </Typography>
            {!hasUsableActionCredential(selectedServer) && (
              <Alert severity="warning">
                iLO license installation needs a validated iLO credential or an Administrator username/password.
              </Alert>
            )}
            <TextField
              autoFocus
              fullWidth
              label="iLO License Key"
              value={iloLicenseForm.licenseKey}
              onChange={(event) => setIloLicenseForm({ ...iloLicenseForm, licenseKey: event.target.value })}
            />
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="iLO Admin Username"
                  value={iloLicenseForm.adminUsername}
                  onChange={(event) => setIloLicenseForm({ ...iloLicenseForm, adminUsername: event.target.value })}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="iLO Admin Password"
                  type={showLicenseAdminPassword ? 'text' : 'password'}
                  value={iloLicenseForm.adminPassword}
                  onChange={(event) => setIloLicenseForm({ ...iloLicenseForm, adminPassword: event.target.value })}
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        <Tooltip title={showLicenseAdminPassword ? 'Hide password' : 'Show password'} arrow>
                          <IconButton size="small" onClick={() => setShowLicenseAdminPassword((current) => !current)} edge="end">
                            {showLicenseAdminPassword ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                          </IconButton>
                        </Tooltip>
                      </InputAdornment>
                    ),
                  }}
                />
              </Grid>
            </Grid>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeIloLicense}>Cancel</Button>
          <Button
            onClick={saveIloLicense}
            variant="contained"
            disabled={
              saving ||
              !iloLicenseForm.licenseKey.trim() ||
              !iloLicenseForm.adminUsername.trim() ||
              !iloLicenseForm.adminPassword.trim()
            }
          >
            Queue License Action
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={editOpen} onClose={closeEdit} fullWidth maxWidth="sm">
        <DialogTitle sx={{ fontWeight: 900 }}>Edit Server</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField label="Hostname" value={form.hostname ?? ''} onChange={(event) => setForm({ ...form, hostname: event.target.value })} />
            <TextField label="Vendor" value={form.vendor ?? ''} onChange={(event) => setForm({ ...form, vendor: event.target.value })} />
            <TextField label="Model" value={form.model ?? ''} onChange={(event) => setForm({ ...form, model: event.target.value })} />
            <TextField
              label="Product Name"
              value={form.product_name ?? ''}
              onChange={(event) => setForm({ ...form, product_name: event.target.value })}
            />
            <TextField label="Agent IP" value={form.agent_ip ?? ''} onChange={(event) => setForm({ ...form, agent_ip: event.target.value })} />
            <TextField label="iLO / iDRAC / IPMI IP" value={form.bmc_ip ?? ''} onChange={(event) => setForm({ ...form, bmc_ip: event.target.value })} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeEdit}>Cancel</Button>
          <Button onClick={saveEdit} variant="contained" disabled={saving}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

function Metric({ title, value, icon }: { title: string; value: number; icon: ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ p: 2.5, height: '100%', borderColor: 'divider' }}>
      <Stack direction="row" spacing={2} alignItems="center">
        <Box
          sx={{
            color: 'primary.main',
            bgcolor: 'primary.light',
            border: '1px solid',
            borderColor: 'divider',
            width: 48,
            height: 48,
            borderRadius: 1.5,
            display: 'grid',
            placeItems: 'center',
          }}
        >
          {icon}
        </Box>
        <Box>
          <Typography color="text.secondary" variant="body2" sx={{ fontWeight: 800 }}>
            {title}
          </Typography>
          <Typography variant="h4" sx={{ fontWeight: 900 }}>
            {value}
          </Typography>
        </Box>
      </Stack>
    </Paper>
  );
}
