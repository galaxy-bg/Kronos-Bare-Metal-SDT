import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  Grid,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import SettingsIcon from '@mui/icons-material/Settings';
import { fetchGlobalSettings, updateGlobalSettings } from '../api/client';
import type { GlobalSettings } from '../types';

const emptySettings: GlobalSettings = {
  task_footer: {
    enabled: true,
    active_refresh_seconds: 4,
    idle_refresh_seconds: 30,
    running_timeout_minutes: 10,
    completed_visible_minutes: 10,
  },
  provisioning: {
    controller_url: 'http://192.168.88.240:8000',
    default_agent_interface: '',
    default_ilo_user: 'hpadmin',
    storage_executor: 'agent',
  },
  storage: {
    enable_destructive_raid_actions: false,
    auto_jbod_remaining: true,
    prefer_agent_storage: true,
  },
  bios: {
    enable_real_apply: false,
    default_dry_run: true,
  },
};

function numberValue(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function SetupPage() {
  const [settings, setSettings] = useState<GlobalSettings>(emptySettings);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchGlobalSettings()
      .then((result) => {
        setSettings(result.settings);
        setUpdatedAt(result.updated_at);
      })
      .catch(() => setError('Global settings could not be loaded.'))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const result = await updateGlobalSettings(settings);
      setSettings(result.settings);
      setUpdatedAt(result.updated_at);
      setMessage('Global settings saved.');
    } catch {
      setError('Global settings could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <Typography color="text.secondary">Loading settings...</Typography>;
  }

  return (
    <Stack spacing={2.5}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', md: 'center' }}>
        <Stack direction="row" spacing={1.25} alignItems="center">
          <SettingsIcon color="primary" />
          <Box>
            <Typography variant="h4" sx={{ fontWeight: 900 }}>
              Settings
            </Typography>
            <Typography color="text.secondary" sx={{ fontWeight: 700 }}>
              Global deployment and provisioning defaults
            </Typography>
          </Box>
        </Stack>
        <Box sx={{ flex: 1 }} />
        <Button startIcon={<SaveIcon />} variant="contained" onClick={save} disabled={saving}>
          {saving ? 'Saving...' : 'Save Settings'}
        </Button>
      </Stack>

      {message && <Alert severity="success">{message}</Alert>}
      {error && <Alert severity="error">{error}</Alert>}
      {updatedAt && (
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
          Last updated {new Date(updatedAt).toLocaleString()}
        </Typography>
      )}

      <Paper variant="outlined" sx={{ p: 2, bgcolor: '#ffffff' }}>
        <Typography variant="h6" sx={{ fontWeight: 900, mb: 2 }}>
          Provisioning
        </Typography>
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              label="Controller URL"
              value={settings.provisioning.controller_url}
              onChange={(event) => setSettings({ ...settings, provisioning: { ...settings.provisioning, controller_url: event.target.value } })}
            />
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField
              fullWidth
              label="Default Agent Interface"
              value={settings.provisioning.default_agent_interface}
              onChange={(event) => setSettings({ ...settings, provisioning: { ...settings.provisioning, default_agent_interface: event.target.value } })}
            />
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField
              fullWidth
              label="Default iLO User"
              value={settings.provisioning.default_ilo_user}
              onChange={(event) => setSettings({ ...settings, provisioning: { ...settings.provisioning, default_ilo_user: event.target.value } })}
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField
              select
              fullWidth
              label="Storage Executor"
              value={settings.provisioning.storage_executor}
              onChange={(event) => setSettings({ ...settings, provisioning: { ...settings.provisioning, storage_executor: event.target.value } })}
            >
              <MenuItem value="agent">Agent</MenuItem>
              <MenuItem value="redfish">Redfish</MenuItem>
            </TextField>
          </Grid>
        </Grid>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, bgcolor: '#ffffff' }}>
        <Typography variant="h6" sx={{ fontWeight: 900, mb: 2 }}>
          Storage
        </Typography>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
          <FormControlLabel
            control={<Checkbox checked={settings.storage.prefer_agent_storage} onChange={(event) => setSettings({ ...settings, storage: { ...settings.storage, prefer_agent_storage: event.target.checked } })} />}
            label="Prefer agent storage"
          />
          <FormControlLabel
            control={<Checkbox checked={settings.storage.auto_jbod_remaining} onChange={(event) => setSettings({ ...settings, storage: { ...settings.storage, auto_jbod_remaining: event.target.checked } })} />}
            label="Auto JBOD remaining"
          />
          <FormControlLabel
            control={<Checkbox checked={settings.storage.enable_destructive_raid_actions} onChange={(event) => setSettings({ ...settings, storage: { ...settings.storage, enable_destructive_raid_actions: event.target.checked } })} />}
            label="Enable destructive RAID actions"
          />
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, bgcolor: '#ffffff' }}>
        <Typography variant="h6" sx={{ fontWeight: 900, mb: 2 }}>
          BIOS Profiles
        </Typography>
        <Stack spacing={1}>
          <FormControlLabel
            control={
              <Checkbox
                checked={settings.bios.enable_real_apply}
                onChange={(event) =>
                  setSettings({ ...settings, bios: { ...settings.bios, enable_real_apply: event.target.checked } })
                }
              />
            }
            label="Enable real BIOS deploy"
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={settings.bios.default_dry_run}
                onChange={(event) =>
                  setSettings({ ...settings, bios: { ...settings.bios, default_dry_run: event.target.checked } })
                }
              />
            }
            label="Default to dry-run"
          />
          <Typography variant="body2" color="text.secondary">
            BIOS deploy writes only changed Redfish attributes and never reboots automatically.
          </Typography>
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, bgcolor: '#ffffff' }}>
        <Typography variant="h6" sx={{ fontWeight: 900, mb: 2 }}>
          Task Footer
        </Typography>
        <Grid container spacing={2}>
          <Grid item xs={12} md={3}>
            <FormControlLabel
              control={<Checkbox checked={settings.task_footer.enabled} onChange={(event) => setSettings({ ...settings, task_footer: { ...settings.task_footer, enabled: event.target.checked } })} />}
              label="Enabled"
            />
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField
              fullWidth
              label="Active Refresh Seconds"
              value={settings.task_footer.active_refresh_seconds}
              onChange={(event) => setSettings({ ...settings, task_footer: { ...settings.task_footer, active_refresh_seconds: numberValue(event.target.value, 4) } })}
            />
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField
              fullWidth
              label="Idle Refresh Seconds"
              value={settings.task_footer.idle_refresh_seconds}
              onChange={(event) => setSettings({ ...settings, task_footer: { ...settings.task_footer, idle_refresh_seconds: numberValue(event.target.value, 30) } })}
            />
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField
              fullWidth
              label="Running Timeout Minutes"
              value={settings.task_footer.running_timeout_minutes}
              onChange={(event) => setSettings({ ...settings, task_footer: { ...settings.task_footer, running_timeout_minutes: numberValue(event.target.value, 10) } })}
            />
          </Grid>
        </Grid>
      </Paper>
    </Stack>
  );
}
