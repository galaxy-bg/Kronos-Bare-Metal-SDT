import { ReactNode, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Grid,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import DnsIcon from '@mui/icons-material/Dns';
import LanIcon from '@mui/icons-material/Lan';
import PowerSettingsNewIcon from '@mui/icons-material/PowerSettingsNew';
import { Link as RouterLink } from 'react-router-dom';
import { fetchServers, fetchStats } from '../api/client';
import type { DashboardStats, ServerSummary } from '../types';

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

  useEffect(() => {
    async function load() {
      try {
        const [statsData, serverData] = await Promise.all([fetchStats(), fetchServers()]);
        setStats(statsData);
        setServers(serverData);
      } catch {
        setError('Backend API is not reachable.');
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

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
          Registered bare-metal inventory from KronOS Live USB agents.
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
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            Servers
          </Typography>
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
              </TableRow>
            </TableHead>
            <TableBody>
              {servers.map((server) => (
                <TableRow
                  key={server.id}
                  hover
                  component={RouterLink}
                  to={`/servers/${server.id}`}
                  sx={{ textDecoration: 'none', cursor: 'pointer' }}
                >
                  <TableCell>{server.hostname ?? '-'}</TableCell>
                  <TableCell>{server.vendor ?? '-'}</TableCell>
                  <TableCell>{server.model ?? '-'}</TableCell>
                  <TableCell>{server.serial_number}</TableCell>
                  <TableCell>{server.agent_ip ?? '-'}</TableCell>
                  <TableCell>{server.bmc_ip ?? '-'}</TableCell>
                  <TableCell>
                    <StatusChip status={server.status} />
                  </TableCell>
                  <TableCell>{formatDate(server.last_seen)}</TableCell>
                </TableRow>
              ))}
              {servers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8}>
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
