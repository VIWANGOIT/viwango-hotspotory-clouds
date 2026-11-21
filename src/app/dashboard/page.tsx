import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatMoney, formatRelative } from "@/lib/format";
import { StatusPill } from "@/components/StatusPill";
import type { RouterRow } from "@/lib/types";

export const dynamic = "force-dynamic";

function startOfToday(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
}

export default async function OverviewPage() {
  const admin = createAdminClient();
  const dayStart = startOfToday();

  const [routersRes, onlineRes, unusedRes, activeRes, paidRes, eventsRes, vouchersRes] = await Promise.all([
    admin.from("routers").select("*"),
    admin.from("routers").select("id", { count: "exact", head: true }).eq("status", "online"),
    admin.from("vouchers").select("id", { count: "exact", head: true }).eq("status", "unused"),
    admin.from("vouchers").select("id", { count: "exact", head: true }).eq("status", "active"),
    admin.from("payments").select("amount").eq("status", "paid").gte("created_at", dayStart),
    admin
      .from("router_events")
      .select("id, level, code, message, created_at, router:routers(name)")
      .order("created_at", { ascending: false })
      .limit(8),
    admin
      .from("vouchers")
      .select("id, code, status, created_at, package:packages(name)")
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  const routers = (routersRes.data ?? []) as RouterRow[];
  const todayRevenue = (paidRes.data ?? []).reduce((total, row) => total + Number(row.amount ?? 0), 0);
  const legacyRouters = routers.filter((router) => router.auth_mode === "legacy-md5").length;

  const stats = [
    { label: "Routers online", value: `${onlineRes.count ?? 0}/${routers.length}`, hint: "cloud can log in right now" },
    { label: "Unused vouchers", value: String(unusedRes.count ?? 0), hint: "ready to sell" },
    { label: "Active vouchers", value: String(activeRes.count ?? 0), hint: "inside their window" },
    { label: "Revenue today", value: formatMoney(todayRevenue), hint: "paid M-Pesa" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-white">Overview</h1>
        <p className="mt-1 text-sm text-white/50">
          {routers.length === 0
            ? "Start by adding a MikroTik router. The cloud will test the API handshake before saving it as online."
            : `${routers.length} router${routers.length === 1 ? "" : "s"} under management · ${legacyRouters} on the legacy MD5 handshake.`}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="card p-5">
            <p className="text-[11px] uppercase tracking-wider text-white/35">{stat.label}</p>
            <p className="mt-2 font-display text-2xl font-semibold text-white">{stat.value}</p>
            <p className="mt-1 text-xs text-white/35">{stat.hint}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-base font-semibold text-white">Router health</h2>
            <Link href="/dashboard/routers" className="text-xs text-brand hover:underline">
              Manage
            </Link>
          </div>
          <ul className="space-y-2">
            {routers.length === 0 && <li className="text-sm text-white/40">No routers yet.</li>}
            {routers.slice(0, 5).map((router) => (
              <li key={router.id} className="flex items-center justify-between gap-3 rounded-lg border border-white/8 bg-black/20 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm text-white/85">{router.name}</p>
                  <p className="text-xs text-white/35">
                    {router.identity || router.host} · seen {formatRelative(router.last_seen_at)}
                  </p>
                </div>
                <StatusPill status={router.status} />
              </li>
            ))}
          </ul>
        </section>

        <section className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-base font-semibold text-white">Latest router events</h2>
            <Link href="/dashboard/routers" className="text-xs text-brand hover:underline">
              Details
            </Link>
          </div>
          <ul className="space-y-2">
            {(eventsRes.data ?? []).length === 0 && <li className="text-sm text-white/40">No events recorded yet.</li>}
            {(eventsRes.data ?? []).map((event: Record<string, unknown>) => {
              const router = event.router as { name?: string } | null;
              return (
                <li key={String(event.id)} className="rounded-lg border border-white/8 bg-black/20 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <StatusPill status={event.level === "error" ? "fail" : event.level === "warn" ? "warn" : "pass"} label={String(event.code)} />
                    <span className="text-xs text-white/35">{router?.name ?? "router"}</span>
                    <span className="ml-auto text-xs text-white/30">{formatRelative(String(event.created_at))}</span>
                  </div>
                  <p className="mt-1 truncate text-xs text-white/55">{String(event.message)}</p>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <section className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-base font-semibold text-white">Newest vouchers</h2>
          <Link href="/dashboard/vouchers" className="text-xs text-brand hover:underline">
            All vouchers
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wider text-white/35">
              <tr>
                <th className="py-2">Code</th>
                <th className="py-2">Package</th>
                <th className="py-2">Status</th>
                <th className="py-2">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {(vouchersRes.data ?? []).length === 0 && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-white/40">
                    No vouchers yet.
                  </td>
                </tr>
              )}
              {(vouchersRes.data ?? []).map((voucher: Record<string, unknown>) => {
                const pkg = voucher.package as { name?: string } | null;
                return (
                  <tr key={String(voucher.id)}>
                    <td className="py-2 font-mono text-xs text-white/80">{String(voucher.code)}</td>
                    <td className="py-2 text-white/60">{pkg?.name ?? "—"}</td>
                    <td className="py-2">
                      <StatusPill status={String(voucher.status)} />
                    </td>
                    <td className="py-2 text-xs text-white/40">{formatRelative(String(voucher.created_at))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
