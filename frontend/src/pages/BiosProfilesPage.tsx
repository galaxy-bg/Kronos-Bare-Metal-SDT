import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
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
  createBIOSProfile,
  deleteBIOSProfile,
  deployBIOSProfile,
  fetchBIOSProfiles,
  fetchBIOSWorkloadOptions,
  fetchGlobalSettings,
  fetchServers,
  updateBIOSProfile,
  validateBIOSProfileAttributes,
} from '../api/client';
import type { BIOSCompareResult, BIOSProfile, BIOSProfileValidationResult, BIOSWorkloadOptions, GlobalSettings, ServerSummary } from '../types';

type EditState = {
  profile: BIOSProfile;
  name: string;
  workload: string;
  overridesJson: string;
};

type CreateSource = 'clone' | 'template' | 'existing';

const biosTemplates = [
  {
    id: 'os_controlled_power',
    name: 'OS Controlled Power',
    description: 'Lets ESXi or Linux control CPU power policy.',
    workload: '',
    attributes: { PowerRegulator: 'OsControl' },
  },
  {
    id: 'virtualization_baseline',
    name: 'Virtualization Baseline',
    description: 'Small, safe baseline for virtualized hosts.',
    workload: 'Virtualization-MaxPerformance',
    attributes: { PowerRegulator: 'OsControl', ProcSMT: 'Enabled' },
  },
  {
    id: 'performance_baseline',
    name: 'Performance Baseline',
    description: 'Performance-oriented starting point for compute nodes.',
    workload: 'GeneralPowerEfficientCompute',
    attributes: { PowerRegulator: 'StaticHighPerf' },
  },
];

function stringifyAttributes(attributes: Record<string, unknown>) {
  return JSON.stringify(attributes, null, 2);
}

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

function parseScalar(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  const numeric = Number(trimmed);
  if (!Number.isNaN(numeric) && trimmed !== '') return numeric;
  return trimmed;
}

function parseAttributes(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  if (!trimmed) return {};
  if (trimmed.startsWith('{')) return JSON.parse(trimmed) as Record<string, unknown>;

  const result: Record<string, unknown> = {};
  trimmed.split('\n').forEach((line) => {
    const clean = line.trim();
    if (!clean || clean.startsWith('#')) return;
    const separator = clean.indexOf(':');
    if (separator <= 0) throw new Error(`Invalid attribute line: ${line}`);
    const key = clean.slice(0, separator).trim();
    result[key] = parseScalar(clean.slice(separator + 1));
  });
  return result;
}

function validationSummary(result: BIOSProfileValidationResult | null) {
  if (!result) return null;
  const unsupported = Object.keys(result.unsupported || {}).length;
  const invalid = Object.keys(result.invalid_values || {}).length;
  if (result.valid) return `Valid: ${result.checked_count} BIOS attributes checked.`;
  return `Invalid: ${unsupported} unsupported, ${invalid} invalid values.`;
}

const biosJsonEditorSx = {
  '& textarea': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
    fontSize: 14,
    lineHeight: 1.55,
    maxHeight: { xs: '300px', md: '42vh' },
    overflow: 'auto !important',
    whiteSpace: 'pre',
  },
};

