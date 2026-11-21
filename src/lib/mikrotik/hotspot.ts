import { RouterOsClient, type RouterOsRecord } from "./client";

export interface RouterSystemInfo {
  identity: string;
  boardName: string;
  version: string;
  architecture: string;
  uptime: string;
  cpuLoad: string;
  freeMemory: string;
  totalMemory: string;
  licenseLevel: number | null;
}

export interface HotspotServerInfo {
  name: string;
  interface: string;
  disabled: boolean;
  profile: string;
}

export interface HotspotActiveSession {
  id: string;
  user: string;
  address: string;
  macAddress: string;
  uptime: string;
  bytesIn: number;
  bytesOut: number;
  server: string;
}

export interface ApiServiceInfo {
  name: string;
  port: string;
  disabled: boolean;
  address: string;
}

export async function readSystemInfo(client: RouterOsClient): Promise<RouterSystemInfo> {
  const [identity, resource, license] = await Promise.all([
    client.print("/system/identity").catch(() => [] as RouterOsRecord[]),
    client.print("/system/resource").catch(() => [] as RouterOsRecord[]),
    client.print("/system/license").catch(() => [] as RouterOsRecord[]),
  ]);

  const level = license[0]?.nlevel ? Number(license[0].nlevel) : null;

  return {
    identity: identity[0]?.name ?? "",
    boardName: resource[0]?.["board-name"] ?? "",
    version: resource[0]?.version ?? "",
    architecture: resource[0]?.["architecture-name"] ?? "",
    uptime: resource[0]?.uptime ?? "",
    cpuLoad: resource[0]?.["cpu-load"] ?? "",
    freeMemory: resource[0]?.["free-memory"] ?? "",
    totalMemory: resource[0]?.["total-memory"] ?? "",
    licenseLevel: Number.isFinite(level) ? level : null,
  };
}

export async function readHotspotServers(client: RouterOsClient): Promise<HotspotServerInfo[]> {
  const [servers, serverConfig] = await Promise.all([
    client.print("/ip/hotspot").catch(() => [] as RouterOsRecord[]),
    client.print("/ip/hotspot/server").catch(() => [] as RouterOsRecord[]),
  ]);

  const disabledByName = new Map<string, boolean>();
  for (const row of serverConfig) {
    if (row.name) disabledByName.set(row.name, row.disabled === "true");
  }

  return servers.map((row) => ({
    name: row.name ?? "",
    interface: row.interface ?? "",
    profile: row.profile ?? "",
    disabled: disabledByName.get(row.name ?? "") ?? row.disabled === "true",
  }));
}

export async function readApiServices(client: RouterOsClient): Promise<ApiServiceInfo[]> {
  const rows = await client.print("/ip/service").catch(() => [] as RouterOsRecord[]);
  return rows
    .filter((row) => (row.name ?? "").startsWith("api"))
    .map((row) => ({
      name: row.name ?? "",
      port: row.port ?? "",
      disabled: row.disabled === "true",
      address: row.address ?? "",
    }));
}

export async function readClockSkewSeconds(client: RouterOsClient): Promise<number | null> {
  const rows = await client.print("/system/clock").catch(() => [] as RouterOsRecord[]);
  const row = rows[0];
  if (!row?.date || !row?.time) return null;

  const parsed = Date.parse(`${row.date.replace(/\./g, "-")}T${row.time}Z`);
  if (Number.isNaN(parsed)) return null;
  return Math.round((Date.now() - parsed) / 1000);
}

export async function readHotspotActiveSessions(client: RouterOsClient): Promise<HotspotActiveSession[]> {
  const rows = await client.print("/ip/hotspot/active");
  return rows.map(mapActiveSession);
}

