"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { PackageRow, VoucherWithPackage } from "@/lib/types";
import { formatDate, formatDuration, formatMoney } from "@/lib/format";
import { StatusPill } from "./StatusPill";

interface RouterOption {
  id: string;
  name: string;
  status: string;
}

interface Props {
  vouchers: VoucherWithPackage[];
  packages: PackageRow[];
  routers: RouterOption[];
}

export function VoucherManager({ vouchers, packages, routers }: Props) {
  const router = useRouter();
  const [packageId, setPackageId] = useState(packages[0]?.id ?? "");
  const [count, setCount] = useState("20");
  const [prefix, setPrefix] = useState("");
  const [routerId, setRouterId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [acting, setActing] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return vouchers.filter((voucher) => {
      if (statusFilter !== "all" && voucher.status !== statusFilter) return false;
      if (search && !voucher.code.includes(search.toUpperCase().replace(/[^A-Z0-9]/g, ""))) return false;
      return true;
    });
  }, [vouchers, statusFilter, search]);

  async function generate(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);

    const response = await fetch("/api/vouchers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        package_id: packageId,
        count: Number(count),
        prefix: prefix || null,
        router_id: routerId || null,
      }),
    });
    const payload = await response.json().catch(() => null);
    setBusy(false);

    if (!response.ok) {
      setError(payload?.error ?? "Could not generate vouchers");
      return;
    }

    const provisioning = payload.data.provisioning as { provisioned: number; attempted: number; skipped?: string; failed: Array<{ code: string; error: string }> };
    setNotice(
      `${payload.data.vouchers.length} vouchers created.` +
        (provisioning.skipped
          ? ` Router skipped: ${provisioning.skipped}`
          : ` ${provisioning.provisioned}/${provisioning.attempted} pushed to the router.`),
    );
    router.refresh();
  }

  async function provision(voucher: VoucherWithPackage) {
    setActing(voucher.id);
    setError(null);
    setNotice(null);
    const response = await fetch(`/api/vouchers/${voucher.id}/provision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(routerId ? { router_id: routerId } : {}),
    });
    const payload = await response.json().catch(() => null);
    setActing(null);
    if (!response.ok) {
      setError(payload?.error ?? "Provisioning failed");
      return;
    }
    setNotice(`${voucher.code} is now on the router.`);
    router.refresh();
  }

  async function revoke(voucher: VoucherWithPackage) {
    if (!confirm(`Revoke ${voucher.code}? The hotspot user is removed and active sessions are disconnected.`)) return;
    setActing(voucher.id);
    setError(null);
    const response = await fetch(`/api/vouchers/${voucher.id}/revoke`, { method: "POST" });
    const payload = await response.json().catch(() => null);
    setActing(null);
    if (!response.ok) {
      setError(payload?.error ?? "Revoke failed");
      return;
    }
    setNotice(`${voucher.code} revoked.`);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-white">Vouchers</h1>
        <p className="mt-1 text-sm text-white/50">
          Generate codes, push them to a router, and track which ones are live. Codes avoid 0/O/1/I/L so printed slips stay readable.
        </p>
      </div>

      {(error || notice) && (
        <p className={`rounded-lg border p-3 text-sm ${error ? "border-red-500/30 bg-red-500/10 text-red-200" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"}`}>
          {error ?? notice}
        </p>
      )}

      <form onSubmit={generate} className="card grid gap-4 p-6 sm:grid-cols-5">
        <div className="sm:col-span-2">
          <label className="field-label">Package</label>
          <select className="field" value={packageId} onChange={(e) => setPackageId(e.target.value)} required>
            {packages.map((pkg) => (
              <option key={pkg.id} value={pkg.id}>
                {pkg.name} · {formatMoney(pkg.price, pkg.currency)} · {formatDuration(pkg.duration_minutes)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label">How many</label>
          <input className="field" type="number" min={1} max={500} value={count} onChange={(e) => setCount(e.target.value)} />
        </div>
        <div>
          <label className="field-label">Prefix (optional)</label>
          <input className="field" maxLength={6} value={prefix} onChange={(e) => setPrefix(e.target.value.toUpperCase())} placeholder="MWZ" />
        </div>
        <div>
          <label className="field-label">Router</label>
          <select className="field" value={routerId} onChange={(e) => setRouterId(e.target.value)}>
            <option value="">Cloud only</option>
            {routers.map((router) => (
              <option key={router.id} value={router.id}>
                {router.name} ({router.status})
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-5">
          <button type="submit" disabled={busy || !packageId} className="rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-ink disabled:opacity-60">
            {busy ? "Generating…" : "Generate vouchers"}
          </button>
        </div>
      </form>

      <div className="flex flex-wrap items-center gap-3">
        <select className="field max-w-44" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All statuses</option>
          <option value="unused">Unused</option>
          <option value="active">Active</option>
          <option value="expired">Expired</option>
          <option value="revoked">Revoked</option>
        </select>
        <input
          className="field max-w-64"
          placeholder="Search code"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="text-xs text-white/35">{filtered.length} shown</span>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-white/8 bg-white/[0.03] text-xs uppercase tracking-wider text-white/40">
            <tr>
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Package</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Expires</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-white/40">
                  No vouchers match this filter.
                </td>
              </tr>
            )}
            {filtered.map((voucher) => (
              <tr key={voucher.id}>
                <td className="px-4 py-3 font-mono text-xs text-white/85">{voucher.code}</td>
                <td className="px-4 py-3 text-white/60">{voucher.package?.name ?? "—"}</td>
                <td className="px-4 py-3">
                  <StatusPill status={voucher.status} />
                </td>
                <td className="px-4 py-3 text-xs text-white/45">{voucher.expires_at ? formatDate(voucher.expires_at) : "—"}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      disabled={acting === voucher.id || voucher.status === "revoked"}
                      onClick={() => provision(voucher)}
                      className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/70 hover:border-brand/40 hover:text-brand disabled:opacity-40"
                    >
                      Push to router
                    </button>
                    <button
                      type="button"
                      disabled={acting === voucher.id || voucher.status === "revoked"}
                      onClick={() => revoke(voucher)}
                      className="rounded-lg border border-red-500/25 px-3 py-1.5 text-xs text-red-200 hover:bg-red-500/10 disabled:opacity-40"
                    >
                      Revoke
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
