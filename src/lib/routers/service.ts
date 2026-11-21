import { createAdminClient } from "@/lib/supabase/admin";
import type { RouterRow } from "@/lib/types";
import { describeRouterError, newRouterClient } from "./credentials";
import { toHealth, verifyRouterAcceptance, type RouterAcceptance } from "./verify";
import { readHotspotActiveSessions } from "@/lib/mikrotik/hotspot";

const AUTH_ERROR_CODES = new Set([
  "ROUTER_AUTH_FAILED",
  "ROUTER_HANDSHAKE_FAILED",
  "ROUTER_TLS_FAILED",
]);

export async function logRouterEvent(
  routerId: string,
  level: "info" | "warn" | "error",
  code: string,
  message: string,
  details?: Record<string, unknown>,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("router_events").insert({
    router_id: routerId,
    level,
    code,
    message,
    details: details ?? null,
  });
  if (error) console.error("[router_events]", error.message);
}

export async function recordAcceptance(
  router: RouterRow,
  result: RouterAcceptance,
): Promise<RouterRow | null> {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const authIssue = result.error ? AUTH_ERROR_CODES.has(result.error.code) : false;
  const status = result.accepted ? "online" : authIssue ? "rejected" : "offline";

  const patch: Record<string, unknown> = {
    status,
    health: toHealth(result),
    last_error: result.accepted ? null : (result.error?.message ?? "Router check failed"),
  };

  if (result.authMode) patch.auth_mode = result.authMode;

  if (result.accepted) {
    patch.last_seen_at = now;
    patch.accepted_at = now;
    if (result.system) {
      patch.identity = result.system.identity || null;
      patch.board_name = result.system.boardName || null;
      patch.ros_version = result.system.version || null;
      patch.architecture = result.system.architecture || null;
      patch.license_level = result.system.licenseLevel;
    }
    patch.hotspot_servers = result.hotspotServers.filter((server) => !server.disabled).map((server) => server.name);
  }

  const { data, error } = await admin.from("routers").update(patch).eq("id", router.id).select("*").single();
  if (error) throw new Error(`Could not save router health: ${error.message}`);

  await logRouterEvent(
    router.id,
    result.accepted ? (result.warnings.length > 0 ? "warn" : "info") : "error",
    result.accepted ? "ROUTER_ACCEPTED" : (result.error?.code ?? "ROUTER_CHECK_FAILED"),
    result.accepted
      ? `Router accepted via ${result.authMode ?? "unknown"} handshake in ${result.latencyMs}ms`
      : (result.error?.message ?? "Router check failed"),
    {
      steps: result.steps,
      warnings: result.warnings,
      hint: result.error?.hint,
    },
  );

  return (data as RouterRow) ?? null;
}

export async function checkRouter(
  router: RouterRow,
  options: { expectedHotspotServer?: string | null; timeoutMs?: number } = {},
): Promise<{ result: RouterAcceptance; router: RouterRow | null }> {
  const client = newRouterClient(router, {
    connectTimeoutMs: options.timeoutMs ?? 8000,
    replyTimeoutMs: options.timeoutMs ?? 10000,
  });

  let result: RouterAcceptance;
  try {
    result = await verifyRouterAcceptance(client, {
      expectedHotspotServer: options.expectedHotspotServer,
      useTls: router.use_tls,
    });
  } finally {
    client.close();
  }

  const saved = await recordAcceptance(router, result);
  return { result, router: saved };
}

export async function checkRouterById(
  routerId: string,
  options: { timeoutMs?: number } = {},
): Promise<{ result: RouterAcceptance; router: RouterRow | null }> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("routers").select("*").eq("id", routerId).single();
  if (error || !data) throw new Error(`Router not found: ${error?.message ?? routerId}`);
  return checkRouter(data as RouterRow, options);
}

export async function heartbeatAllRouters(limit = 25): Promise<{
  checked: number;
  online: number;
  offline: number;
  errors: Array<{ router_id: string; name: string; error: string }>;
}> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("routers")
    .select("*")
    .order("last_seen_at", { ascending: true, nullsFirst: true })
    .limit(limit);

  if (error) throw new Error(error.message);

  const routers = (data ?? []) as RouterRow[];
  let online = 0;
  const errors: Array<{ router_id: string; name: string; error: string }> = [];

  for (const router of routers) {
    try {
      const { result } = await checkRouter(router, { timeoutMs: 6000 });
      if (result.accepted) online += 1;
      else errors.push({
        router_id: router.id,
        name: router.name,
        error: result.error?.message ?? "Router check failed",
      });
    } catch (caught) {
      const described = describeRouterError(caught);
      errors.push({ router_id: router.id, name: router.name, error: described.message });
    }
  }

  return { checked: routers.length, online, offline: routers.length - online, errors };
}

/**
 * Mirrors live hotspot sessions into the database so usage history and
 * bandwidth totals survive a router reboot.
 */
export async function syncActiveSessions(router: RouterRow): Promise<{ open: number; closed: number }> {
  const admin = createAdminClient();
  const client = newRouterClient(router, { connectTimeoutMs: 8000, replyTimeoutMs: 10000 });

  try {
    await client.connect();
    await client.login();
    const active = await readHotspotActiveSessions(client);
    const activeUsers = new Set(active.map((session) => session.user));

    const { data: openRows } = await admin
      .from("sessions")
      .select("id, username")
      .eq("router_id", router.id)
      .eq("status", "active");

    const open = (openRows ?? []) as Array<{ id: string; username: string }>;
    const openByName = new Map(open.map((row) => [row.username, row.id]));

    let closed = 0;
    for (const row of open) {
      if (!activeUsers.has(row.username)) {
        await admin
          .from("sessions")
          .update({ status: "closed", ended_at: new Date().toISOString() })
          .eq("id", row.id);
        closed += 1;
      }
    }

    let opened = 0;
    for (const session of active) {
      if (openByName.has(session.user)) {
        await admin
          .from("sessions")
          .update({ bytes_in: session.bytesIn, bytes_out: session.bytesOut, ip_address: session.address, mac_address: session.macAddress })
          .eq("id", openByName.get(session.user)!);
        continue;
      }

      const { data: voucher } = await admin
        .from("vouchers")
        .select("id")
        .eq("code", session.user)
        .maybeSingle();
      if (!voucher) continue;

      await admin.from("sessions").insert({
        voucher_id: voucher.id,
        router_id: router.id,
        username: session.user,
        ip_address: session.address,
        mac_address: session.macAddress,
        bytes_in: session.bytesIn,
        bytes_out: session.bytesOut,
        status: "active",
      });
      opened += 1;
    }

    return { open: active.length, closed };
  } finally {
    client.close();
  }
}
