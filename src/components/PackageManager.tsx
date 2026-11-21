"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PackageRow } from "@/lib/types";
import { formatDuration, formatMoney } from "@/lib/format";
import { StatusPill } from "./StatusPill";

const emptyForm = {
  name: "",
  description: "",
  price: "500",
  duration_minutes: "60",
  data_limit_mb: "",
  speed_limit_down: "3M",
  speed_limit_up: "1M",
  device_limit: "1",
};

export function PackageManager({ packages }: { packages: PackageRow[] }) {
  const router = useRouter();
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);

    const response = await fetch("/api/packages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        description: form.description || null,
        price: Number(form.price),
        duration_minutes: Number(form.duration_minutes),
        data_limit_mb: form.data_limit_mb ? Number(form.data_limit_mb) : null,
        speed_limit_down: form.speed_limit_down || null,
        speed_limit_up: form.speed_limit_up || null,
        device_limit: Number(form.device_limit),
      }),
    });
    const payload = await response.json().catch(() => null);
    setBusy(false);
    if (!response.ok) {
      setError(payload?.error ?? "Could not create the package");
      return;
    }
    setForm(emptyForm);
    setNotice("Package created.");
    router.refresh();
  }

  async function toggle(pkg: PackageRow) {
    setBusy(true);
    await fetch(`/api/packages/${pkg.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !pkg.is_active }),
    });
    setBusy(false);
    router.refresh();
  }

  async function remove(pkg: PackageRow) {
    if (!confirm(`Delete ${pkg.name}?`)) return;
    setBusy(true);
    const response = await fetch(`/api/packages/${pkg.id}`, { method: "DELETE" });
    const payload = await response.json().catch(() => null);
    setBusy(false);
    if (!response.ok) {
      setError(payload?.error ?? "Could not delete the package");
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-white">Packages</h1>
        <p className="mt-1 text-sm text-white/50">
          Each package becomes a RouterOS hotspot user profile (speed limit, session time, device limit).
        </p>
      </div>

      {(error || notice) && (
        <p className={`rounded-lg border p-3 text-sm ${error ? "border-red-500/30 bg-red-500/10 text-red-200" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"}`}>
          {error ?? notice}
        </p>
      )}

      <form onSubmit={create} className="card grid gap-4 p-6 sm:grid-cols-3">
        <div>
          <label className="field-label">Name</label>
          <input className="field" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Siku 1" />
        </div>
        <div>
          <label className="field-label">Price (TZS)</label>
          <input className="field" type="number" min={0} required value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
        </div>
        <div>
          <label className="field-label">Duration (minutes)</label>
          <input className="field" type="number" min={1} required value={form.duration_minutes} onChange={(e) => setForm({ ...form, duration_minutes: e.target.value })} />
        </div>
        <div>
          <label className="field-label">Download limit</label>
          <input className="field" value={form.speed_limit_down} onChange={(e) => setForm({ ...form, speed_limit_down: e.target.value })} placeholder="3M" />
        </div>
        <div>
          <label className="field-label">Upload limit</label>
          <input className="field" value={form.speed_limit_up} onChange={(e) => setForm({ ...form, speed_limit_up: e.target.value })} placeholder="1M" />
        </div>
        <div>
          <label className="field-label">Devices</label>
          <input className="field" type="number" min={1} value={form.device_limit} onChange={(e) => setForm({ ...form, device_limit: e.target.value })} />
        </div>
        <div>
          <label className="field-label">Data cap (MB, optional)</label>
          <input className="field" type="number" min={1} value={form.data_limit_mb} onChange={(e) => setForm({ ...form, data_limit_mb: e.target.value })} placeholder="unlimited" />
        </div>
        <div className="sm:col-span-2">
          <label className="field-label">Description</label>
          <input className="field" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <div className="sm:col-span-3">
          <button type="submit" disabled={busy} className="rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-ink disabled:opacity-60">
            {busy ? "Saving…" : "Add package"}
          </button>
        </div>
      </form>

      <div className="card overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-white/8 bg-white/[0.03] text-xs uppercase tracking-wider text-white/40">
            <tr>
              <th className="px-4 py-3">Package</th>
              <th className="px-4 py-3">Price</th>
              <th className="px-4 py-3">Duration</th>
              <th className="px-4 py-3">Speed</th>
              <th className="px-4 py-3">State</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {packages.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-white/40">
                  No packages yet.
                </td>
              </tr>
            )}
            {packages.map((pkg) => (
              <tr key={pkg.id}>
                <td className="px-4 py-3">
                  <p className="font-medium text-white/90">{pkg.name}</p>
                  <p className="text-xs text-white/35">{pkg.description || "—"}</p>
                </td>
                <td className="px-4 py-3 text-white/70">{formatMoney(pkg.price, pkg.currency)}</td>
                <td className="px-4 py-3 text-white/60">{formatDuration(pkg.duration_minutes)}</td>
                <td className="px-4 py-3 text-xs text-white/55">
                  {pkg.speed_limit_down || "—"} ↓ / {pkg.speed_limit_up || "—"} ↑
                </td>
                <td className="px-4 py-3">
                  <StatusPill status={pkg.is_active ? "active" : "closed"} label={pkg.is_active ? "on sale" : "hidden"} />
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => toggle(pkg)}
                      className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/70 hover:border-white/30 hover:text-white disabled:opacity-50"
                    >
                      {pkg.is_active ? "Hide" : "Publish"}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => remove(pkg)}
                      className="rounded-lg border border-red-500/25 px-3 py-1.5 text-xs text-red-200 hover:bg-red-500/10 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
