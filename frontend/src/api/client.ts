import axios from 'axios';
import type {
  BulkDeleteResult,
  DashboardStats,
  IloEnrollmentCreate,
  IloEnrollmentInfo,
  IloEnrollmentSubmitPayload,
  IloLicenseActionPayload,
  IloUserActionPayload,
  InventoryRefreshResult,
  ManagementConfig,
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

export async function fetchServers(): Promise<ServerSummary[]> {
  const response = await api.get<ServerSummary[]>('/api/v1/servers');
  return response.data;
}

export async function fetchRecentActions(limit = 50, completedVisibleMinutes = 10): Promise<ServerAction[]> {
  const response = await api.get<ServerAction[]>('/api/v1/servers/actions/recent', {
    params: { limit, completed_visible_minutes: completedVisibleMinutes },
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
