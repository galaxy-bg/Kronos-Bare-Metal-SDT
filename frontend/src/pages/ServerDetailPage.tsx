import { useEffect, useMemo, useState } from 'react';
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
            <Typography variant="h4" sx={{ fontWeight: 800 }}>
              {server.hostname ?? server.serial_number}
            </Typography>
            <Chip size="small" color={server.status === 'online' ? 'success' : 'default'} label={server.status.toUpperCase()} />
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
              ['Agent IP', server.agent_ip ?? '-'],
              ['BMC IP', server.bmc_ip ?? '-'],
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

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          Hardware Inventory
        </Typography>
        <Divider sx={{ my: 2 }} />
        <Grid container spacing={2}>
          {['system', 'cpu', 'memory', 'storage', 'network', 'bmc'].map((section) => (
            <Grid item xs={12} md={6} key={section}>
              <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 700, textTransform: 'uppercase' }}>
                {section}
              </Typography>
              <Box component="pre" sx={{ m: 0, p: 1.5, bgcolor: '#101828', color: '#e6edf3', borderRadius: 1, overflow: 'auto' }}>
                {JSON.stringify(latestInventory[section] ?? {}, null, 2)}
              </Box>
            </Grid>
          ))}
        </Grid>
      </Paper>
    </Stack>
  );
}

function InfoPanel({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
      <Typography variant="h6" sx={{ fontWeight: 700 }}>
        {title}
      </Typography>
      <Stack spacing={1.2} sx={{ mt: 2 }}>
        {rows.map(([label, value]) => (
          <Stack key={label} direction="row" justifyContent="space-between" spacing={2}>
            <Typography color="text.secondary">{label}</Typography>
            <Typography sx={{ fontWeight: 600, textAlign: 'right', overflowWrap: 'anywhere' }}>{value}</Typography>
          </Stack>
        ))}
      </Stack>
    </Paper>
  );
}
