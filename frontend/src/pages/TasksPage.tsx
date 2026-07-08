import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Chip,
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
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import PendingActionsIcon from '@mui/icons-material/PendingActions';
import RefreshIcon from '@mui/icons-material/Refresh';
import { Link as RouterLink } from 'react-router-dom';
import { cancelAction, executeBiosRebootAction, executeStorageApplyAction, fetchRecentActions, fetchServers, markActionCompleted } from '../api/client';
import type { ServerAction, ServerSummary } from '../types';

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
  if (action.error_message) return action.error_message;
  if (typeof result.message === 'string') return result.message;
  if (typeof result.changed_count === 'number') return `${result.changed_count} changed / ${String(result.unsupported_count ?? 0)} unsupported`;
  if (typeof result.checked_count === 'number') return `${result.valid ? 'Valid' : 'Invalid'} / ${result.checked_count} checked`;
  if (action.status === 'succeeded') return 'Completed successfully';
  return '-';
}

function actionDetailLines(action: ServerAction, target?: ServerSummary) {
  const result = action.result_json ?? {};
  const lines = [
    `Target: ${target?.hostname ?? target?.serial_number ?? `Server #${action.server_id}`}`,
    `Status: ${action.status}`,
    `Queued: ${formatDate(action.requested_at)}`,
  ];
  if (action.started_at) lines.push(`Started: ${formatDate(action.started_at)}`);
  if (action.completed_at) lines.push(`Completed: ${formatDate(action.completed_at)}`);
  if (typeof result.message === 'string') lines.push(`Result: ${result.message}`);
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
    canceled: { bg: '#f3f5f5', color: '#62666f', border: '#dfe5e3' },
  };
  const style = colors[status] ?? colors.canceled;
  return <Chip size="small" label={status.toUpperCase()} sx={{ bgcolor: style.bg, color: style.color, border: '1px solid', borderColor: style.border }} />;
}

export function TasksPage() {
  const [actions, setActions] = useState<ServerAction[]>([]);
  const [servers, setServers] = useState<ServerSummary[]>([]);
  const [busyActionId, setBusyActionId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const serverById = useMemo(() => new Map(servers.map((server) => [server.id, server])), [servers]);
  const activeCount = actions.filter((action) => ['planned', 'pending', 'running'].includes(action.status)).length;

  async function refresh() {
    setError(null);
    const [actionData, serverData] = await Promise.all([fetchRecentActions(200, 1440, 10), fetchServers()]);
    setActions(actionData);
    setServers(serverData);
  }

  async function runAction(action: ServerAction, operation: (id: number) => Promise<ServerAction>) {
    setBusyActionId(action.id);
    try {
      await operation(action.id);
      await refresh();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : 'Task action failed');
    } finally {
      setBusyActionId(null);
    }
  }

  useEffect(() => {
    refresh().catch((exc) => setError(exc instanceof Error ? exc.message : 'Failed to load tasks'));
  }, []);

  return (
    <Stack spacing={3}>
      <Stack direction={{ xs: 'column', md: 'row' }} alignItems={{ xs: 'flex-start', md: 'center' }} spacing={2}>
        <Box>
          <Typography variant="h3" sx={{ fontWeight: 900 }}>Tasks & Jobs</Typography>
          <Typography color="text.secondary" sx={{ fontWeight: 700 }}>Execute, cancel, and review lifecycle jobs.</Typography>
        </Box>
        <Box sx={{ flex: 1 }} />
        <Chip size="small" label={`${activeCount} active`} sx={{ bgcolor: activeCount ? '#fff8df' : '#f3f5f5', color: activeCount ? '#75611d' : '#62666f' }} />
        <Tooltip title="Refresh tasks" arrow>
          <IconButton onClick={() => refresh().catch((exc) => setError(exc instanceof Error ? exc.message : 'Failed to refresh tasks'))}>
            <RefreshIcon />
          </IconButton>
        </Tooltip>
      </Stack>

      {error && (
        <Paper variant="outlined" sx={{ p: 2, borderColor: '#f2c4bf', bgcolor: '#fff1ef' }}>
          <Typography color="error.main" sx={{ fontWeight: 800 }}>{error}</Typography>
        </Paper>
      )}

      <Paper variant="outlined" sx={{ overflow: 'hidden', bgcolor: '#ffffff' }}>
        <TableContainer>
          <Table stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>Task</TableCell>
                <TableCell>Target</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Queued</TableCell>
                <TableCell>Started</TableCell>
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
                    <TableCell>{formatOptionalDate(action.started_at)}</TableCell>
                    <TableCell>{formatOptionalDate(action.completed_at)}</TableCell>
                    <TableCell>
                      <Typography variant="body2" color={action.status === 'failed' ? 'error.main' : 'text.secondary'} sx={{ maxWidth: 520, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={actionResultText(action)}>
                        {actionResultText(action)}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={0.75} justifyContent="flex-end">
                        {action.action_type === 'hpe_storage_apply_plan' && action.status === 'planned' && (
                          <Button size="small" variant="contained" color="warning" onClick={() => runAction(action, executeStorageApplyAction)} disabled={busyActionId === action.id}>
                            {busyActionId === action.id ? 'Running...' : 'Execute'}
                          </Button>
                        )}
                        {action.action_type === 'bios_reboot_after_apply' && action.status === 'planned' && (
                          <>
                            <Button size="small" variant="contained" color="warning" onClick={() => runAction(action, executeBiosRebootAction)} disabled={busyActionId === action.id}>
                              {busyActionId === action.id ? 'Running...' : 'Reboot'}
                            </Button>
                            <Button size="small" variant="outlined" onClick={() => runAction(action, markActionCompleted)} disabled={busyActionId === action.id}>
                              Mark Done
                            </Button>
                          </>
                        )}
                        {(action.status === 'planned' || action.status === 'pending') && (
                          <Button size="small" variant="outlined" color="inherit" onClick={() => runAction(action, cancelAction)} disabled={busyActionId === action.id}>
                            Cancel
                          </Button>
                        )}
                      </Stack>
                    </TableCell>
                  </TableRow>
                );
              })}
              {actions.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8}>
                    <Stack alignItems="center" spacing={1} sx={{ py: 5 }}>
                      <PendingActionsIcon sx={{ color: 'text.secondary' }} />
                      <Typography color="text.secondary" sx={{ fontWeight: 800 }}>No tasks or jobs yet.</Typography>
                    </Stack>
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
