import axios from 'axios';
import type { DashboardStats, ServerDetail, ServerSummary } from '../types';

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

export async function fetchServer(serverId: string): Promise<ServerDetail> {
  const response = await api.get<ServerDetail>(`/api/v1/servers/${serverId}`);
  return response.data;
}
