"use client";

import { useEffect, useState } from "react";
import { formatDuration, formatMoney } from "@/lib/format";

interface PortalPackage {
  id: string;
  name: string;
  price: number;
  currency: string;
  duration_minutes: number;
  speed_limit_down: string | null;
  speed_limit_up: string | null;
}

interface ActivationResult {
  code: string;
  status: string;
  expires_at: string | null;
  package: { name: string; duration_minutes: number; speed_limit_down: string | null; speed_limit_up: string | null };
  login_url: string | null;
}

interface PaymentState {
  reference: string;
  status: string;
  voucher: { code: string; expires_at: string | null } | null;
}

export function PortalClient({
  businessName,
  tagline,
  supportPhone,
  packages,
  routerId,
  mpesaEnabled,
}: {
  businessName: string;
  tagline: string;
  supportPhone: string;
  packages: PortalPackage[];
  routerId: string | null;
  mpesaEnabled: boolean;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ActivationResult | null>(null);

  const [buying, setBuying] = useState<PortalPackage | null>(null);
  const [phone, setPhone] = useState("");
  const [payment, setPayment] = useState<PaymentState | null>(null);

  useEffect(() => {
    if (!payment || payment.status !== "pending") return;
    const timer = setInterval(async () => {
      const response = await fetch(`/api/payments/mpesa/status?ref=${encodeURIComponent(payment.reference)}`);
      if (!response.ok) return;
      const payload = await response.json().catch(() => null);
      if (!payload?.data) return;
      setPayment({ reference: payment.reference, status: payload.data.status, voucher: payload.data.voucher ?? null });
    }, 3000);
    return () => clearInterval(timer);
  }, [payment]);

  async function activate(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);

    const response = await fetch("/api/portal/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, router_id: routerId }),
    });
    const payload = await response.json().catch(() => null);
    setBusy(false);

    if (!response.ok) {
      setError(payload?.error ?? "Could not activate this voucher");
      return;
    }
    setResult(payload.data as ActivationResult);
  }

  async function pay(event: React.FormEvent) {
    event.preventDefault();
    if (!buying) return;
    setBusy(true);
    setError(null);

    const response = await fetch("/api/payments/mpesa/stk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, package_id: buying.id, router_id: routerId }),
    });
    const payload = await response.json().catch(() => null);
    setBusy(false);

    if (!response.ok) {
      setError(payload?.error ?? "Could not start the payment");
      return;
    }
    setPayment({ reference: payload.data.checkout_request_id, status: "pending", voucher: null });
    setBuying(null);
    setPhone("");
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-10">
      <header className="text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand text-2xl font-bold text-ink">V</div>
        <h1 className="mt-4 font-display text-3xl font-semibold text-white">{businessName}</h1>
        <p className="mt-1 text-sm text-white/50">{tagline}</p>
      </header>

      {error && <p className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}

      {result ? (
        <section className="card mt-8 p-6 text-center">
          <p className="text-xs uppercase tracking-wider text-brand">Connected plan</p>
          <h2 className="mt-2 font-display text-2xl text-white">{result.package.name}</h2>
          <p className="mt-1 text-sm text-white/50">
            {formatDuration(result.package.duration_minutes)}
            {result.package.speed_limit_down ? ` · ${result.package.speed_limit_down} download` : ""}
            {result.package.speed_limit_up ? ` · ${result.package.speed_limit_up} upload` : ""}
          </p>
          <p className="mt-4 font-mono text-lg tracking-[0.2em] text-white">{result.code}</p>
          {result.expires_at && (
            <p className="mt-1 text-xs text-white/40">Valid until {new Date(result.expires_at).toLocaleString()}</p>
          )}
          {result.login_url ? (
            <a
              href={result.login_url}
              className="mt-6 inline-block rounded-xl bg-brand px-6 py-3 font-semibold text-ink transition hover:bg-brand/90"
            >
              Connect now
            </a>
          ) : (
            <p className="mt-6 text-sm text-white/55">
              Enter this code on the hotspot login page to get online.
            </p>
          )}
          <button
            type="button"
            onClick={() => {
              setResult(null);
              setCode("");
            }}
            className="mt-4 block w-full text-xs text-white/35 hover:text-white/70"
          >
            Activate another voucher
          </button>
        </section>
      ) : (
        <form onSubmit={activate} className="card mt-8 p-6">
          <label className="field-label" htmlFor="voucher">
            Voucher code
          </label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              id="voucher"
              className="field font-mono text-base tracking-[0.15em] uppercase"
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder="ABCD-2345"
              autoComplete="off"
              required
            />
            <button
              type="submit"
              disabled={busy}
              className="rounded-xl bg-brand px-6 py-2.5 font-semibold text-ink transition hover:bg-brand/90 disabled:opacity-60"
            >
              {busy ? "Activating…" : "Activate"}
            </button>
          </div>
          <p className="mt-2 text-xs text-white/35">
            The clock starts the moment the router accepts the code. If the router is unreachable, the voucher stays unused.
          </p>
        </form>
      )}

      {payment && (
        <section className="card mt-6 p-6">
          {payment.status === "paid" && payment.voucher ? (
            <div className="text-center">
              <p className="text-xs uppercase tracking-wider text-brand">Payment received</p>
              <p className="mt-2 text-sm text-white/60">Your voucher code</p>
              <p className="mt-2 font-mono text-xl tracking-[0.2em] text-white">{payment.voucher.code}</p>
              <button
                type="button"
                onClick={() => {
                  setCode(payment.voucher!.code);
                  setPayment(null);
                }}
                className="mt-4 rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-ink"
              >
                Use this code
              </button>
            </div>
          ) : payment.status === "failed" ? (
            <p className="text-center text-sm text-red-200">Payment failed or was cancelled. Try again.</p>
          ) : (
            <p className="text-center text-sm text-white/60">
              Waiting for M-Pesa confirmation… approve the prompt on your phone.
            </p>
          )}
        </section>
      )}

      {packages.length > 0 && (
        <section className="mt-8">
          <h2 className="font-display text-lg font-semibold text-white">Buy a package</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {packages.map((pkg) => (
              <div key={pkg.id} className="card p-4">
                <div className="flex items-baseline justify-between">
                  <p className="font-medium text-white/90">{pkg.name}</p>
                  <p className="font-display text-lg text-brand">{formatMoney(pkg.price, pkg.currency)}</p>
                </div>
                <p className="mt-1 text-xs text-white/45">
                  {formatDuration(pkg.duration_minutes)}
                  {pkg.speed_limit_down ? ` · ${pkg.speed_limit_down} ↓` : ""}
                  {pkg.speed_limit_up ? ` · ${pkg.speed_limit_up} ↑` : ""}
                </p>
                {mpesaEnabled ? (
                  buying?.id === pkg.id ? (
                    <form onSubmit={pay} className="mt-3 space-y-2">
                      <input
                        className="field"
                        placeholder="07XX XXX XXX"
                        value={phone}
                        onChange={(event) => setPhone(event.target.value)}
                        required
                      />
                      <div className="flex gap-2">
                        <button type="submit" disabled={busy} className="flex-1 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-ink disabled:opacity-60">
                          {busy ? "Sending…" : "Pay with M-Pesa"}
                        </button>
                        <button type="button" onClick={() => setBuying(null)} className="rounded-lg border border-white/12 px-3 py-2 text-xs text-white/60">
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setBuying(pkg)}
                      className="mt-3 w-full rounded-lg border border-brand/40 px-3 py-2 text-xs font-semibold text-brand transition hover:bg-brand/10"
                    >
                      Buy with M-Pesa
                    </button>
                  )
                ) : (
                  <p className="mt-3 text-xs text-white/35">Ask the operator for a voucher.</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <footer className="mt-10 text-center text-xs text-white/30">
        {supportPhone ? `Support: ${supportPhone} · ` : ""}
        Powered by VIWANGO Hotspot Cloud
      </footer>
    </div>
  );
}
