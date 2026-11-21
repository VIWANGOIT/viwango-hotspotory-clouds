"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PublicRouter } from "@/lib/routers/present";
import type { AcceptanceView } from "@/lib/types";
import { AcceptanceSteps } from "./AcceptanceSteps";
import { StatusPill } from "./StatusPill";
import { formatRelative } from "@/lib/format";

const emptyForm = {
  name: "",
  host: "",
  api_port: "8728",
  username: "admin",
  password: "",
  use_tls: false,
  tls_verify: false,
  hotspot_server: "",
  hotspot_login_url: "",
};

export function RoutersPanel({ routers }: { routers: PublicRouter[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(routers.length === 0);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acceptance, setAcceptance] = useState<AcceptanceView | null>(null);
  const [verifying, setVerifying] = useState<string | null>(null);

  function update<K extends keyof typeof emptyForm>(key: K, value: (typeof emptyForm)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setAcceptance(null);

    const response = await fetch("/api/routers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        api_port: Number(form.api_port),
        hotspot_server: form.hotspot_server || null,
        hotspot_login_url: form.hotspot_login_url || null,
      }),
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      setError(payload?.error ?? "Could not add the router");
      setBusy(false);
      return;
    }

    setAcceptance(payload.data.acceptance as AcceptanceView);
    setForm(emptyForm);
    setBusy(false);
    router.refresh();
  }

  async function verify(id: string) {
    setVerifying(id);
    const response = await fetch(`/api/routers/${id}/verify`, { method: "POST" });
    const payload = await response.json().catch(() => null);
    setVerifying(null);
    if (!response.ok) {
      setError(payload?.error ?? "Verification failed");
      return;
    }
    setAcceptance(payload.data.acceptance as AcceptanceView);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-white">Routers</h1>
          <p className="mt-1 text-sm text-white/50">
            A router is only usable once the cloud can log in and read it. Every save re-runs the acceptance check.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-ink transition hover:bg-brand/90"
        >
          {open ? "Close form" : "Add router"}
        </button>
      </div>

      {error && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</p>
      )}

      {open && (
        <form onSubmit={submit} className="card grid gap-4 p-6 sm:grid-cols-2">
          <div>
            <label className="field-label">Router name</label>
            <input className="field" required value={form.name} onChange={(e) => update("name", e.target.value)} placeholder="Mwanza branch" />
          </div>
          <div>
            <label className="field-label">Public IP or DDNS host</label>
            <input className="field" required value={form.host} onChange={(e) => update("host", e.target.value)} placeholder="197.250.10.20" />
          </div>
          <div>
            <label className="field-label">API port</label>
            <input className="field" type="number" min={1} max={65535} value={form.api_port} onChange={(e) => update("api_port", e.target.value)} />
          </div>
          <div>
            <label className="field-label">API username</label>
            <input className="field" required value={form.username} onChange={(e) => update("username", e.target.value)} />
          </div>
          <div>
            <label className="field-label">API password</label>
            <input className="field" type="password" required value={form.password} onChange={(e) => update("password", e.target.value)} autoComplete="new-password" />
          </div>
          <div>
            <label className="field-label">Hotspot server (optional)</label>
            <input className="field" value={form.hotspot_server} onChange={(e) => update("hotspot_server", e.target.value)} placeholder="hotspot1" />
          </div>
          <div className="sm:col-span-2">
            <label className="field-label">Captive portal login URL (optional)</label>
            <input className="field" value={form.hotspot_login_url} onChange={(e) => update("hotspot_login_url", e.target.value)} placeholder="http://10.5.50.1/login" />
            <p className="mt-1 text-xs text-white/35">Used to send customers straight into the router hotspot login after activation.</p>
          </div>
          <div className="flex flex-wrap gap-5 sm:col-span-2">
            <label className="flex items-center gap-2 text-sm text-white/70">
              <input type="checkbox" checked={form.use_tls} onChange={(e) => update("use_tls", e.target.checked)} />
              Use API-SSL (port 8729)
            </label>
            <label className="flex items-center gap-2 text-sm text-white/70">
              <input type="checkbox" checked={form.tls_verify} onChange={(e) => update("tls_verify", e.target.checked)} />
              Verify TLS certificate
            </label>
          </div>
          <div className="sm:col-span-2">
            <button type="submit" disabled={busy} className="rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-ink transition hover:bg-brand/90 disabled:opacity-60">
              {busy ? "Testing handshake…" : "Save and test connection"}
            </button>
          </div>
        </form>
      )}

      {acceptance && (
        <div className="card p-6">
          <div className="mb-3 flex items-center gap-3">
            <StatusPill status={acceptance.accepted ? "online" : "rejected"} label={acceptance.accepted ? "Accepted" : "Not accepted"} />
            <span className="text-xs text-white/45">
              {acceptance.authMode ? `${acceptance.authMode} handshake` : "handshake unknown"} · {acceptance.latencyMs}ms
            </span>
          </div>
          <AcceptanceSteps steps={acceptance.steps} />
          {acceptance.error?.hint && <p className="mt-3 text-xs text-amber-200/80">{acceptance.error.hint}</p>}
          {acceptance.warnings.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-amber-200/80">
              {acceptance.warnings.map((warning) => (
                <li key={warning}>• {warning}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-white/8 bg-white/[0.03] text-xs uppercase tracking-wider text-white/40">
            <tr>
              <th className="px-4 py-3">Router</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Handshake</th>
              <th className="px-4 py-3">Last seen</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {routers.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-white/40">
                  No routers yet. Add the first MikroTik to get started.
                </td>
              </tr>
            )}
            {routers.map((router) => (
              <tr key={router.id} className="hover:bg-white/[0.02]">
                <td className="px-4 py-3">
                  <Link href={`/dashboard/routers/${router.id}`} className="font-medium text-white hover:text-brand">
                    {router.name}
                  </Link>
                  <p className="text-xs text-white/35">
                    {router.host}:{router.api_port}
                    {router.use_tls ? " · TLS" : ""}
                  </p>
                </td>
                <td className="px-4 py-3">
                  <StatusPill status={router.status} />
                  {router.last_error && <p className="mt-1 max-w-xs truncate text-xs text-red-300/70">{router.last_error}</p>}
                </td>
                <td className="px-4 py-3 text-xs text-white/55">
                  {router.auth_mode ?? "—"}
                  {router.ros_version ? ` · ${router.ros_version}` : ""}
                </td>
                <td className="px-4 py-3 text-xs text-white/45">{formatRelative(router.last_seen_at)}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => verify(router.id)}
                    disabled={verifying === router.id}
                    className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/70 transition hover:border-brand/40 hover:text-brand disabled:opacity-50"
                  >
                    {verifying === router.id ? "Checking…" : "Test"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
