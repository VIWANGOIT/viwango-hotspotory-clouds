import { handle, HttpError, ok, fail, parseJson } from "@/lib/http";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { newRouterClient } from "@/lib/routers/credentials";
import { logRouterEvent } from "@/lib/routers/service";
import { createAdminClient } from "@/lib/supabase/admin";
import { provisionVoucher } from "@/lib/provisioning";
import type { PackageRow, RouterRow, VoucherRow } from "@/lib/types";
import { isValidVoucherCodeShape, normalizeVoucherCode } from "@/lib/vouchers";
import { portalActivateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const maxDuration = 60;

interface ActivateRpcResult {
  result: "not_found" | "revoked" | "expired" | "package_inactive" | "activated" | "active";
  voucher?: VoucherRow;
  package?: PackageRow;
}

function loginUrl(router: RouterRow, code: string): string | null {
  if (!router.hotspot_login_url) return null;
  try {
    const url = new URL(router.hotspot_login_url);
    url.searchParams.set("username", code);
    url.searchParams.set("password", code);
    return url.toString();
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  return handle(async () => {
    const limit = rateLimit(`portal:${clientIp(request)}`, 12, 60_000);
    if (!limit.allowed) {
      return fail(429, `Too many attempts. Try again in ${limit.retryAfterSeconds}s.`);
    }

    const input = await parseJson(request, portalActivateSchema);
    const code = normalizeVoucherCode(input.code);
    if (!isValidVoucherCodeShape(code)) throw new HttpError(422, "Enter a valid voucher code");

    const admin = createAdminClient();

    let router: RouterRow | null = null;
    if (input.router_id) {
      const { data } = await admin.from("routers").select("*").eq("id", input.router_id).maybeSingle();
      router = (data as RouterRow) ?? null;
    } else {
      const { data } = await admin
        .from("routers")
        .select("*")
        .eq("status", "online")
        .order("last_seen_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      router = (data as RouterRow) ?? null;
    }

    if (!router) throw new HttpError(503, "No router is online right now. Please tell the operator.");

    const { data, error } = await admin.rpc("activate_voucher", { p_code: code, p_router_id: router.id });
    if (error) throw new HttpError(500, error.message);

    const activation = data as ActivateRpcResult;
    switch (activation.result) {
      case "not_found":
        throw new HttpError(404, "Voucher not found. Check the code and try again.");
      case "revoked":
        throw new HttpError(403, "This voucher has been cancelled.");
      case "expired":
        throw new HttpError(410, "This voucher has expired.");
      case "package_inactive":
        throw new HttpError(409, "This package is not on sale right now.");
    }

    const voucher = activation.voucher!;
    const pkg = activation.package!;

    const client = newRouterClient(router);
    let provisionError: string | null = null;
    try {
      await client.connect();
      await client.login();
      const provisioned = await provisionVoucher(client, { voucher, pkg });
      if (!provisioned.ok) provisionError = provisioned.error ?? "Provisioning failed";
    } catch (caught) {
      provisionError = caught instanceof Error ? caught.message : "Router connection failed";
    } finally {
      client.close();
    }

    if (provisionError) {
      await logRouterEvent(router.id, "error", "PROVISION_FAILED", `Voucher ${code} could not be provisioned`, {
        error: provisionError,
      });

      // Do not burn the customer's time when the router never accepted the user.
      if (activation.result === "activated") {
        await admin
          .from("vouchers")
          .update({ status: "unused", activated_at: null, expires_at: null })
          .eq("id", voucher.id);
      }
      throw new HttpError(502, "The router did not accept the voucher. Please try again in a moment.");
    }

    if (input.mac || input.ip) {
      await admin.from("sessions").insert({
        voucher_id: voucher.id,
        router_id: router.id,
        username: voucher.code,
        ip_address: input.ip || null,
        mac_address: input.mac || null,
        status: "active",
      });
    }

    return ok({
      code: voucher.code,
      status: activation.result,
      expires_at: voucher.expires_at,
      package: {
        name: pkg.name,
        duration_minutes: pkg.duration_minutes,
        speed_limit_down: pkg.speed_limit_down,
        speed_limit_up: pkg.speed_limit_up,
        data_limit_mb: pkg.data_limit_mb,
      },
      login_url: loginUrl(router, voucher.code),
    });
  });
}
