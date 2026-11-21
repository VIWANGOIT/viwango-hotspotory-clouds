import { requireAdmin } from "@/lib/auth";
import { handle, HttpError, ok } from "@/lib/http";
import { newRouterClient } from "@/lib/routers/credentials";
import { createAdminClient } from "@/lib/supabase/admin";
import type { RouterRow, VoucherRow } from "@/lib/types";
import { deprovisionVoucher } from "@/lib/provisioning";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await requireAdmin();
    const { id } = await context.params;
    const admin = createAdminClient();

    const { data: voucherRow, error } = await admin.from("vouchers").select("*").eq("id", id).maybeSingle();
    if (error) throw new HttpError(500, error.message);
    if (!voucherRow) throw new HttpError(404, "Voucher not found");
    const voucher = voucherRow as VoucherRow;

    await admin.from("vouchers").update({ status: "revoked" }).eq("id", voucher.id);

    let routerCleanup: { attempted: boolean; removed?: boolean; disconnected?: number; error?: string } = {
      attempted: false,
    };

    if (voucher.router_id) {
      const { data: routerRow } = await admin.from("routers").select("*").eq("id", voucher.router_id).maybeSingle();
      if (routerRow) {
        routerCleanup.attempted = true;
        const client = newRouterClient(routerRow as RouterRow);
        try {
          await client.connect();
          await client.login();
          const cleanup = await deprovisionVoucher(client, voucher.code);
          routerCleanup = { attempted: true, ...cleanup };
        } catch (caught) {
          routerCleanup.error = caught instanceof Error ? caught.message : "Router cleanup failed";
        } finally {
          client.close();
        }
      }
    }

    return ok({ revoked: true, router: routerCleanup });
  });
}
