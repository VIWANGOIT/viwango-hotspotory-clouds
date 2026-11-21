import { getServerEnv, isMpesaConfigured } from "@/lib/env";
import { HttpError } from "@/lib/http";

interface TokenCache {
  token: string;
  expiresAt: number;
}

let cache: TokenCache | null = null;

function baseUrl(): string {
  return getServerEnv().MPESA_ENVIRONMENT === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";
}

function nairobiTimestamp(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}${get("month")}${get("day")}${get("hour")}${get("minute")}${get("second")}`;
}

/** Accepts 07xx..., 7xx..., +2557xx... and returns 2557xxxxxxxx. */
export function normalizeMpesaPhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  if (/^0[67]\d{8}$/.test(digits)) return `255${digits.slice(1)}`;
  if (/^[67]\d{8}$/.test(digits)) return `255${digits}`;
  if (/^255[67]\d{8}$/.test(digits)) return digits;
  return null;
}

async function accessToken(): Promise<string> {
  if (cache && cache.expiresAt > Date.now() + 30_000) return cache.token;
  const env = getServerEnv();
  if (!isMpesaConfigured()) throw new HttpError(503, "M-Pesa is not configured");

  const credentials = Buffer.from(`${env.MPESA_CONSUMER_KEY}:${env.MPESA_CONSUMER_SECRET}`).toString("base64");
  const response = await fetch(`${baseUrl()}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${credentials}` },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new HttpError(502, `M-Pesa authentication failed (${response.status})`);
  }
  const body = (await response.json()) as { access_token: string; expires_in: string };
  cache = { token: body.access_token, expiresAt: Date.now() + Number(body.expires_in ?? 3599) * 1000 };
  return cache.token;
}

export interface StkPushInput {
  phone: string;
  amount: number;
  accountReference: string;
  description: string;
}

export interface StkPushResult {
  merchantRequestId: string;
  checkoutRequestId: string;
  customerMessage: string;
  raw: Record<string, unknown>;
}

export async function initiateStkPush(input: StkPushInput): Promise<StkPushResult> {
  const env = getServerEnv();
  if (!isMpesaConfigured()) throw new HttpError(503, "M-Pesa is not configured");

  const phone = normalizeMpesaPhone(input.phone);
  if (!phone) throw new HttpError(422, "Enter a valid Tanzanian M-Pesa number");

  const timestamp = nairobiTimestamp();
  const password = Buffer.from(`${env.MPESA_SHORTCODE}${env.MPESA_PASSKEY}${timestamp}`).toString("base64");
  const token = await accessToken();

  const response = await fetch(`${baseUrl()}/mpesa/stkpush/v1/processrequest`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      BusinessShortCode: env.MPESA_SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: Math.round(input.amount),
      PartyA: phone,
      PartyB: env.MPESA_SHORTCODE,
      PhoneNumber: phone,
      CallBackURL: env.MPESA_CALLBACK_URL,
      AccountReference: input.accountReference.slice(0, 12),
      TransactionDesc: input.description.slice(0, 60),
    }),
  });

  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || body.ResponseCode !== "0") {
    const message = (body.errorMessage as string) ?? (body.ResponseDescription as string) ?? "STK push rejected";
    throw new HttpError(502, message);
  }

  return {
    merchantRequestId: String(body.MerchantRequestID ?? ""),
    checkoutRequestId: String(body.CheckoutRequestID ?? ""),
    customerMessage: String(body.CustomerMessage ?? "Check your phone to complete the payment"),
    raw: body,
  };
}

export interface ParsedCallback {
  success: boolean;
  checkoutRequestId: string;
  receipt: string | null;
  amount: number | null;
  phone: string | null;
  description: string;
}

export function parseCallback(payload: {
  Body: {
    stkCallback: {
      CheckoutRequestID?: string;
      ResultCode: number;
      ResultDesc?: string;
      CallbackMetadata?: { Item: Array<{ Name: string; Value?: string | number }> };
    };
  };
}): ParsedCallback {
  const callback = payload.Body.stkCallback;
  const items = callback.CallbackMetadata?.Item ?? [];
  const value = (name: string) => items.find((item) => item.Name === name)?.Value;

  return {
    success: callback.ResultCode === 0,
    checkoutRequestId: callback.CheckoutRequestID ?? "",
    receipt: value("MpesaReceiptNumber") ? String(value("MpesaReceiptNumber")) : null,
    amount: value("Amount") != null ? Number(value("Amount")) : null,
    phone: value("PhoneNumber") ? String(value("PhoneNumber")) : null,
    description: callback.ResultDesc ?? "",
  };
}