export function BiosProfilesPage() {
  const [profiles, setProfiles] = useState<BIOSProfile[]>([]);
  const [servers, setServers] = useState<ServerSummary[]>([]);
  const [settings, setSettings] = useState<GlobalSettings | null>(null);
  const [selectedServerId, setSelectedServerId] = useState('');
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [createSource, setCreateSource] = useState<CreateSource>('clone');
  const [templateId, setTemplateId] = useState(biosTemplates[0].id);
  const [sourceProfileId, setSourceProfileId] = useState('');
  const [profileName, setProfileName] = useState('');
  const [cloneWorkload, setCloneWorkload] = useState('');
  const [customWorkload, setCustomWorkload] = useState('');
  const [customAttributesText, setCustomAttributesText] = useState(stringifyAttributes(biosTemplates[0].attributes));
  const [customValidation, setCustomValidation] = useState<BIOSProfileValidationResult | null>(null);
  const [workloadOptions, setWorkloadOptions] = useState<BIOSWorkloadOptions | null>(null);
  const [compareResult, setCompareResult] = useState<BIOSCompareResult | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [editValidation, setEditValidation] = useState<BIOSProfileValidationResult | null>(null);
  const [deployPostReboot, setDeployPostReboot] = useState(false);
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
  const selectedTemplate = useMemo(
    () => biosTemplates.find((template) => template.id === templateId) ?? biosTemplates[0],
    [templateId],
  );
  const sourceProfile = useMemo(
    () => profiles.find((profile) => String(profile.id) === sourceProfileId) ?? null,
    [profiles, sourceProfileId],
  );
  const realDeployEnabled = Boolean(settings?.bios?.enable_real_apply);
  const deployBlockedReason = !realDeployEnabled
    ? 'Real BIOS deploy is disabled in Settings.'
    : !compareResult
      ? 'Run compare before deploy.'
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
      if (!sourceProfileId && profileRows[0]) setSourceProfileId(String(profileRows[0].id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load BIOS profiles.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    if (!selectedServerId) {
      setWorkloadOptions(null);
      return;
    }
    fetchBIOSWorkloadOptions(Number(selectedServerId))
      .then((result) => {
        setWorkloadOptions(result);
        setCloneWorkload(result.current || '');
        setCustomWorkload(result.current || '');
        setCustomValidation(null);
        setEditValidation(null);
      })
      .catch(() => setWorkloadOptions(null));
  }, [selectedServerId]);

  useEffect(() => {
    if (createSource !== 'template') return;
    setCustomWorkload(selectedTemplate.workload || workloadOptions?.current || '');
    setCustomAttributesText(stringifyAttributes(selectedTemplate.attributes));
    setCustomValidation(null);
  }, [createSource, selectedTemplate, workloadOptions?.current]);

  useEffect(() => {
    if (createSource !== 'existing' || !sourceProfile) return;
    const attributes = { ...(sourceProfile.final_attributes || {}) };
    delete attributes.WorkloadProfile;
    setCustomWorkload(sourceProfile.base_workload_profile || workloadOptions?.current || '');
    setCustomAttributesText(stringifyAttributes(attributes));
    setCustomValidation(null);
  }, [createSource, sourceProfile, workloadOptions?.current]);

  async function handleClone() {
    if (!selectedServerId || !profileName.trim()) return;
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const profile = await cloneBIOSProfileFromServer({
        server_id: Number(selectedServerId),
        name: profileName.trim(),
        base_workload_profile: cloneWorkload.trim() || null,
      });
      setProfiles((current) => [profile, ...current.filter((item) => item.id !== profile.id)]);
      setSelectedProfileId(String(profile.id));
      setProfileName('');
      setCloneWorkload(workloadOptions?.current || '');
      setMessage(`BIOS profile cloned from ${selectedServer?.serial_number ?? 'server'}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Clone failed.');
    } finally {
      setLoading(false);
    }
  }

  async function handleValidateCustom() {
    if (!selectedServerId || createSource === 'clone') return;
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const attributes = parseAttributes(customAttributesText);
      const result = await validateBIOSProfileAttributes(Number(selectedServerId), attributes, customWorkload.trim() || null);
      setCustomValidation(result);
      setMessage(result.valid ? validationSummary(result) : null);
    } catch (err) {
      setCustomValidation(null);
      setError(err instanceof Error ? err.message : 'BIOS profile validation failed.');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateCustom() {
    if (!profileName.trim() || !customValidation?.valid) return;
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const attributes = parseAttributes(customAttributesText);
      const profile = await createBIOSProfile({
        name: profileName.trim(),
        vendor: 'hpe',
        source_type: createSource === 'existing' ? 'derived_from_profile' : 'template',
        source_server_id: selectedServerId ? Number(selectedServerId) : null,
        base_workload_profile: customWorkload.trim() || null,
        normalized_attributes: {},
        custom_overrides: attributes,
      });
      setProfiles((current) => [profile, ...current.filter((item) => item.id !== profile.id)]);
      setSelectedProfileId(String(profile.id));
      setProfileName('');
      setCustomValidation(null);
      setMessage('BIOS profile created.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'BIOS profile could not be created.');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateProfile() {
    if (createSource === 'clone') {
      await handleClone();
      return;
    }
    await handleCreateCustom();
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
      const job = await deployBIOSProfile(Number(selectedProfileId), Number(selectedServerId), deployPostReboot);
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
            ? `Deploy job #${job.id} submitted. BIOS changes are pending reboot${deployPostReboot ? '; reboot task was planned.' : '; reboot was not triggered.'}`
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
      const overrides = parseAttributes(editState.overridesJson);
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

  async function handleValidateEdit() {
    if (!editState || !selectedServerId) return;
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const overrides = parseAttributes(editState.overridesJson);
      const result = await validateBIOSProfileAttributes(Number(selectedServerId), overrides, editState.workload.trim() || null);
      setEditValidation(result);
      setMessage(result.valid ? validationSummary(result) : null);
    } catch (err) {
      setEditValidation(null);
      setError(err instanceof Error ? err.message : 'BIOS profile validation failed.');
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
        <Alert severity="info">Real BIOS deploy is currently disabled. Enable it from Settings after reviewing the diff.</Alert>
      )}

      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Stack spacing={2}>
          <Typography variant="h6" sx={{ fontWeight: 900 }}>
            Create BIOS Profile
          </Typography>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }}>
            <FormControl size="small" sx={{ flex: '0 1 260px', minWidth: { xs: '100%', md: 260 } }}>
              <InputLabel>Source</InputLabel>
              <Select
                label="Source"
                value={createSource}
                onChange={(event) => {
                  setCreateSource(event.target.value as CreateSource);
                  setCustomValidation(null);
                }}
              >
                <MenuItem value="clone">Clone from server</MenuItem>
                <MenuItem value="template">Start from template</MenuItem>
                <MenuItem value="existing">Start from existing profile</MenuItem>
              </Select>
            </FormControl>
            <TextField
              size="small"
              label="Profile Name"
              value={profileName}
              onChange={(event) => setProfileName(event.target.value)}
              placeholder="DL325 Gen12 Golden BIOS"
              sx={{ flex: '1 1 260px', minWidth: { xs: '100%', md: 260 } }}
            />
          </Stack>

          {createSource === 'clone' && (
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
              <FormControl size="small" sx={{ flex: '1 1 280px', minWidth: { xs: '100%', md: 280 } }}>
                <InputLabel>Source Server</InputLabel>
                <Select label="Source Server" value={selectedServerId} onChange={(event) => setSelectedServerId(event.target.value)}>
                  {servers.map((server) => (
                    <MenuItem key={server.id} value={String(server.id)}>
                      {server.hostname || server.serial_number} / {server.bmc_ip || 'no iLO'}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ flex: '1 1 260px', minWidth: { xs: '100%', md: 260 } }}>
                <InputLabel>Workload Profile</InputLabel>
                <Select
                  label="Workload Profile"
                  value={cloneWorkload}
                  onChange={(event) => setCloneWorkload(event.target.value)}
                  displayEmpty
                >
                  {cloneWorkload && !workloadOptions?.options.includes(cloneWorkload) && (
                    <MenuItem value={cloneWorkload}>{cloneWorkload}</MenuItem>
                  )}
                  {(workloadOptions?.options || []).map((option) => (
                    <MenuItem key={option} value={option}>
                      {workloadOptions?.display_names?.[option] || option}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Stack>
          )}

          {createSource === 'template' && (
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
              <FormControl size="small" sx={{ flex: '1 1 320px', minWidth: { xs: '100%', md: 320 } }}>
                <InputLabel>Template</InputLabel>
                <Select label="Template" value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
                  {biosTemplates.map((template) => (
                    <MenuItem key={template.id} value={template.id}>
                      {template.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Typography variant="body2" color="text.secondary" sx={{ alignSelf: { md: 'center' }, fontWeight: 700 }}>
                {selectedTemplate.description}
              </Typography>
            </Stack>
          )}

          {createSource === 'existing' && (
            <FormControl size="small" fullWidth>
              <InputLabel>Existing Profile</InputLabel>
              <Select label="Existing Profile" value={sourceProfileId} onChange={(event) => setSourceProfileId(event.target.value)}>
                {profiles.map((profile) => (
                  <MenuItem key={profile.id} value={String(profile.id)}>
                    {profile.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}

          {createSource !== 'clone' && (
            <>
              <FormControl size="small" fullWidth>
                <InputLabel>HPE Workload Profile</InputLabel>
                <Select
                  label="HPE Workload Profile"
                  value={customWorkload}
                  onChange={(event) => {
                    setCustomWorkload(event.target.value);
                    setCustomValidation(null);
                  }}
                >
                  <MenuItem value="">No workload profile</MenuItem>
                  {customWorkload && !workloadOptions?.options.includes(customWorkload) && (
                    <MenuItem value={customWorkload}>{customWorkload}</MenuItem>
                  )}
                  {(workloadOptions?.options || []).map((option) => (
                    <MenuItem key={option} value={option}>
                      {workloadOptions?.display_names?.[option] || option}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <TextField
                label="Attributes JSON or key: value"
                value={customAttributesText}
                onChange={(event) => {
                  setCustomAttributesText(event.target.value);
                  setCustomValidation(null);
                }}
                fullWidth
                multiline
                minRows={7}
                maxRows={18}
                helperText="Template/profile values are validated against the selected server BIOS registry before save."
                sx={biosJsonEditorSx}
              />
            </>
          )}

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
            {createSource !== 'clone' && (
              <Button variant="outlined" onClick={handleValidateCustom} disabled={loading || !selectedServerId}>
                Validate
              </Button>
            )}
            <Button
              startIcon={<ContentCopyIcon />}
              variant="contained"
              onClick={handleCreateProfile}
              disabled={
                loading ||
                !profileName.trim() ||
                (createSource === 'clone' ? !selectedServerId : !customValidation?.valid) ||
                (createSource === 'existing' && !sourceProfileId)
              }
            >
              {createSource === 'clone' ? 'Clone Profile' : 'Save Profile'}
            </Button>
            {customValidation && createSource !== 'clone' && (
              <Chip
                size="small"
                color={customValidation.valid ? 'success' : 'error'}
                label={validationSummary(customValidation)}
                sx={{ maxWidth: '100%', height: 'auto', '& .MuiChip-label': { whiteSpace: 'normal', py: 0.5 } }}
              />
            )}
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
                      onClick={() => {
                        setEditValidation(null);
                        setEditState({
                          profile,
                          name: profile.name,
                          workload: profile.base_workload_profile || '',
                          overridesJson: JSON.stringify(profile.custom_overrides || {}, null, 2),
                        });
                      }}
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
          <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1.5} alignItems={{ lg: 'center' }}>
            <FormControl size="small" sx={{ flex: '1 1 260px', minWidth: { xs: '100%', lg: 260 } }}>
              <InputLabel>Profile</InputLabel>
              <Select label="Profile" value={selectedProfileId} onChange={(event) => setSelectedProfileId(event.target.value)}>
                {profiles.map((profile) => (
                  <MenuItem key={profile.id} value={String(profile.id)}>
                    {profile.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ flex: '1 1 280px', minWidth: { xs: '100%', lg: 280 } }}>
              <InputLabel>Target Server</InputLabel>
              <Select label="Target Server" value={selectedServerId} onChange={(event) => setSelectedServerId(event.target.value)}>
                {servers.map((server) => (
                  <MenuItem key={server.id} value={String(server.id)}>
                    {server.hostname || server.serial_number} / {server.bmc_ip || 'no iLO'}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ flex: '0 0 auto', width: { xs: '100%', lg: 'auto' } }}>
              <Button
                startIcon={<DifferenceIcon />}
                variant="outlined"
                onClick={handleCompare}
                disabled={loading || !selectedProfileId}
                sx={{ minWidth: { xs: '100%', sm: 128 }, height: 40 }}
              >
                Compare
              </Button>
              <Button
                startIcon={<ScienceIcon />}
                variant="outlined"
                onClick={handleDryRunApply}
                disabled={loading || !selectedProfileId}
                sx={{ minWidth: { xs: '100%', sm: 128 }, height: 40 }}
              >
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
                    sx={{ minWidth: { xs: '100%', sm: 128 }, height: 40 }}
                  >
                    Deploy
                  </Button>
                </span>
              </Tooltip>
            </Stack>
          </Stack>
          <FormControlLabel
            control={<Checkbox checked={deployPostReboot} onChange={(event) => setDeployPostReboot(event.target.checked)} />}
            label="Create post-deploy reboot task when BIOS changes require reboot"
          />
          <Alert severity={deployBlockedReason ? 'warning' : compareResult?.diff.unsupported_count ? 'warning' : 'info'}>
            {deployBlockedReason ||
              (compareResult?.diff.unsupported_count
                ? 'Deploy writes only supported changed BIOS attributes. Unsupported profile attributes are skipped and reported in the task result.'
                : 'Deploy writes only changed BIOS attributes through Redfish. Reboot is not automatic unless the post-task reboot checkbox is selected; it still appears as a planned task first.')}
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

      <Dialog
        open={Boolean(editState)}
        onClose={() => {
          setEditState(null);
          setEditValidation(null);
        }}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>Edit BIOS Profile</DialogTitle>
        {editState && (
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 1 }}>
              <TextField
                label="Profile Name"
                value={editState.name}
                onChange={(event) => setEditState({ ...editState, name: event.target.value })}
              />
              <FormControl fullWidth size="small">
                <InputLabel>HPE Workload Profile</InputLabel>
                <Select
                  label="HPE Workload Profile"
                  value={editState.workload}
                  onChange={(event) => {
                    setEditValidation(null);
                    setEditState({ ...editState, workload: event.target.value });
                  }}
                >
                  <MenuItem value="">No workload profile</MenuItem>
                  {editState.workload && !workloadOptions?.options.includes(editState.workload) && (
                    <MenuItem value={editState.workload}>{editState.workload}</MenuItem>
                  )}
                  {(workloadOptions?.options || []).map((option) => (
                    <MenuItem key={option} value={option}>
                      {workloadOptions?.display_names?.[option] || option}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                Workload list is read from the selected target server iLO registry.
              </Typography>
              <TextField
                label="Custom Overrides JSON"
                value={editState.overridesJson}
                onChange={(event) => {
                  setEditValidation(null);
                  setEditState({ ...editState, overridesJson: event.target.value });
                }}
                fullWidth
                multiline
                minRows={8}
                maxRows={18}
                helperText='JSON or key: value. Example: {"PowerRegulator":"StaticHighPerf","ProcSMT":"Enabled"}'
                sx={biosJsonEditorSx}
              />
              {editValidation && (
                <Alert severity={editValidation.valid ? 'success' : 'error'}>
                  {validationSummary(editValidation)}
                </Alert>
              )}
            </Stack>
          </DialogContent>
        )}
        <DialogActions>
          <Button
            onClick={() => {
              setEditState(null);
              setEditValidation(null);
            }}
          >
            Cancel
          </Button>
          <Button variant="outlined" onClick={handleValidateEdit} disabled={loading || !editState || !selectedServerId}>
            Validate
          </Button>
          <Button variant="contained" onClick={handleSaveEdit} disabled={loading || !editState?.name.trim() || editValidation?.valid === false}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
