import axios from 'axios';
import type {
  BulkDeleteResult,
  BIOSApplyJob,
  BIOSCloneFromServerPayload,
  BIOSCompareResult,
  BIOSProfile,
  BIOSProfileCreatePayload,
  BIOSProfileValidationResult,
  BIOSWorkloadOptions,
  DashboardStats,
  GlobalSettings,
  GlobalSettingsResponse,
  IloEnrollmentCreate,
  IloEnrollmentInfo,
  IloEnrollmentSubmitPayload,
  IloLicenseActionPayload,
  IloUserActionPayload,
  InventoryRefreshResult,
  ManagementConfig,
  ManualIloDiscoveryPayload,
  RaidApplyPayload,
  RaidClearConfigPayload,
  RaidDeleteVolumePayload,
  RaidPlanPayload,
  RaidPlanResult,
  ServerAction,
  ServerDetail,
  ServerSummary,
  ServerUpdate,
} from '../types';

const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? '';
const apiBaseUrl =
  typeof window !== 'undefined' && window.location.protocol === 'https:' && configuredApiBaseUrl.startsWith('http:')
    ? ''
    : configuredApiBaseUrl;

const api = axios.create({
  baseURL: apiBaseUrl,
});

export async function fetchStats(): Promise<DashboardStats> {
  const response = await api.get<DashboardStats>('/api/v1/servers/stats');
  return response.data;
}

export async function fetchGlobalSettings(): Promise<GlobalSettingsResponse> {
  const response = await api.get<GlobalSettingsResponse>('/api/v1/settings');
  return response.data;
}

export async function updateGlobalSettings(settings: GlobalSettings): Promise<GlobalSettingsResponse> {
  const response = await api.put<GlobalSettingsResponse>('/api/v1/settings', { settings });
  return response.data;
}

export async function fetchServers(): Promise<ServerSummary[]> {
  const response = await api.get<ServerSummary[]>('/api/v1/servers');
  return response.data;
}

export async function fetchRecentActions(limit = 50, completedVisibleMinutes = 10, runningTimeoutMinutes = 10): Promise<ServerAction[]> {
  const response = await api.get<ServerAction[]>('/api/v1/servers/actions/recent', {
    params: { limit, completed_visible_minutes: completedVisibleMinutes, running_timeout_minutes: runningTimeoutMinutes },
  });
  return response.data;
}

export async function fetchServer(serverId: string): Promise<ServerDetail> {
  const response = await api.get<ServerDetail>(`/api/v1/servers/${serverId}`);
  return response.data;
}

export async function updateServer(serverId: number, payload: ServerUpdate): Promise<ServerSummary> {
  const response = await api.patch<ServerSummary>(`/api/v1/servers/${serverId}`, payload);
  return response.data;
}

export async function discoverIloServer(payload: ManualIloDiscoveryPayload): Promise<ServerSummary> {
  const response = await api.post<ServerSummary>('/api/v1/servers/discover/ilo', payload);
  return response.data;
}

export async function createIloUserAction(serverId: number, payload: IloUserActionPayload): Promise<ServerAction> {
  const response = await api.post<ServerAction>(`/api/v1/servers/${serverId}/actions/hpe-create-ilo-user`, payload);
  return response.data;
}

export async function createIloNetworkAction(serverId: number, payload: ManagementConfig): Promise<ServerAction> {
  const response = await api.post<ServerAction>(`/api/v1/servers/${serverId}/actions/hpe-set-ilo-network`, payload);
  return response.data;
}

export async function createIloLicenseAction(serverId: number, payload: IloLicenseActionPayload): Promise<ServerAction> {
  const response = await api.post<ServerAction>(`/api/v1/servers/${serverId}/actions/hpe-install-ilo-license`, payload);
  return response.data;
}

export async function createOsStorageValidationAction(serverId: number): Promise<ServerAction> {
  const response = await api.post<ServerAction>(`/api/v1/servers/${serverId}/actions/validate-os-storage`);
  return response.data;
}

export async function createHpeStorageInventoryAction(serverId: number): Promise<ServerAction> {
  const response = await api.post<ServerAction>(`/api/v1/servers/${serverId}/actions/hpe-refresh-storage-inventory`);
  return response.data;
}

export async function createIloEnrollment(serverId: number): Promise<IloEnrollmentCreate> {
  const response = await api.post<IloEnrollmentCreate>(`/api/v1/servers/${serverId}/ilo-enrollment`);
  return response.data;
}

export async function fetchIloEnrollment(token: string): Promise<IloEnrollmentInfo> {
  const response = await api.get<IloEnrollmentInfo>(`/api/v1/servers/ilo-enrollment/${token}`);
  return response.data;
}

export async function submitIloEnrollment(token: string, payload: IloEnrollmentSubmitPayload): Promise<ServerAction> {
  const response = await api.post<ServerAction>(`/api/v1/servers/ilo-enrollment/${token}/submit`, payload);
  return response.data;
}

export async function refreshServerInventory(serverId: number): Promise<InventoryRefreshResult> {
  const response = await api.get<InventoryRefreshResult>(`/api/v1/servers/${serverId}/inventory/refresh`);
  return response.data;
}

