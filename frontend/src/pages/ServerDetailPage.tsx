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
  Typography,
} from '@mui/material';
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

function ReachabilityChip({ reachable }: { reachable: boolean | null }) {
  if (reachable === null) {
    return <Chip size="small" label="Unknown" sx={{ bgcolor: '#f3f5f5', color: '#62666f' }} />;
  }

  return (
    <Chip
      size="small"
      label={reachable ? 'Ping OK' : 'No Ping'}
      sx={{
        bgcolor: reachable ? '#e7f7ef' : '#fff1ef',
        color: reachable ? '#1f7d55' : '#b23b32',
        border: '1px solid',
        borderColor: reachable ? '#bfe8d2' : '#f2c4bf',
      }}
    />
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

  const latestInventory = useMemo<Record<string, unknown>>(() => server?.inventories[0]?.inventory_json ?? {}, [server]);

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
            {server.vendor ?? 'Unknown vendor'} {server.model ?? ''}
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
              ['iLO / iDRAC / IPMI IP', <IpReachability ip={server.bmc_ip} reachable={server.bmc_reachable} />],
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
          Hardware Inventory
        </Typography>
        <Divider sx={{ my: 2, borderColor: 'divider' }} />
        <Grid container spacing={2}>
          {['system', 'cpu', 'memory', 'storage', 'network', 'bmc'].map((section) => (
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
