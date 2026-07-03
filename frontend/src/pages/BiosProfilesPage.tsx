import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DifferenceIcon from '@mui/icons-material/Difference';
import ScienceIcon from '@mui/icons-material/Science';
import RefreshIcon from '@mui/icons-material/Refresh';
import {
  applyBIOSProfileDryRun,
  cloneBIOSProfileFromServer,
  compareBIOSProfile,
  fetchBIOSProfiles,
  fetchServers,
} from '../api/client';
import type { BIOSCompareResult, BIOSProfile, ServerSummary } from '../types';

function valueLabel(value: unknown) {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

export function BiosProfilesPage() {
  const [profiles, setProfiles] = useState<BIOSProfile[]>([]);
  const [servers, setServers] = useState<ServerSummary[]>([]);
  const [selectedServerId, setSelectedServerId] = useState('');
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [profileName, setProfileName] = useState('');
  const [compareResult, setCompareResult] = useState<BIOSCompareResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const selectedServer = useMemo(
    () => servers.find((server) => String(server.id) === selectedServerId),
    [selectedServerId, servers],
  );

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [profileRows, serverRows] = await Promise.all([fetchBIOSProfiles(), fetchServers()]);
      setProfiles(profileRows);
      setServers(serverRows);
      if (!selectedServerId && serverRows[0]) setSelectedServerId(String(serverRows[0].id));
      if (!selectedProfileId && profileRows[0]) setSelectedProfileId(String(profileRows[0].id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load BIOS profiles.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  async function handleClone() {
    if (!selectedServerId || !profileName.trim()) return;
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const profile = await cloneBIOSProfileFromServer({ server_id: Number(selectedServerId), name: profileName.trim() });
      setProfiles((current) => [profile, ...current.filter((item) => item.id !== profile.id)]);
      setSelectedProfileId(String(profile.id));
      setProfileName('');
      setMessage(`BIOS profile cloned from ${selectedServer?.serial_number ?? 'server'}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Clone failed.');
    } finally {
      setLoading(false);
    }
  }

  async function handleCompare() {
    if (!selectedProfileId || !selectedServerId) return;
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const result = await compareBIOSProfile(Number(selectedProfileId), Number(selectedServerId));
      setCompareResult(result);
      setMessage(`Compare completed: ${result.diff.changed_count} changes, ${result.diff.unsupported_count} unsupported.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Compare failed.');
    } finally {
      setLoading(false);
    }
  }

  async function handleDryRunApply() {
    if (!selectedProfileId || !selectedServerId) return;
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const job = await applyBIOSProfileDryRun(Number(selectedProfileId), Number(selectedServerId));
      setCompareResult({
        profile_id: job.profile_id,
        target_server_id: job.target_server_id,
        pending_reboot: job.pending_reboot,
        diff: job.diff_before_apply,
      });
      setMessage(`Dry-run job #${job.id} created. No BIOS changes were applied.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Dry-run apply failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Stack spacing={2.5}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} justifyContent="space-between" alignItems={{ md: 'center' }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 900 }}>
            BIOS Profiles
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Clone, compare, and dry-run HPE Redfish BIOS profiles.
          </Typography>
        </Box>
        <Button startIcon={<RefreshIcon />} variant="outlined" onClick={loadData} disabled={loading}>
          Refresh
        </Button>
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}
      {message && <Alert severity="success">{message}</Alert>}

      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Stack spacing={2}>
          <Typography variant="h6" sx={{ fontWeight: 900 }}>
            Clone From Server
          </Typography>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
            <FormControl fullWidth size="small">
              <InputLabel>Source Server</InputLabel>
              <Select label="Source Server" value={selectedServerId} onChange={(event) => setSelectedServerId(event.target.value)}>
                {servers.map((server) => (
                  <MenuItem key={server.id} value={String(server.id)}>
                    {server.hostname || server.serial_number} / {server.bmc_ip || 'no iLO'}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              fullWidth
              size="small"
              label="Profile Name"
              value={profileName}
              onChange={(event) => setProfileName(event.target.value)}
              placeholder="DL325 Gen12 Golden BIOS"
            />
            <Button
              startIcon={<ContentCopyIcon />}
              variant="contained"
              onClick={handleClone}
              disabled={loading || !selectedServerId || !profileName.trim()}
              sx={{ minWidth: 160 }}
            >
              Clone
            </Button>
          </Stack>
        </Stack>
      </Paper>

      <Paper variant="outlined">
        <Box sx={{ p: 2.5 }}>
          <Typography variant="h6" sx={{ fontWeight: 900 }}>
            Saved Profiles
          </Typography>
        </Box>
        <Divider />
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Vendor</TableCell>
              <TableCell>Model</TableCell>
              <TableCell>Source</TableCell>
              <TableCell>Attributes</TableCell>
              <TableCell>Workload</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {profiles.map((profile) => (
              <TableRow
                key={profile.id}
                hover
                selected={String(profile.id) === selectedProfileId}
                onClick={() => setSelectedProfileId(String(profile.id))}
                sx={{ cursor: 'pointer' }}
              >
                <TableCell sx={{ fontWeight: 900 }}>{profile.name}</TableCell>
                <TableCell>{profile.vendor.toUpperCase()}</TableCell>
                <TableCell>{profile.server_model || '-'}</TableCell>
                <TableCell>
                  <Chip size="small" label={profile.source_type.replace(/_/g, ' ')} />
                </TableCell>
                <TableCell>{Object.keys(profile.final_attributes || {}).length}</TableCell>
                <TableCell>{profile.base_workload_profile || '-'}</TableCell>
              </TableRow>
            ))}
            {!profiles.length && (
              <TableRow>
                <TableCell colSpan={6} sx={{ color: 'text.secondary' }}>
                  No BIOS profiles yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Stack spacing={2}>
          <Typography variant="h6" sx={{ fontWeight: 900 }}>
            Compare / Dry-Run Apply
          </Typography>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
            <FormControl fullWidth size="small">
              <InputLabel>Profile</InputLabel>
              <Select label="Profile" value={selectedProfileId} onChange={(event) => setSelectedProfileId(event.target.value)}>
                {profiles.map((profile) => (
                  <MenuItem key={profile.id} value={String(profile.id)}>
                    {profile.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel>Target Server</InputLabel>
              <Select label="Target Server" value={selectedServerId} onChange={(event) => setSelectedServerId(event.target.value)}>
                {servers.map((server) => (
                  <MenuItem key={server.id} value={String(server.id)}>
                    {server.hostname || server.serial_number} / {server.bmc_ip || 'no iLO'}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Button startIcon={<DifferenceIcon />} variant="outlined" onClick={handleCompare} disabled={loading || !selectedProfileId}>
              Compare
            </Button>
            <Button startIcon={<ScienceIcon />} variant="contained" onClick={handleDryRunApply} disabled={loading || !selectedProfileId}>
              Dry Run
            </Button>
          </Stack>
          {compareResult && (
            <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
              <Box sx={{ p: 1.5, bgcolor: 'primary.light' }}>
                <Stack direction="row" spacing={1}>
                  <Chip size="small" color="primary" label={`${compareResult.diff.changed_count} changes`} />
                  <Chip size="small" label={`${compareResult.diff.unsupported_count} unsupported`} />
                  {compareResult.pending_reboot && <Chip size="small" color="warning" label="pending reboot" />}
                </Stack>
              </Box>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Attribute</TableCell>
                    <TableCell>Current</TableCell>
                    <TableCell>Desired</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {Object.entries(compareResult.diff.changed).map(([name, item]) => (
                    <TableRow key={name}>
                      <TableCell sx={{ fontWeight: 900 }}>{name}</TableCell>
                      <TableCell>{valueLabel(item.current)}</TableCell>
                      <TableCell>{valueLabel(item.desired)}</TableCell>
                    </TableRow>
                  ))}
                  {!Object.keys(compareResult.diff.changed).length && (
                    <TableRow>
                      <TableCell colSpan={3} sx={{ color: 'text.secondary' }}>
                        No changed BIOS attributes.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Box>
          )}
        </Stack>
      </Paper>
    </Stack>
  );
}
