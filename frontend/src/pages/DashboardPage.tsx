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
import TaskAltIcon from '@mui/icons-material/TaskAlt';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import { Link as RouterLink } from 'react-router-dom';
import {
  bulkDeleteServers,
  createIloEnrollment,
  createIloNetworkAction,
  createIloUserAction,
  deleteServer,
  fetchRecentActions,
  fetchServers,
  fetchStats,
  updateServer,
} from '../api/client';
import { QrCode } from '../components/QrCode';
import type { DashboardStats, ManagementConfig, ServerAction, ServerSummary, ServerUpdate } from '../types';

const emptyStats: DashboardStats = {
  total_servers: 0,
  online_servers: 0,
  offline_servers: 0,
};

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

function networkInterfacesFor(server: ServerSummary) {
  const network = server.latest_inventory_json?.network;
  return Array.isArray(network) ? network.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object') : [];
}

function actionLabel(actionType: string) {
  const labels: Record<string, string> = {
    hpe_create_ilo_user: 'Create iLO User',
    hpe_set_ilo_network: 'Set Management Network',
    hpe_verify_ilo_credential: 'Verify iLO Credential',
  };
  return labels[actionType] ?? actionType.split('_').join(' ');
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
  const [showIloPassword, setShowIloPassword] = useState(false);
  const [showIloConfirmPassword, setShowIloConfirmPassword] = useState(false);
  const [showIloAdminPassword, setShowIloAdminPassword] = useState(false);
  const [showNetworkAdminPassword, setShowNetworkAdminPassword] = useState(false);
  const [form, setForm] = useState<ServerUpdate>({});
  const [saving, setSaving] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [filterText, setFilterText] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [tasksOpen, setTasksOpen] = useState(true);
  const [includeReportPasswords, setIncludeReportPasswords] = useState(false);
  const [includeReportNicMacs, setIncludeReportNicMacs] = useState(true);

  const normalizedFilter = filterText.trim().toLowerCase();
  const filteredServers = servers.filter((server) => {
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
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return matchesStatus && (!normalizedFilter || searchable.includes(normalizedFilter));
  });
  const selectedVisibleIds = filteredServers.filter((server) => selectedIds.includes(server.id)).map((server) => server.id);
  const allVisibleSelected = filteredServers.length > 0 && selectedVisibleIds.length === filteredServers.length;
  const partiallyVisibleSelected = selectedVisibleIds.length > 0 && selectedVisibleIds.length < filteredServers.length;
  const serverById = new Map(servers.map((server) => [server.id, server]));
  const activeActionCount = actions.filter((action) => action.status === 'pending' || action.status === 'running').length;

  async function load() {
    try {
      setError(null);
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

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (activeActionCount === 0) return undefined;
    const timer = window.setInterval(() => {
      fetchRecentActions()
        .then(setActions)
        .catch(() => undefined);
      fetchServers()
        .then(setServers)
        .catch(() => undefined);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [activeActionCount]);

  useEffect(() => {
    if (actions.length === 0 || activeActionCount > 0) return undefined;
    const timer = window.setInterval(() => {
      fetchRecentActions()
        .then(setActions)
        .catch(() => undefined);
    }, 60000);
    return () => window.clearInterval(timer);
  }, [actions.length, activeActionCount]);

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
    const credential = credentialFor(selectedServer);
    setManagementConfig({
      ...(selectedServer.management_config_json ?? {}),
      ip: selectedServer.management_config_json?.ip ?? selectedServer.bmc_ip ?? '',
      vlan: selectedServer.management_config_json?.vlan ?? '0',
      admin_username: credential?.username ?? 'Administrator',
      admin_password: credential?.password ?? '',
    });
    setShowNetworkAdminPassword(false);
    setManagementIpOpen(true);
    closeMenu();
  }

  function openIloUser() {
    if (!selectedServer) return;
    const credential = credentialFor(selectedServer);
    setIloUserForm({
      username: selectedServer.management_config_json?.managed_user?.username ?? 'hpadmin',
      password: '',
      confirmPassword: '',
      adminUsername: credential?.username ?? 'Administrator',
      adminPassword: credential?.password ?? '',
    });
    setShowIloPassword(false);
    setShowIloConfirmPassword(false);
    setShowIloAdminPassword(false);
    setIloUserOpen(true);
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
      'iLO / iDRAC / IPMI IP',
      'iLO DNS Name',
      'iLO Credential Validated',
      'iLO Credential Validated At',
      'Administrator Username',
      'Managed iLO Username',
      'Managed iLO User Created',
      'Status',
      'Last Seen',
    ];
    const passwordHeader = ['Administrator Password', 'Managed iLO Password'];
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
        server.vendor ?? '',
        server.model ?? '',
        server.product_name ?? '',
        server.serial_number,
        server.agent_ip ?? '',
        server.bmc_ip ?? '',
        server.management_config_json?.dns_name ?? '',
        credential?.verified ? 'yes' : 'no',
        credential?.verified_at ?? '',
        credential?.username ?? '',
        managedUser?.username ?? '',
        managedUser?.created ? 'yes' : 'no',
        server.status,
        server.last_seen,
      ];
      const passwordRow = [credential?.password ?? '', managedUser?.password ?? ''];
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
                <TableCell>Hostname</TableCell>
                <TableCell>Vendor</TableCell>
                <TableCell>Model</TableCell>
                <TableCell>Serial Number</TableCell>
                <TableCell>Agent IP</TableCell>
                <TableCell>iLO / iDRAC / IPMI IP</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Last Seen</TableCell>
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
                  <TableCell>{server.vendor ?? '-'}</TableCell>
                  <TableCell>{server.model ?? '-'}</TableCell>
                  <TableCell>{server.serial_number}</TableCell>
                  <TableCell>
                    <IpReachability ip={server.agent_ip} reachable={server.agent_reachable} />
                  </TableCell>
                  <TableCell>
                    <IpReachability ip={server.bmc_ip} reachable={server.bmc_reachable} />
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
                  <TableCell colSpan={10}>
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
            <Box sx={{ flex: 1 }} />
            <Tooltip title="Refresh tasks" arrow>
              <IconButton
                size="small"
                onClick={(event) => {
                  event.stopPropagation();
                  fetchRecentActions().then(setActions);
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
                </TableRow>
              </TableHead>
              <TableBody>
                {actions.map((action) => {
                  const target = serverById.get(action.server_id);
                  const resultText = action.error_message || (action.status === 'succeeded' ? 'Completed successfully' : '-');
                  return (
                    <TableRow key={action.id} hover>
                      <TableCell sx={{ fontWeight: 800 }}>{actionLabel(action.action_type)}</TableCell>
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
                    </TableRow>
                  );
                })}
                {actions.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7}>
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
        <MenuItem onClick={openIloEnrollment}>
          <QrCodeScannerIcon fontSize="small" sx={{ mr: 1 }} />
          Scan iLO Tag
        </MenuItem>
        <MenuItem onClick={refreshList}>
          <RefreshIcon fontSize="small" sx={{ mr: 1 }} />
          Refresh
        </MenuItem>
        <MenuItem onClick={removeSelectedServer} sx={{ color: 'error.main' }}>
          <DeleteOutlineIcon fontSize="small" sx={{ mr: 1 }} />
          Delete
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
          <Button onClick={saveManagementIp} variant="contained" disabled={saving}>
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
          <Button onClick={saveIloUser} variant="contained" disabled={saving}>
            Queue User Action
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
