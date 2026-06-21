import { MouseEvent, ReactNode, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  IconButton,
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
  Typography,
} from '@mui/material';
import DnsIcon from '@mui/icons-material/Dns';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DownloadIcon from '@mui/icons-material/Download';
import EditIcon from '@mui/icons-material/Edit';
import LanIcon from '@mui/icons-material/Lan';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import PowerSettingsNewIcon from '@mui/icons-material/PowerSettingsNew';
import RefreshIcon from '@mui/icons-material/Refresh';
import { Link as RouterLink } from 'react-router-dom';
import { deleteServer, fetchServers, fetchStats, updateServer } from '../api/client';
import type { DashboardStats, ServerSummary, ServerUpdate } from '../types';

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

function StatusChip({ status }: { status: string }) {
  const color = status === 'online' ? 'success' : 'default';
  return <Chip size="small" color={color} label={status.toUpperCase()} />;
}

export function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats>(emptyStats);
  const [servers, setServers] = useState<ServerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [selectedServer, setSelectedServer] = useState<ServerSummary | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<ServerUpdate>({});
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      setError(null);
      const [statsData, serverData] = await Promise.all([fetchStats(), fetchServers()]);
      setStats(statsData);
      setServers(serverData);
    } catch {
      setError('Backend API is not reachable.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

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

  async function refreshList() {
    closeMenu();
    await load();
  }

  function exportCsv() {
    const header = ['Hostname', 'Vendor', 'Model', 'Serial Number', 'Agent IP', 'BMC IP', 'Status', 'Last Seen'];
    const rows = servers.map((server) => [
      server.hostname ?? '',
      server.vendor ?? '',
      server.model ?? '',
      server.serial_number,
      server.agent_ip ?? '',
      server.bmc_ip ?? '',
      server.status,
      server.last_seen,
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','))
      .join('\n');
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
      <Box>
        <Typography variant="h4" sx={{ fontWeight: 800 }}>
          Server Discovery
        </Typography>
        <Typography color="text.secondary">
          Registered bare-metal inventory from KDX Live USB agents.
        </Typography>
      </Box>

      {error && <Alert severity="warning">{error}</Alert>}

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

      <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
        <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid #d8dee8' }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            Servers
          </Typography>
            <Stack direction="row" spacing={1}>
              <Button startIcon={<RefreshIcon />} size="small" variant="outlined" onClick={load}>
                Refresh
              </Button>
              <Button startIcon={<DownloadIcon />} size="small" variant="outlined" onClick={exportCsv} disabled={servers.length === 0}>
                Export CSV
              </Button>
            </Stack>
          </Stack>
        </Box>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Hostname</TableCell>
                <TableCell>Vendor</TableCell>
                <TableCell>Model</TableCell>
                <TableCell>Serial Number</TableCell>
                <TableCell>Agent IP</TableCell>
                <TableCell>BMC IP</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Last Seen</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {servers.map((server) => (
                <TableRow key={server.id} hover>
                  <TableCell>
                    <Link component={RouterLink} to={`/servers/${server.id}`} underline="hover" sx={{ fontWeight: 700 }}>
                      {server.hostname ?? server.serial_number}
                    </Link>
                  </TableCell>
                  <TableCell>{server.vendor ?? '-'}</TableCell>
                  <TableCell>{server.model ?? '-'}</TableCell>
                  <TableCell>{server.serial_number}</TableCell>
                  <TableCell>{server.agent_ip ?? '-'}</TableCell>
                  <TableCell>{server.bmc_ip ?? '-'}</TableCell>
                  <TableCell>
                    <StatusChip status={server.status} />
                  </TableCell>
                  <TableCell>{formatDate(server.last_seen)}</TableCell>
                  <TableCell align="right">
                    <IconButton
                      aria-label={`Actions for ${server.hostname ?? server.serial_number}`}
                      size="small"
                      onClick={(event) => openMenu(event, server)}
                    >
                      <MoreVertIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
              {servers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9}>
                    <Typography sx={{ py: 4, textAlign: 'center' }} color="text.secondary">
                      No servers registered yet.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={closeMenu}>
        <MenuItem onClick={openEdit}>
          <EditIcon fontSize="small" sx={{ mr: 1 }} />
          Edit
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

      <Dialog open={editOpen} onClose={closeEdit} fullWidth maxWidth="sm">
        <DialogTitle>Edit Server</DialogTitle>
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
            <TextField label="BMC / iLO IP" value={form.bmc_ip ?? ''} onChange={(event) => setForm({ ...form, bmc_ip: event.target.value })} />
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
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" spacing={2} alignItems="center">
        <Box sx={{ color: 'primary.main', display: 'grid', placeItems: 'center' }}>{icon}</Box>
        <Box>
          <Typography color="text.secondary" variant="body2">
            {title}
          </Typography>
          <Typography variant="h4" sx={{ fontWeight: 800 }}>
            {value}
          </Typography>
        </Box>
      </Stack>
    </Paper>
  );
}
