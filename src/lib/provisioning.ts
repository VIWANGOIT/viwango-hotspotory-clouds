import { RouterOsClient } from "@/lib/mikrotik/client";
import {
  disconnectHotspotUser,
  ensureHotspotProfile,
  formatByteLimit,
  formatUptime,
  removeHotspotUser,
  upsertHotspotUser,
} from "@/lib/mikrotik/hotspot";
import { routerClientOptions } from "@/lib/routers/credentials";
import type { PackageRow, RouterRow, VoucherRow } from "@/lib/types";

export function packageProfileName(pkg: Pick<PackageRow, "name" | "router_profile">): string {
  if (pkg.router_profile) return pkg.router_profile;
  const slug = pkg.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 20);
  return `vw-${slug || "package"}`;
}

export function packageRateLimit(
  pkg: Pick<PackageRow, "speed_limit_down" | "speed_limit_up">,
): string | null {
  const down = pkg.speed_limit_down?.trim();
  const up = pkg.speed_limit_up?.trim();
  if (!down && !up) return null;
  return `${down || up}/${up || down}`;
}

export interface ProvisionResult {
  ok: boolean;
  created?: boolean;
  profile?: string;
  error?: string;
}

/** Creates (or repairs) the hotspot user that a voucher logs in with. */
export async function provisionVoucher(
  client: RouterOsClient,
  options: {
    voucher: Pick<VoucherRow, "code" | "expires_at">;
    pkg: PackageRow;
  },
): Promise<ProvisionResult> {
  const { voucher, pkg } = options;
  const profile = packageProfileName(pkg);

  try {
    await ensureHotspotProfile(client, {
      name: profile,
      rateLimit: packageRateLimit(pkg),
      sessionTimeout: `${pkg.duration_minutes}m`,
      sharedUsers: pkg.device_limit,
    });

    const result = await upsertHotspotUser(client, {
      username: voucher.code,
      password: voucher.code,
      profile,
      limitUptime: formatUptime(pkg.duration_minutes),
      limitBytesTotal: formatByteLimit(pkg.data_limit_mb),
      comment: voucher.expires_at
        ? `VIWANGO ${pkg.name} exp ${new Date(voucher.expires_at).toISOString().slice(0, 16)}`
        : `VIWANGO ${pkg.name}`,
    });

    return { ok: true, created: result.created, profile };
  } catch (error) {
    return { ok: false, profile, error: error instanceof Error ? error.message : "Provisioning failed" };
  }
}

export async function deprovisionVoucher(
  client: RouterOsClient,
  code: string,
): Promise<{ removed: boolean; disconnected: number }> {
  const disconnected = await disconnectHotspotUser(client, code).catch(() => 0);
  const removed = await removeHotspotUser(client, code).catch(() => false);
  return { removed, disconnected };
}

export function routerSupportsProvisioning(router: RouterRow): boolean {
  return router.status === "online";
}

/** Opens a short lived API session, provisions one voucher, and closes it. */
export async function provisionVoucherOnRouter(
  router: RouterRow,
  voucher: Pick<VoucherRow, "code" | "expires_at">,
  pkg: PackageRow,
): Promise<ProvisionResult> {
  const client = new RouterOsClient(routerClientOptions(router));
  try {
    await client.connect();
    await client.login();
    return await provisionVoucher(client, { voucher, pkg });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Provisioning failed" };
  } finally {
    client.close();
  }
}
