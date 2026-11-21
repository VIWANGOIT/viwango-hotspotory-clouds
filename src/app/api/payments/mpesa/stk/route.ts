import { z } from "zod";
import { handle, HttpError, ok, parseJson } from "@/lib/http";
import { initiateStkPush, normalizeMpesaPhone } from "@/lib/mpesa";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PackageRow } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const schema = z.object({
  phone: z.string().trim().min(9).max(20),
  package_id: z.string().uuid(),
  router_id: z.string().uuid().nullable().optional(),
});

export async function POST(request: Request) {
  return handle(async () => {
    const limit = rateLimit(`stk:${clientIp(request)}`, 5, 60_000);
    if (!limit.allowed) throw new HttpError(429, "Too many payment attempts. Wait a minute.");

    const input = await parseJson(request, schema);
    const phone = normalizeMpesaPhone(input.phone);
    if (!phone) throw new HttpError(422, "Enter a valid Tanzanian M-Pesa number");

    const admin = createAdminClient();
    const { data: pkgRow, error: pkgError } = await admin
      .from("packages")
      .select("*")
      .eq("id", input.package_id)
      .eq("is_active", true)
      .maybeSingle();
    if (pkgError) throw new HttpError(500, pkgError.message);
    if (!pkgRow) throw new HttpError(404, "Package not found");
    const pkg = pkgRow as PackageRow;

    const { data: payment, error: paymentError } = await admin
      .from("payments")
      .insert({
        provider: "mpesa",
        phone,
        amount: pkg.price,
        reference: `PENDING-${crypto.randomUUID()}`,
        status: "pending",
        payload: { package_id: pkg.id, router_id: input.router_id ?? null },
      })
      .select("*")
      .single();
    if (paymentError) throw new HttpError(500, paymentError.message);

    try {
      const push = await initiateStkPush({
        phone,
        amount: Number(pkg.price),
        accountReference: "VIWANGO",
        description: `${pkg.name} hotspot`,
      });

      await admin
        .from("payments")
        .update({
          reference: push.checkoutRequestId,
          payload: { package_id: pkg.id, router_id: input.router_id ?? null, merchant_request_id: push.merchantRequestId },
        })
        .eq("id", payment.id);

      return ok({
        checkout_request_id: push.checkoutRequestId,
        message: push.customerMessage,
        amount: Number(pkg.price),
        package: { id: pkg.id, name: pkg.name, duration_minutes: pkg.duration_minutes },
      });
    } catch (error) {
      await admin.from("payments").update({ status: "failed" }).eq("id", payment.id);
      throw error;
    }
  });
}