export async function planRaid(serverId: number, payload: RaidPlanPayload): Promise<RaidPlanResult> {
  const response = await api.post<RaidPlanResult>(`/api/v1/servers/${serverId}/raid/plan`, payload);
  return response.data;
}

export async function applyRaidPlan(serverId: number, payload: RaidApplyPayload): Promise<ServerAction> {
  const response = await api.post<ServerAction>(`/api/v1/servers/${serverId}/raid/apply`, payload);
  return response.data;
}

export async function clearRaidConfig(serverId: number, payload: RaidClearConfigPayload): Promise<Record<string, unknown>> {
  const response = await api.post<Record<string, unknown>>(`/api/v1/servers/${serverId}/raid/clear-config`, payload);
  return response.data;
}

export async function deleteRaidVolume(serverId: number, payload: RaidDeleteVolumePayload): Promise<Record<string, unknown>> {
  const response = await api.post<Record<string, unknown>>(`/api/v1/servers/${serverId}/raid/volumes/delete`, payload);
  return response.data;
}

export async function executeStorageApplyAction(actionId: number): Promise<ServerAction> {
  const response = await api.post<ServerAction>(`/api/v1/servers/actions/${actionId}/execute-storage-apply`);
  return response.data;
}

export async function executeBiosRebootAction(actionId: number): Promise<ServerAction> {
  const response = await api.post<ServerAction>(`/api/v1/servers/actions/${actionId}/execute-bios-reboot`);
  return response.data;
}

export async function markActionCompleted(actionId: number): Promise<ServerAction> {
  const response = await api.post<ServerAction>(`/api/v1/servers/actions/${actionId}/mark-completed`);
  return response.data;
}

export async function cancelAction(actionId: number): Promise<ServerAction> {
  const response = await api.post<ServerAction>(`/api/v1/servers/actions/${actionId}/cancel`);
  return response.data;
}

export async function deleteServer(serverId: number): Promise<void> {
  await api.delete(`/api/v1/servers/${serverId}`);
}

export async function deregisterServer(serverId: number): Promise<ServerSummary> {
  const response = await api.post<ServerSummary>(`/api/v1/servers/${serverId}/deregister`);
  return response.data;
}

export async function bulkDeleteServers(serverIds: number[]): Promise<BulkDeleteResult> {
  const response = await api.post<BulkDeleteResult>('/api/v1/servers/bulk-delete', { server_ids: serverIds });
  return response.data;
}

export async function fetchBIOSProfiles(): Promise<BIOSProfile[]> {
  const response = await api.get<BIOSProfile[]>('/api/v1/bios/profiles');
  return response.data;
}

export async function createBIOSProfile(payload: BIOSProfileCreatePayload): Promise<BIOSProfile> {
  const response = await api.post<BIOSProfile>('/api/v1/bios/profiles', payload);
  return response.data;
}

export async function updateBIOSProfile(profileId: number, payload: Partial<BIOSProfile>): Promise<BIOSProfile> {
  const response = await api.put<BIOSProfile>(`/api/v1/bios/profiles/${profileId}`, payload);
  return response.data;
}

export async function deleteBIOSProfile(profileId: number): Promise<void> {
  await api.delete(`/api/v1/bios/profiles/${profileId}`);
}

export async function cloneBIOSProfileFromServer(payload: BIOSCloneFromServerPayload): Promise<BIOSProfile> {
  const response = await api.post<BIOSProfile>('/api/v1/bios/profiles/clone-from-server', payload);
  return response.data;
}

export async function fetchBIOSWorkloadOptions(serverId: number): Promise<BIOSWorkloadOptions> {
  const response = await api.get<BIOSWorkloadOptions>(`/api/v1/bios/servers/${serverId}/workload-options`);
  return response.data;
}

export async function compareBIOSProfile(profileId: number, targetServerId: number): Promise<BIOSCompareResult> {
  const response = await api.post<BIOSCompareResult>(`/api/v1/bios/profiles/${profileId}/compare`, {
    target_server_id: targetServerId,
  });
  return response.data;
}

export async function validateBIOSProfileAttributes(
  targetServerId: number,
  attributes: Record<string, unknown>,
  baseWorkloadProfile?: string | null,
): Promise<BIOSProfileValidationResult> {
  const response = await api.post<BIOSProfileValidationResult>('/api/v1/bios/profiles/validate', {
    target_server_id: targetServerId,
    base_workload_profile: baseWorkloadProfile || null,
    attributes,
  });
  return response.data;
}

export async function applyBIOSProfileDryRun(profileId: number, targetServerId: number): Promise<BIOSApplyJob> {
  const response = await api.post<BIOSApplyJob>(`/api/v1/bios/profiles/${profileId}/apply`, {
    target_server_id: targetServerId,
    dry_run: true,
    confirmation: 'confirm',
  });
  return response.data;
}

export async function deployBIOSProfile(profileId: number, targetServerId: number, postReboot = false): Promise<BIOSApplyJob> {
  const response = await api.post<BIOSApplyJob>(`/api/v1/bios/profiles/${profileId}/apply`, {
    target_server_id: targetServerId,
    dry_run: false,
    post_reboot: postReboot,
    confirmation: 'confirm',
  });
  return response.data;
}
