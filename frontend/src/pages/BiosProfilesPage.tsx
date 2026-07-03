import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  IconButton,
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
  Tooltip,
  Typography,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteIcon from '@mui/icons-material/Delete';
import DifferenceIcon from '@mui/icons-material/Difference';
import DownloadIcon from '@mui/icons-material/Download';
import EditIcon from '@mui/icons-material/Edit';
import PublishIcon from '@mui/icons-material/Publish';
import RefreshIcon from '@mui/icons-material/Refresh';
import ScienceIcon from '@mui/icons-material/Science';
import {
  applyBIOSProfileDryRun,
  cloneBIOSProfileFromServer,
  compareBIOSProfile,
  deleteBIOSProfile,
  deployBIOSProfile,
  fetchBIOSProfiles,
  fetchGlobalSettings,
  fetchServers,
  updateBIOSProfile,
} from '../api/client';
import type { BIOSCompareResult, BIOSProfile, GlobalSettings, ServerSummary } from '../types';

type EditState = {
  profile: BIOSProfile;
  name: string;
  workload: string;
  overridesJson: string;
};

function valueLabel(value: unknown) {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function downloadProfile(profile: BIOSProfile) {
  const blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${profile.name.replace(/[^a-z0-9._-]+/gi, '_')}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export function BiosProfilesPage() {
  const [profiles, setProfiles] = useState<BIOSProfile[]>([]);
  const [servers, setServers] = useState<ServerSummary[]>([]);
  const [settings, setSettings] = useState<GlobalSettings | null>(null);
  const [selectedServerId, setSelectedServerId] = useState('');
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [profileName, setProfileName] = useState('');
  const [compareResult, setCompareResult] = useState<BIOSCompareResult | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => String(profile.id) === selectedProfileId) ?? null,
    [profiles, selectedProfileId],
  );
  const selectedServer = useMemo(
    () => servers.find((server) => String(server.id) === selectedServerId) ?? null,
    [selectedServerId, servers],
  );
  const realDeployEnabled = Boolean(settings?.bios?.enable_real_apply);
  const deployBlockedReason = !realDeployEnabled
    ? 'Real BIOS deploy is disabled in Setup.'
    : !compareResult
      ? 'Run compare before deploy.'
    : compareResult?.diff.unsupported_count
      ? 'Deploy is blocked because unsupported attributes exist.'
    : !compareResult?.diff.changed_count
        ? 'No changed BIOS attributes to deploy.'
        : null;

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [profileRows, serverRows, settingsResult] = await Promise.all([
        fetchBIOSProfiles(),
        fetchServers(),
        fetchGlobalSettings(),
      ]);
      setProfiles(profileRows);
      setServers(serverRows);
      setSettings(settingsResult.settings);
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

  async function handleDeploy() {
    if (!selectedProfileId || !selectedServerId || deployBlockedReason) return;
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const job = await deployBIOSProfile(Number(selectedProfileId), Number(selectedServerId));
      setCompareResult({
        profile_id: job.profile_id,
        target_server_id: job.target_server_id,
        pending_reboot: job.pending_reboot,
        diff: job.diff_before_apply,
      });
      if (job.status === 'failed') {
        setError(job.error_message || 'BIOS deploy failed.');
      } else {
        setMessage(
          job.pending_reboot
            ? `Deploy job #${job.id} submitted. BIOS changes are pending reboot; reboot was not triggered.`
            : `Deploy job #${job.id} completed.`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'BIOS deploy failed.');
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(profile: BIOSProfile) {
    if (!window.confirm(`Delete BIOS profile "${profile.name}"?`)) return;
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      await deleteBIOSProfile(profile.id);
      setProfiles((current) => current.filter((item) => item.id !== profile.id));
      if (selectedProfileId === String(profile.id)) {
        setSelectedProfileId('');
        setCompareResult(null);
      }
      setMessage('BIOS profile deleted.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveEdit() {
    if (!editState) return;
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const overrides = editState.overridesJson.trim() ? JSON.parse(editState.overridesJson) : {};
      const updated = await updateBIOSProfile(editState.profile.id, {
        name: editState.name.trim(),
        base_workload_profile: editState.workload.trim() || null,
        custom_overrides: overrides,
      });
      setProfiles((current) => current.map((profile) => (profile.id === updated.id ? updated : profile)));
      setEditState(null);
      setCompareResult(null);
      setMessage('BIOS profile saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Profile could not be saved. Check override JSON.');
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
            Clone, edit, compare, export, and deploy HPE Redfish BIOS profiles.
          </Typography>
        </Box>
        <Button startIcon={<RefreshIcon />} variant="outlined" onClick={loadData} disabled={loading}>
          Refresh
        </Button>
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}
      {message && <Alert severity="success">{message}</Alert>}
      {!realDeployEnabled && (
        <Alert severity="info">Real BIOS deploy is currently disabled. Enable it from Setup after reviewing the diff.</Alert>
      )}

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
              sx={{ minWidth: 150 }}
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
              <TableCell align="right">Actions</TableCell>
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
                <TableCell align="right" onClick={(event) => event.stopPropagation()}>
                  <Tooltip title="Edit profile">
                    <IconButton
                      size="small"
                      onClick={() =>
                        setEditState({
                          profile,
                          name: profile.name,
                          workload: profile.base_workload_profile || '',
                          overridesJson: JSON.stringify(profile.custom_overrides || {}, null, 2),
                        })
                      }
                    >
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Download JSON">
                    <IconButton size="small" onClick={() => downloadProfile(profile)}>
                      <DownloadIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Delete profile">
                    <IconButton size="small" color="error" onClick={() => void handleDelete(profile)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
            {!profiles.length && (
              <TableRow>
                <TableCell colSpan={7} sx={{ color: 'text.secondary' }}>
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
            Compare / Deploy
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
            <Button startIcon={<ScienceIcon />} variant="outlined" onClick={handleDryRunApply} disabled={loading || !selectedProfileId}>
              Dry Run
            </Button>
            <Tooltip title={deployBlockedReason || 'Deploy changed BIOS attributes'}>
              <span>
                <Button
                  startIcon={<PublishIcon />}
                  variant="contained"
                  color="primary"
                  onClick={handleDeploy}
                  disabled={loading || !selectedProfileId || Boolean(deployBlockedReason)}
                >
                  Deploy
                </Button>
              </span>
            </Tooltip>
          </Stack>
          <Alert severity={deployBlockedReason ? 'warning' : 'info'}>
            {deployBlockedReason ||
              'Deploy writes only changed BIOS attributes through Redfish. Reboot is not automatic; changed BIOS settings remain pending until reboot.'}
          </Alert>
          {selectedProfile && selectedServer && (
            <Typography variant="body2" color="text.secondary">
              Selected profile {selectedProfile.name} targeting {selectedServer.hostname || selectedServer.serial_number}.
            </Typography>
          )}
          {compareResult && (
            <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
              <Box sx={{ p: 1.5, bgcolor: 'primary.light' }}>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Chip size="small" color="primary" label={`${compareResult.diff.changed_count} changes`} />
                  <Chip size="small" label={`${compareResult.diff.unsupported_count} unsupported`} />
                  {compareResult.pending_reboot && <Chip size="small" color="warning" label="reboot required after deploy" />}
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

      <Dialog open={Boolean(editState)} onClose={() => setEditState(null)} maxWidth="md" fullWidth>
        <DialogTitle>Edit BIOS Profile</DialogTitle>
        {editState && (
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 1 }}>
              <TextField
                label="Profile Name"
                value={editState.name}
                onChange={(event) => setEditState({ ...editState, name: event.target.value })}
              />
              <TextField
                label="HPE Workload Profile"
                value={editState.workload}
                onChange={(event) => setEditState({ ...editState, workload: event.target.value })}
                helperText="Example: Virtualization-MaxPerformance, Virtualization-PowerEfficient, Custom"
              />
              <TextField
                label="Custom Overrides JSON"
                value={editState.overridesJson}
                onChange={(event) => setEditState({ ...editState, overridesJson: event.target.value })}
                multiline
                minRows={8}
                helperText='Example: {"PowerRegulator":"StaticHighPerf","ProcSMT":"Enabled"}'
              />
            </Stack>
          </DialogContent>
        )}
        <DialogActions>
          <Button onClick={() => setEditState(null)}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveEdit} disabled={loading || !editState?.name.trim()}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
