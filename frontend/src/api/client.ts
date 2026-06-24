import axios from 'axios';
import type {
  BulkDeleteResult,
  DashboardStats,
  IloUserActionPayload,
  ManagementConfig,
  ServerAction,
  ServerDetail,
  ServerSummary,
  ServerUpdate,
} from '../types';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000',
});

export async function fetchStats(): Promise<DashboardStats> {
  const response = await api.get<DashboardStats>('/api/v1/servers/stats');
  return response.data;
}

export async function fetchServers(): Promise<ServerSummary[]> {
  const response = await api.get<ServerSummary[]>('/api/v1/servers');
  return response.data;
}

export async function fetchRecentActions(limit = 50): Promise<ServerAction[]> {
  const response = await api.get<ServerAction[]>('/api/v1/servers/actions/recent', { params: { limit } });
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

export async function deleteServer(serverId: number): Promise<void> {
  await api.delete(`/api/v1/servers/${serverId}`);
}

export async function bulkDeleteServers(serverIds: number[]): Promise<BulkDeleteResult> {
  const response = await api.post<BulkDeleteResult>('/api/v1/servers/bulk-delete', { server_ids: serverIds });
  return response.data;
}
