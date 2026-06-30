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
  license?: {
    edition?: string | null;
    installed?: boolean;
    installed_at?: string | null;
    updated_at?: string | null;
    detected_by?: string | null;
    source?: string | null;
    backend?: string | null;
    endpoint?: string | null;
    license_service?: string | null;
    action?: string | null;
    license_key?: string | null;
  } | null;
  health?: {
    overall?: string | null;
    manager?: string | null;
    system?: string | null;
    chassis?: string | null;
    power_state?: string | null;
    detected_by?: string | null;
    endpoint?: string | null;
    updated_at?: string | null;
  } | null;
  agent?: {
    version?: string | null;
    build?: string | null;
    reported_at?: string | null;
    source?: string | null;
  } | null;
};

export type IloUserActionPayload = {
  username: string;
  password: string;
  admin_username?: string | null;
  admin_password?: string | null;
};

export type IloLicenseActionPayload = {
  license_key: string;
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
  registration_status: string;
  readiness_status: string;
  readiness_reasons: string[];
  conflicts: Record<string, unknown>;
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

export type InventoryRefreshResult = {
  status: string;
  inventory_id: number;
  inventory: Record<string, unknown>;
};

export type RaidPlanPayload = {
  disk_mode: string;
  raid_level: string;
  purpose: string;
  volume_name: string;
  selected_drive_paths: string[];
  bootable: boolean;
  initialize_as_jbod: boolean;
};

export type RaidApplyPayload = RaidPlanPayload & {
  confirmation: string;
};

export type RaidClearConfigPayload = {
  confirmation: string;
  storage_path?: string | null;
};

export type RaidDeleteVolumePayload = {
  confirmation: string;
  volume_path: string;
};

export type RaidPlanResult = {
  server_id: number;
  serial_number: string;
  disk_mode: string;
  raid_level: string;
  purpose: string;
  volume_name: string;
  bootable: boolean;
  initialize_as_jbod: boolean;
  selected_drive_paths: string[];
  selected_drives: Array<Record<string, unknown>>;
  missing_drive_paths: string[];
  checks: Array<{ name: string; passed: boolean; message: string }>;
  eligible: boolean;
  apply_supported: boolean;
  destructive: boolean;
  message: string;
  raid: Record<string, unknown>;
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
