import { handle, ok } from "@/lib/http";
import { parseCallback } from "@/lib/mpesa";
import { createAdminClient } from "@/lib/supabase/admin";
import { provisionVoucherOnRouter } from "@/lib/provisioning";
import type { PackageRow, PaymentRow, RouterRow, VoucherRow } from "@/lib/types";
import { generateVoucherCode } from "@/lib/vouchers";
import { mpesaCallbackSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  return handle(async () => {
    const payload = await request.json().catch(() => null);
    const parsed = mpesaCallbackSchema.safeParse(payload);
    if (!parsed.success) {
      // Safaricom retries on non 2xx, and an unparseable body will never improve.
      return ok({ ResultCode: 0, ResultDesc: "Ignored" });
    }

    const callback = parseCallback(parsed.data);
    const admin = createAdminClient();

    const { data: paymentRow } = await admin
      .from("payments")
      .select("*")
      .eq("reference", callback.checkoutRequestId)
      .maybeSingle();
    if (!paymentRow) return ok({ ResultCode: 0, ResultDesc: "Unknown reference" });

    const payment = paymentRow as PaymentRow;
    if (payment.status === "paid") return ok({ ResultCode: 0, ResultDesc: "Already processed" });

    if (!callback.success) {
      await admin
        .from("payments")
        .update({ status: "failed", payload: { ...(payment.payload ?? {}), result: callback.description } })
        .eq("id", payment.id);
      return ok({ ResultCode: 0, ResultDesc: "Recorded failure" });
    }

    const packageId = (payment.payload?.package_id as string | undefined) ?? null;
    const routerId = (payment.payload?.router_id as string | undefined) ?? null;
    if (!packageId) return ok({ ResultCode: 0, ResultDesc: "Missing package" });

    const { data: pkgRow } = await admin.from("packages").select("*").eq("id", packageId).maybeSingle();
    if (!pkgRow) return ok({ ResultCode: 0, ResultDesc: "Package missing" });
    const pkg = pkgRow as PackageRow;

    let voucher: VoucherRow | null = null;
    for (let attempt = 0; attempt < 5 && !voucher; attempt += 1) {
      const { data, error } = await admin
        .from("vouchers")
        .insert({
          code: generateVoucherCode(),
          package_id: pkg.id,
          router_id: routerId,
          price_paid: callback.amount ?? pkg.price,
          customer_phone: callback.phone ?? payment.phone,
          payment_ref: callback.receipt,
        })
        .select("*")
        .single();
      if (!error) voucher = data as VoucherRow;
      else if (error.code !== "23505") break;
    }

    await admin
      .from("payments")
      .update({
        status: "paid",
        voucher_id: voucher?.id ?? null,
        payload: { ...(payment.payload ?? {}), receipt: callback.receipt, amount_paid: callback.amount },
      })
      .eq("id", payment.id);

    if (voucher && routerId) {
      const { data: routerRow } = await admin.from("routers").select("*").eq("id", routerId).maybeSingle();
      if (routerRow && (routerRow as RouterRow).status === "online") {
        await provisionVoucherOnRouter(routerRow as RouterRow, voucher, pkg);
      }
    }

    return ok({ ResultCode: 0, ResultDesc: "Accepted" });
  });
}
