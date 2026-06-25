export type ManagementConfig = {
  ip?: string | null;
  subnet?: string | null;
  gateway?: string | null;
  dns?: string | null;
  ntp?: string | null;
  vlan?: string | null;
  admin_username?: string | null;
  admin_password?: string | null;
  credential?: {
    username?: string | null;
    password?: string | null;
    verified?: boolean;
    verified_at?: string | null;
    source?: string | null;
  } | null;
  managed_user?: {
    username?: string | null;
    password?: string | null;
    created?: boolean;
    created_at?: string | null;
    source?: string | null;
  } | null;
  dns_name?: string | null;
};

export type IloUserActionPayload = {
  username: string;
  password: string;
  admin_username?: string | null;
  admin_password?: string | null;
};

export type ServerAction = {
  id: number;
  server_id: number;
  action_type: string;
  status: string;
  payload_json: Record<string, unknown>;
  result_json: Record<string, unknown> | null;
  error_message: string | null;
  requested_at: string;
  started_at: string | null;
  completed_at: string | null;
};

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
  management_config_json: ManagementConfig | null;
  latest_inventory_json: Record<string, unknown> | null;
  agent_reachable: boolean | null;
  bmc_reachable: boolean | null;
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
  Pick<ServerSummary, 'vendor' | 'model' | 'product_name' | 'hostname' | 'agent_ip' | 'bmc_ip' | 'management_config_json' | 'status'>
>;

export type BulkDeleteResult = {
  deleted: number;
  requested: number;
};

export type IloEnrollmentCreate = {
  token: string;
  url: string;
  expires_at: string;
};

export type IloEnrollmentInfo = {
  server_id: number;
  serial_number: string;
  hostname: string | null;
  vendor: string | null;
  model: string | null;
  expires_at: string;
};

export type IloEnrollmentSubmitPayload = {
  username: string;
  password: string;
  dns_name?: string | null;
  create_managed_user: boolean;
};
