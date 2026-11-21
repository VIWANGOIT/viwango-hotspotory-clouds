"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PublicRouter } from "@/lib/routers/present";
import type { AcceptanceView, RouterEventRow } from "@/lib/types";
import { formatDate, formatRelative } from "@/lib/format";
import { AcceptanceSteps } from "./AcceptanceSteps";
import { StatusPill } from "./StatusPill";

interface Props {
  router: PublicRouter;
  events: RouterEventRow[];
}

export function RouterDetailPanel({ router: initialRouter, events }: Props) {
  const router = useRouter();
  const [record, setRecord] = useState(initialRouter);
  const [acceptance, setAcceptance] = useState<AcceptanceView | null>(
    record.health
      ? {
          accepted: record.status === "online",
          authMode: record.health.auth_mode,
          latencyMs: record.health.latency_ms,
          steps: record.health.steps,
          warnings: record.health.warnings,
          error: record.last_error ? { code: "LAST_ERROR", message: record.last_error } : null,
        }
      : null,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    name: record.name,
    host: record.host,
    api_port: String(record.api_port),
    username: record.username,
    password: "",
    use_tls: record.use_tls,
    tls_verify: record.tls_verify,
    hotspot_server: record.hotspot_server ?? "",
    hotspot_login_url: record.hotspot_login_url ?? "",
  });

  async function call(path: string, init?: RequestInit) {
    const response = await fetch(path, init);
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error ?? "Request failed");
    return payload?.data;
  }

  async function verify() {
    setBusy("verify");
    setError(null);
    setMessage(null);
    try {
      const data = await call(`/api/routers/${record.id}/verify`, { method: "POST" });
      setAcceptance(data.acceptance as AcceptanceView);
      setRecord(data.router as PublicRouter);
      setMessage(data.acceptance.accepted ? "Router accepted. Vouchers can be provisioned." : "Router rejected the connection.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Verification failed");
    } finally {
      setBusy(null);
    }
  }

  async function syncSessions() {
    setBusy("sync");
    setError(null);
    setMessage(null);
    try {
      const data = await call(`/api/routers/${record.id}/sync`, { method: "POST" });
      setMessage(`Sessions synced: ${data.open} live on the router, ${data.closed} closed in the cloud.`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sync failed");
    } finally {
      setBusy(null);
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy("save");
    setError(null);
    setMessage(null);
    try {
      const body: Record<string, unknown> = {
        name: form.name,
        host: form.host,
        api_port: Number(form.api_port),
        username: form.username,
        use_tls: form.use_tls,
        tls_verify: form.tls_verify,
        hotspot_server: form.hotspot_server || null,
        hotspot_login_url: form.hotspot_login_url || null,
      };
      if (form.password) body.password = form.password;

      const data = await call(`/api/routers/${record.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setRecord(data.router as PublicRouter);
      if (data.acceptance) setAcceptance(data.acceptance as AcceptanceView);
      setEditing(false);
      setForm((current) => ({ ...current, password: "" }));
      setMessage("Router saved and re-tested.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Save failed");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!confirm(`Delete ${record.name}? Vouchers assigned to it are kept but lose their router.`)) return;
    setBusy("delete");
    try {
      await call(`/api/routers/${record.id}`, { method: "DELETE" });
      router.replace("/dashboard/routers");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Delete failed");
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs text-white/35">
          <a href="/dashboard/routers" className="hover:text-white">
            ← Routers
          </a>
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl font-semibold text-white">{record.name}</h1>
          <StatusPill status={record.status} />
        </div>
        <p className="mt-1 text-sm text-white/45">
          {record.host}:{record.api_port} · {record.use_tls ? "API-SSL" : "API"} · user {record.username}
        </p>
      </div>

      {(error || message) && (
        <p
          className={`rounded-lg border p-3 text-sm ${
            error ? "border-red-500/30 bg-red-500/10 text-red-200" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
          }`}
        >
          {error ?? message}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="card p-4">
          <p className="text-[11px] uppercase tracking-wider text-white/35">Handshake</p>
          <p className="mt-1 font-display text-lg text-white">{record.auth_mode ?? "unknown"}</p>
          <p className="text-xs text-white/35">{record.health ? `${record.health.latency_ms}ms` : "not measured"}</p>
        </div>
        <div className="card p-4">
          <p className="text-[11px] uppercase tracking-wider text-white/35">RouterOS</p>
          <p className="mt-1 font-display text-lg text-white">{record.ros_version ?? "—"}</p>
          <p className="text-xs text-white/35">{record.board_name ?? record.architecture ?? ""}</p>
        </div>
        <div className="card p-4">
          <p className="text-[11px] uppercase tracking-wider text-white/35">Hotspot servers</p>
          <p className="mt-1 font-display text-lg text-white">{record.hotspot_servers.length}</p>
          <p className="truncate text-xs text-white/35">{record.hotspot_servers.join(", ") || "none detected"}</p>
        </div>
        <div className="card p-4">
          <p className="text-[11px] uppercase tracking-wider text-white/35">Last seen</p>
          <p className="mt-1 font-display text-lg text-white">{formatRelative(record.last_seen_at)}</p>
          <p className="text-xs text-white/35">{formatDate(record.accepted_at)}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={verify}
          disabled={busy !== null}
          className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-ink transition hover:bg-brand/90 disabled:opacity-60"
        >
          {busy === "verify" ? "Running acceptance…" : "Run acceptance check"}
        </button>
        <button
          type="button"
          onClick={syncSessions}
          disabled={busy !== null}
          className="rounded-xl border border-white/12 px-4 py-2 text-sm text-white/75 transition hover:border-white/30 hover:text-white disabled:opacity-60"
        >
          {busy === "sync" ? "Syncing…" : "Sync live sessions"}
        </button>
        <button
          type="button"
          onClick={() => setEditing((value) => !value)}
          className="rounded-xl border border-white/12 px-4 py-2 text-sm text-white/75 transition hover:border-white/30 hover:text-white"
        >
          {editing ? "Cancel edit" : "Edit settings"}
        </button>
        <button
          type="button"
          onClick={remove}
          disabled={busy !== null}
          className="rounded-xl border border-red-500/30 px-4 py-2 text-sm text-red-200 transition hover:bg-red-500/10 disabled:opacity-60"
        >
          Delete router
        </button>
      </div>

      {editing && (
        <form onSubmit={save} className="card grid gap-4 p-6 sm:grid-cols-2">
          <div>
            <label className="field-label">Name</label>
            <input className="field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div>
            <label className="field-label">Host</label>
            <input className="field" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} required />
          </div>
          <div>
            <label className="field-label">API port</label>
            <input className="field" type="number" value={form.api_port} onChange={(e) => setForm({ ...form, api_port: e.target.value })} />
          </div>
          <div>
            <label className="field-label">Username</label>
            <input className="field" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required />
          </div>
          <div>
            <label className="field-label">New password (leave empty to keep)</label>
            <input
              className="field"
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              autoComplete="new-password"
            />
          </div>
          <div>
            <label className="field-label">Hotspot server</label>
            <input className="field" value={form.hotspot_server} onChange={(e) => setForm({ ...form, hotspot_server: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <label className="field-label">Captive portal login URL</label>
            <input className="field" value={form.hotspot_login_url} onChange={(e) => setForm({ ...form, hotspot_login_url: e.target.value })} />
          </div>
          <div className="flex flex-wrap gap-5 sm:col-span-2">
            <label className="flex items-center gap-2 text-sm text-white/70">
              <input type="checkbox" checked={form.use_tls} onChange={(e) => setForm({ ...form, use_tls: e.target.checked })} />
              API-SSL
            </label>
            <label className="flex items-center gap-2 text-sm text-white/70">
              <input type="checkbox" checked={form.tls_verify} onChange={(e) => setForm({ ...form, tls_verify: e.target.checked })} />
              Verify certificate
            </label>
          </div>
          <div className="sm:col-span-2">
            <button type="submit" disabled={busy !== null} className="rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-ink disabled:opacity-60">
              {busy === "save" ? "Saving and testing…" : "Save changes"}
            </button>
          </div>
        </form>
      )}

      <section className="card p-6">
        <h2 className="font-display text-base font-semibold text-white">Acceptance report</h2>
        <p className="mb-4 mt-1 text-xs text-white/40">
          Each step must pass before the cloud trusts this router with vouchers.
        </p>
        <AcceptanceSteps steps={acceptance?.steps ?? []} />
        {acceptance?.warnings?.length ? (
          <ul className="mt-3 space-y-1 text-xs text-amber-200/80">
            {acceptance.warnings.map((warning) => (
              <li key={warning}>• {warning}</li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="card overflow-hidden">
        <h2 className="px-5 pt-5 font-display text-base font-semibold text-white">Event log</h2>
        <table className="mt-3 w-full text-left text-sm">
          <thead className="border-b border-white/8 text-xs uppercase tracking-wider text-white/35">
            <tr>
              <th className="px-5 py-2">When</th>
              <th className="px-5 py-2">Level</th>
              <th className="px-5 py-2">Code</th>
              <th className="px-5 py-2">Message</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {events.length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-6 text-center text-white/40">
                  No events yet.
                </td>
              </tr>
            )}
            {events.map((event) => (
              <tr key={event.id}>
                <td className="px-5 py-2 text-xs text-white/40">{formatRelative(event.created_at)}</td>
                <td className="px-5 py-2">
                  <StatusPill status={event.level === "error" ? "fail" : event.level === "warn" ? "warn" : "pass"} label={event.level} />
                </td>
                <td className="px-5 py-2 font-mono text-xs text-white/60">{event.code}</td>
                <td className="px-5 py-2 text-xs text-white/55">{event.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
