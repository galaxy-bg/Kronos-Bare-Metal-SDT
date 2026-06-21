export type DashboardStats = {
  total_servers: number;
  online_servers: number;
  offline_servers: number;
};

export type ServerSummary = {
  id: number;
  uuid: string;
  serial_number: string;
  vendor: string | null;
  model: string | null;
  product_name: string | null;
  hostname: string | null;
  agent_ip: string | null;
  bmc_ip: string | null;
  status: 'online' | 'offline' | string;
  last_seen: string;
  created_at: string;
  updated_at: string;
};

export type InventoryRecord = {
  id: number;
  inventory_json: Record<string, unknown>;
  created_at: string;
};

export type ServerDetail = ServerSummary & {
  inventories: InventoryRecord[];
};

export type ServerUpdate = Partial<
  Pick<ServerSummary, 'vendor' | 'model' | 'product_name' | 'hostname' | 'agent_ip' | 'bmc_ip' | 'status'>
>;
