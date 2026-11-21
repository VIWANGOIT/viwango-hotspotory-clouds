import { requireAdmin } from "@/lib/auth";
import { handle, HttpError, ok } from "@/lib/http";
import { newRouterClient } from "@/lib/routers/credentials";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PackageRow, RouterRow, VoucherRow } from "@/lib/types";
import { provisionVoucher } from "@/lib/provisioning";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await requireAdmin();
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const admin = createAdminClient();

    const { data: voucherRow, error } = await admin.from("vouchers").select("*").eq("id", id).maybeSingle();
    if (error) throw new HttpError(500, error.message);
    if (!voucherRow) throw new HttpError(404, "Voucher not found");
    const voucher = voucherRow as VoucherRow;
    if (voucher.status === "revoked") throw new HttpError(409, "Voucher is revoked");

    const { data: pkgRow, error: pkgError } = await admin
      .from("packages")
      .select("*")
      .eq("id", voucher.package_id)
      .maybeSingle();
    if (pkgError) throw new HttpError(500, pkgError.message);
    if (!pkgRow) throw new HttpError(404, "Package not found");

    const routerId = (body?.router_id as string | undefined) ?? voucher.router_id;
    if (!routerId) throw new HttpError(400, "Choose a router for this voucher");

    const { data: routerRow, error: routerError } = await admin
      .from("routers")
      .select("*")
      .eq("id", routerId)
      .maybeSingle();
    if (routerError) throw new HttpError(500, routerError.message);
    if (!routerRow) throw new HttpError(404, "Router not found");
    const router = routerRow as RouterRow;

    const client = newRouterClient(router);
    try {
      await client.connect();
      await client.login();
      const result = await provisionVoucher(client, { voucher, pkg: pkgRow as PackageRow });
      if (!result.ok) throw new HttpError(502, result.error ?? "Provisioning failed");
      if (!voucher.router_id) {
        await admin.from("vouchers").update({ router_id: router.id }).eq("id", voucher.id);
      }
      return ok(result);
    } finally {
      client.close();
    }
  });
}
