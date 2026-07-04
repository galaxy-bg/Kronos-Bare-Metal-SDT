import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Collapse,
  IconButton,
  Link,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import PendingActionsIcon from '@mui/icons-material/PendingActions';
import RefreshIcon from '@mui/icons-material/Refresh';
import { Link as RouterLink } from 'react-router-dom';
import { executeBiosRebootAction, executeStorageApplyAction, fetchGlobalSettings, fetchRecentActions, fetchServers, markActionCompleted } from '../api/client';
import type { GlobalSettings, ServerAction, ServerSummary } from '../types';

const fallbackSettings: GlobalSettings['task_footer'] = {
  enabled: true,
  active_refresh_seconds: 4,
  idle_refresh_seconds: 30,
  running_timeout_minutes: 10,
  completed_visible_minutes: 10,
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function formatOptionalDate(value: string | null) {
  return value ? formatDate(value) : '-';
}

function actionLabel(actionType: string) {
  const labels: Record<string, string> = {
    hpe_create_ilo_user: 'Create iLO User',
    hpe_set_ilo_network: 'Set Management Network',
    hpe_verify_ilo_credential: 'Verify iLO Credential',
    hpe_install_ilo_license: 'Install iLO License',
    validate_os_storage: 'Validate OS Storage',
    hpe_refresh_storage_inventory: 'HPE Storage Inventory',
    hpe_storage_apply_plan: 'Storage Apply Plan',
    bios_profile_clone: 'BIOS Profile Clone',
    bios_profile_custom_create: 'BIOS Profile Create',
    bios_profile_update: 'BIOS Profile Update',
    bios_profile_delete: 'BIOS Profile Delete',
    bios_profile_compare: 'BIOS Profile Compare',
    bios_profile_validate: 'BIOS Profile Validate',
    bios_profile_dry_run: 'BIOS Profile Dry Run',
    bios_profile_deploy: 'BIOS Profile Deploy',
    bios_profile_verify: 'BIOS Profile Verify',
    bios_reboot_after_apply: 'BIOS Reboot',
  };
  return labels[actionType] ?? actionType.split('_').join(' ');
}

function actionResultText(action: ServerAction) {
  const result = action.result_json ?? {};
  const osStorage = result.os_storage && typeof result.os_storage === 'object' ? result.os_storage as Record<string, unknown> : null;
  const diskCount = typeof result.disk_count === 'number'
    ? result.disk_count
    : typeof osStorage?.disk_count === 'number'
      ? osStorage.disk_count
      : null;
  const toolAvailable = typeof result.tool_available === 'boolean' ? result.tool_available : null;
  if (action.error_message) return action.error_message;
  if (typeof result.message === 'string') return result.message;
  if (typeof result.changed_count === 'number') return `${result.changed_count} changed / ${String(result.unsupported_count ?? 0)} unsupported`;
  if (typeof result.checked_count === 'number') return `${result.valid ? 'Valid' : 'Invalid'} / ${result.checked_count} checked`;
  if (diskCount !== null) return `OS disks: ${diskCount}${toolAvailable === false ? ' / ssacli missing' : ''}`;
  if (action.status === 'succeeded') return 'Completed successfully';
  return '-';
}

function actionDetailLines(action: ServerAction, target?: ServerSummary) {
  const result = action.result_json ?? {};
  const lines = [
    `Target: ${target?.hostname ?? target?.serial_number ?? `Server #${action.server_id}`}`,
    `Status: ${action.status}`,
  ];
  if (typeof result.tool_available === 'boolean') lines.push(`${String(result.tool ?? 'tool')}: ${result.tool_available ? 'available' : 'missing'}`);
  if (result.tool_path) lines.push(`Tool path: ${String(result.tool_path)}`);
  const osStorage = result.os_storage && typeof result.os_storage === 'object' ? result.os_storage as Record<string, unknown> : null;
  const storage = Array.isArray(result.storage) ? result.storage : osStorage && Array.isArray(osStorage.storage) ? osStorage.storage : [];
  storage.slice(0, 6).forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const disk = item as Record<string, unknown>;
    lines.push(`Disk ${index + 1}: ${String(disk.name ?? '-')} ${String(disk.size_gb ?? '-')}GB ${String(disk.model ?? '-')}`);
  });
  if (action.error_message) lines.push(`Error: ${action.error_message}`);
  return lines;
}