export function mapActiveSession(row: RouterOsRecord): HotspotActiveSession {
  return {
    id: row[".id"] ?? "",
    user: row.user ?? "",
    address: row.address ?? "",
    macAddress: row["mac-address"] ?? "",
    uptime: row.uptime ?? "",
    bytesIn: Number(row["bytes-in"] ?? 0) || 0,
    bytesOut: Number(row["bytes-out"] ?? 0) || 0,
    server: row.server ?? "",
  };
}

export async function findHotspotUser(
  client: RouterOsClient,
  username: string,
): Promise<RouterOsRecord | null> {
  const rows = await client.command(["/ip/hotspot/user/print", `?name=${username}`]);
  return rows[0] ?? null;
}

export async function ensureHotspotProfile(
  client: RouterOsClient,
  options: { name: string; rateLimit?: string | null; sessionTimeout?: string | null; sharedUsers?: number | null },
): Promise<string> {
  const existing = await client.command(["/ip/hotspot/user/profile/print", `?name=${options.name}`]);
  const properties: Record<string, string> = {};
  if (options.rateLimit) properties["rate-limit"] = options.rateLimit;
  if (options.sessionTimeout) properties["session-timeout"] = options.sessionTimeout;
  if (options.sharedUsers && options.sharedUsers > 0) {
    properties["shared-users"] = String(options.sharedUsers);
  }

  if (existing[0]?.[".id"]) {
    if (Object.keys(properties).length > 0) {
      await client.set("/ip/hotspot/user/profile", existing[0][".id"], properties);
    }
    return existing[0][".id"];
  }

  const created = await client.add("/ip/hotspot/user/profile", { name: options.name, ...properties });
  return created[".id"] ?? "";
}

export interface UpsertHotspotUserInput {
  username: string;
  password: string;
  profile: string;
  limitUptime?: string | null;
  limitBytesTotal?: number | null;
  comment?: string;
  disabled?: boolean;
}

/**
 * Creates or updates a hotspot user. Updating in place (instead of remove+add)
 * keeps the voucher code valid for repeat logins and avoids a window where the
 * code does not exist on the router.
 */
export async function upsertHotspotUser(
  client: RouterOsClient,
  input: UpsertHotspotUserInput,
): Promise<{ id: string; created: boolean }> {
  const existing = await findHotspotUser(client, input.username);
  const properties: Record<string, string> = {
    name: input.username,
    password: input.password,
    profile: input.profile,
  };
  if (input.limitUptime) properties["limit-uptime"] = input.limitUptime;
  if (input.limitBytesTotal && input.limitBytesTotal > 0) {
    properties["limit-bytes-total"] = String(input.limitBytesTotal);
  }
  if (input.comment) properties.comment = input.comment;
  properties.disabled = input.disabled ? "true" : "false";

  if (existing?.[".id"]) {
    await client.set("/ip/hotspot/user", existing[".id"], properties);
    return { id: existing[".id"], created: false };
  }

  const created = await client.add("/ip/hotspot/user", properties);
  return { id: created[".id"] ?? "", created: true };
}

export async function removeHotspotUser(client: RouterOsClient, username: string): Promise<boolean> {
  const existing = await findHotspotUser(client, username);
  if (!existing?.[".id"]) return false;
  await client.remove("/ip/hotspot/user", existing[".id"]);
  return true;
}

export async function disconnectHotspotUser(
  client: RouterOsClient,
  username: string,
): Promise<number> {
  const rows = await client.command(["/ip/hotspot/active/print", `?user=${username}`]);
  let removed = 0;
  for (const row of rows) {
    if (!row[".id"]) continue;
    await client.remove("/ip/hotspot/active", row[".id"]);
    removed += 1;
  }
  return removed;
}

export function formatUptime(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours === 0) return `${mins}m`;
  return `${hours}h${mins > 0 ? `${mins}m` : ""}`;
}

export function formatByteLimit(megabytes: number | null | undefined): number | null {
  if (!megabytes || megabytes <= 0) return null;
  return Math.round(megabytes * 1024 * 1024);
}
