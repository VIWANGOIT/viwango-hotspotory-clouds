import { handle, HttpError, ok } from "@/lib/http";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PaymentRow, VoucherRow } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return handle(async () => {
    const reference = new URL(request.url).searchParams.get("ref");
    if (!reference) throw new HttpError(400, "Missing payment reference");

    const admin = createAdminClient();
    const { data, error } = await admin.from("payments").select("*").eq("reference", reference).maybeSingle();
    if (error) throw new HttpError(500, error.message);
    if (!data) throw new HttpError(404, "Payment not found");

    const payment = data as PaymentRow;
    let voucher: Pick<VoucherRow, "code" | "expires_at"> | null = null;
    if (payment.voucher_id) {
      const { data: voucherRow } = await admin
        .from("vouchers")
        .select("code, expires_at")
        .eq("id", payment.voucher_id)
        .maybeSingle();
      voucher = (voucherRow as Pick<VoucherRow, "code" | "expires_at">) ?? null;
    }

    return ok({ status: payment.status, amount: payment.amount, voucher });
  });
}