function StatusChip({ status }: { status: string }) {
  const colors: Record<string, { bg: string; color: string; border: string }> = {
    planned: { bg: '#f4f1ff', color: '#6652a3', border: '#d9d0ff' },
    pending: { bg: '#fff8df', color: '#75611d', border: '#f0dea1' },
    running: { bg: '#e9f6ff', color: '#236b93', border: '#bde1f4' },
    succeeded: { bg: '#e7f7ef', color: '#1f7d55', border: '#bfe8d2' },
    failed: { bg: '#fff1ef', color: '#b23b32', border: '#f2c4bf' },
  };
  const style = colors[status] ?? { bg: '#f3f5f5', color: '#62666f', border: '#dfe5e3' };
  return <Chip size="small" label={status.toUpperCase()} sx={{ bgcolor: style.bg, color: style.color, border: '1px solid', borderColor: style.border }} />;
}

export function TaskFooter() {
  const [settings, setSettings] = useState(fallbackSettings);
  const [actions, setActions] = useState<ServerAction[]>([]);
  const [servers, setServers] = useState<ServerSummary[]>([]);
  const [open, setOpen] = useState(false);
  const [executingActionId, setExecutingActionId] = useState<number | null>(null);

  const activeCount = actions.filter((action) => action.status === 'pending' || action.status === 'running' || action.status === 'planned').length;
  const serverById = useMemo(() => new Map(servers.map((server) => [server.id, server])), [servers]);

  async function refresh() {
    const [settingsData, actionData, serverData] = await Promise.all([
      fetchGlobalSettings().catch(() => ({ settings: { task_footer: fallbackSettings } })),
      fetchRecentActions(30, settings.completed_visible_minutes, settings.running_timeout_minutes),
      fetchServers(),
    ]);
    setSettings({ ...fallbackSettings, ...settingsData.settings.task_footer });
    setActions(actionData);
    setServers(serverData);
  }

  async function executeStorageApply(action: ServerAction) {
    setExecutingActionId(action.id);
    try {
      await executeStorageApplyAction(action.id);
      await refresh();
    } finally {
      setExecutingActionId(null);
    }
  }

  async function executeBiosReboot(action: ServerAction) {
    setExecutingActionId(action.id);
    try {
      await executeBiosRebootAction(action.id);
      await refresh();
    } finally {
      setExecutingActionId(null);
    }
  }

  async function markTaskCompleted(action: ServerAction) {
    setExecutingActionId(action.id);
    try {
      await markActionCompleted(action.id);
      await refresh();
    } finally {
      setExecutingActionId(null);
    }
  }

  useEffect(() => {
    refresh().catch(() => undefined);
  }, []);

  useEffect(() => {
    const seconds = activeCount > 0 ? settings.active_refresh_seconds : settings.idle_refresh_seconds;
    const timer = window.setInterval(() => refresh().catch(() => undefined), Math.max(seconds, 3) * 1000);
    return () => window.clearInterval(timer);
  }, [activeCount, settings.active_refresh_seconds, settings.idle_refresh_seconds]);

  if (!settings.enabled) return null;

  return (
    <Paper
      square
      elevation={8}
      sx={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 1200,
        borderTop: '1px solid',
        borderColor: 'divider',
        bgcolor: '#ffffff',
      }}
    >
      <Box sx={{ px: { xs: 1.5, md: 3 }, py: 1 }}>
        <Stack direction="row" alignItems="center" spacing={1.25}>
          <PendingActionsIcon fontSize="small" sx={{ color: 'primary.main' }} />
          <Typography sx={{ fontWeight: 900 }}>Tasks & Jobs</Typography>
          <Chip size="small" label={`${activeCount} active`} sx={{ bgcolor: activeCount ? '#fff8df' : '#f3f5f5', color: activeCount ? '#75611d' : '#62666f' }} />
          {actions[0] && (
            <Typography variant="body2" color="text.secondary" sx={{ display: { xs: 'none', md: 'block' }, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {actionLabel(actions[0].action_type)} · {actions[0].status}
            </Typography>
          )}
          <Box sx={{ flex: 1 }} />
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              display: { xs: 'none', lg: 'block' },
              fontWeight: 800,
              whiteSpace: 'nowrap',
            }}
          >
            KDX SDT Server Deployment Toolkit · Version 1 · © 2026 KDX
          </Typography>
          <Tooltip title="Refresh tasks" arrow>
            <IconButton size="small" onClick={() => refresh().catch(() => undefined)}>
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <IconButton size="small" onClick={() => setOpen((current) => !current)}>
            {open ? <ExpandMoreIcon fontSize="small" /> : <ExpandLessIcon fontSize="small" />}
          </IconButton>
        </Stack>
      </Box>
      <Collapse in={open} timeout="auto" unmountOnExit>
        <TableContainer sx={{ maxHeight: 320 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>Task</TableCell>
                <TableCell>Target</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Queued</TableCell>
                <TableCell>Completed</TableCell>
                <TableCell>Result</TableCell>
                <TableCell align="right">Action</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {actions.map((action) => {
                const target = serverById.get(action.server_id);
                const details = actionDetailLines(action, target);
                return (
                  <TableRow key={action.id} hover>
                    <TableCell sx={{ fontWeight: 800 }}>
                      <Tooltip arrow title={<Box>{details.map((line) => <Typography key={line} variant="caption" component="div">{line}</Typography>)}</Box>}>
                        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ width: 'fit-content' }}>
                          <HelpOutlineIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                          <span>{actionLabel(action.action_type)}</span>
                        </Stack>
                      </Tooltip>
                    </TableCell>
                    <TableCell>
                      {target ? <Link component={RouterLink} to={`/servers/${target.id}`} underline="hover" sx={{ fontWeight: 800 }}>{target.hostname ?? target.serial_number}</Link> : `Server #${action.server_id}`}
                    </TableCell>
                    <TableCell><StatusChip status={action.status} /></TableCell>
                    <TableCell>{formatDate(action.requested_at)}</TableCell>
                    <TableCell>{formatOptionalDate(action.completed_at)}</TableCell>
                    <TableCell>
                      <Typography variant="body2" color={action.status === 'failed' ? 'error.main' : 'text.secondary'} sx={{ maxWidth: 440, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {actionResultText(action)}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      {action.action_type === 'hpe_storage_apply_plan' && action.status === 'planned' && (
                        <Button size="small" variant="contained" color="warning" onClick={() => executeStorageApply(action)} disabled={executingActionId === action.id}>
                          {executingActionId === action.id ? 'Running...' : 'Execute'}
                        </Button>
                      )}
                      {action.action_type === 'bios_reboot_after_apply' && action.status === 'planned' && (
                        <Stack direction="row" spacing={0.75} justifyContent="flex-end">
                          <Button size="small" variant="contained" color="warning" onClick={() => executeBiosReboot(action)} disabled={executingActionId === action.id}>
                            {executingActionId === action.id ? 'Running...' : 'Reboot'}
                          </Button>
                          <Button size="small" variant="outlined" onClick={() => markTaskCompleted(action)} disabled={executingActionId === action.id}>
                            Mark Done
                          </Button>
                        </Stack>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {actions.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7}>
                    <Typography sx={{ py: 2, textAlign: 'center' }} color="text.secondary">No queued tasks or jobs yet.</Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Collapse>
    </Paper>
  );
}
