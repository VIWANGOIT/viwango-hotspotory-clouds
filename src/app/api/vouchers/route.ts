import { randomUUID } from "node:crypto";
import { requireAdmin } from "@/lib/auth";
import { handle, HttpError, ok, parseJson } from "@/lib/http";
import { newRouterClient } from "@/lib/routers/credentials";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PackageRow, RouterRow, VoucherRow } from "@/lib/types";
import { provisionVoucher } from "@/lib/provisioning";
import { generateVoucherBatch, normalizeVoucherCode } from "@/lib/vouchers";
import { voucherBatchSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  return handle(async () => {
    await requireAdmin();
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const packageId = url.searchParams.get("package_id");
    const routerId = url.searchParams.get("router_id");
    const search = url.searchParams.get("q");
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 100) || 100, 500);

    const admin = createAdminClient();
    let query = admin
      .from("vouchers")
      .select(
        "*, package:packages(id,name,duration_minutes,price,currency,speed_limit_down,speed_limit_up,data_limit_mb,device_limit)",
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    if (status && status !== "all") query = query.eq("status", status);
    if (packageId) query = query.eq("package_id", packageId);
    if (routerId) query = query.eq("router_id", routerId);
    if (search) query = query.ilike("code", `%${normalizeVoucherCode(search)}%`);

    const { data, error } = await query;
    if (error) throw new HttpError(500, error.message);
    return ok(data);
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const adminUser = await requireAdmin();
    const input = await parseJson(request, voucherBatchSchema);
    const admin = createAdminClient();

    const { data: pkgRow, error: pkgError } = await admin
      .from("packages")
      .select("*")
      .eq("id", input.package_id)
      .maybeSingle();
    if (pkgError) throw new HttpError(500, pkgError.message);
    if (!pkgRow) throw new HttpError(404, "Package not found");
    const pkg = pkgRow as PackageRow;

    let router: RouterRow | null = null;
    if (input.router_id) {
      const { data: routerRow, error: routerError } = await admin
        .from("routers")
        .select("*")
        .eq("id", input.router_id)
        .maybeSingle();
      if (routerError) throw new HttpError(500, routerError.message);
      if (!routerRow) throw new HttpError(404, "Router not found");
      router = routerRow as RouterRow;
    }

    const prefix = input.prefix ? normalizeVoucherCode(input.prefix) : "";
    const codes = generateVoucherBatch(input.count, input.length).map((code) => `${prefix}${code}`);
    const batchId = randomUUID();

    const { data: inserted, error: insertError } = await admin
      .from("vouchers")
      .insert(
        codes.map((code) => ({
          code,
          package_id: pkg.id,
          router_id: router?.id ?? null,
          batch_id: batchId,
          price_paid: pkg.price,
          created_by: adminUser.id,
        })),
      )
      .select("*");

    if (insertError) throw new HttpError(500, insertError.message);
    const vouchers = (inserted ?? []) as VoucherRow[];

    let provisioning: {
      attempted: number;
      provisioned: number;
      failed: Array<{ code: string; error: string }>;
      skipped?: string;
    } = { attempted: 0, provisioned: 0, failed: [] };

    if (router) {
      if (router.status !== "online") {
        provisioning.skipped = "Router is not online. Provision the vouchers after the next successful check.";
      } else {
        const client = newRouterClient(router);
        try {
          await client.connect();
          await client.login();
          for (const voucher of vouchers) {
            provisioning.attempted += 1;
            const result = await provisionVoucher(client, { voucher, pkg });
            if (result.ok) provisioning.provisioned += 1;
            else provisioning.failed.push({ code: voucher.code, error: result.error ?? "Unknown error" });
          }
        } catch (error) {
          provisioning.skipped = error instanceof Error ? error.message : "Router connection failed";
        } finally {
          client.close();
        }
      }
    }

    return ok({ batch_id: batchId, vouchers, provisioning }, 201);
  });
}
