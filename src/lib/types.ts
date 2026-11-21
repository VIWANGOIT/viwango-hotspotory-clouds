export type RouterStatus = "pending" | "online" | "offline" | "rejected";
export type VoucherStatus = "unused" | "active" | "used" | "expired" | "revoked";
export type SessionStatus = "active" | "closed";
export type PaymentStatus = "pending" | "paid" | "failed";
export type AuthMode = "plain" | "legacy-md5";

export interface RouterRow {
  id: string;
  name: string;
  host: string;
  api_port: number;
  use_tls: boolean;
  tls_verify: boolean;
  username: string;
  password_enc: string;
  auth_mode: AuthMode | null;
  status: RouterStatus;
  last_error: string | null;
  last_seen_at: string | null;
  accepted_at: string | null;
  identity: string | null;
  board_name: string | null;
  ros_version: string | null;
  architecture: string | null;
  license_level: number | null;
  hotspot_servers: string[];
  hotspot_server: string | null;
  hotspot_login_url: string | null;
  health: RouterHealth | null;
  agent_token_hash: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface RouterHealth {
  checked_at: string;
  latency_ms: number;
  auth_mode: AuthMode;
  warnings: string[];
  steps: Array<{ id: string; label: string; status: "pass" | "warn" | "fail" | "skip"; detail?: string }>;
}

export interface PackageRow {
  id: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  duration_minutes: number;
  data_limit_mb: number | null;
  speed_limit_down: string | null;
  speed_limit_up: string | null;
  device_limit: number;
  is_active: boolean;
  router_profile: string | null;
  created_at: string;
}

export interface VoucherRow {
  id: string;
  code: string;
  package_id: string;
  router_id: string | null;
  status: VoucherStatus;
  batch_id: string | null;
  price_paid: number;
  customer_phone: string | null;
  payment_ref: string | null;
  created_at: string;
  activated_at: string | null;
  expires_at: string | null;
}

export interface SessionRow {
  id: string;
  voucher_id: string;
  router_id: string;
  username: string;
  ip_address: string | null;
  mac_address: string | null;
  started_at: string;
  ended_at: string | null;
  bytes_in: number;
  bytes_out: number;
  status: SessionStatus;
}

export interface PaymentRow {
  id: string;
  provider: string;
  phone: string;
  amount: number;
  reference: string;
  status: PaymentStatus;
  voucher_id: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
}

export interface RouterEventRow {
  id: string;
  router_id: string;
  level: "info" | "warn" | "error";
  code: string;
  message: string;
  details: Record<string, unknown> | null;
  created_at: string;
}

export interface VoucherWithPackage extends VoucherRow {
  package: Pick<PackageRow, "id" | "name" | "duration_minutes" | "price" | "currency" | "speed_limit_down" | "speed_limit_up" | "data_limit_mb" | "device_limit"> | null;
}

export interface AcceptanceStepView {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail" | "skip";
  detail?: string;
}

export interface AcceptanceView {
  accepted: boolean;
  authMode: string | null;
  latencyMs: number;
  steps: AcceptanceStepView[];
  warnings: string[];
  error: { code: string; message: string; hint?: string } | null;
}
