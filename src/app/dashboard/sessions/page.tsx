import { createAdminClient } from "@/lib/supabase/admin";
import { formatDate, formatRelative } from "@/lib/format";
import { StatusPill } from "@/components/StatusPill";

export const dynamic = "force-dynamic";

function formatBytes(value: number): string {
  if (!value) return "0 MB";
  const mb = value / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

export default async function SessionsPage() {
  const admin = createAdminClient();
  const { data } = await admin
    .from("sessions")
    .select("*, voucher:vouchers(code), router:routers(name)")
    .order("started_at", { ascending: false })
    .limit(100);

  const sessions = (data ?? []) as Array<Record<string, unknown>>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-white">Sessions</h1>
        <p className="mt-1 text-sm text-white/50">
          Live and recent hotspot sessions. Use “Sync live sessions” on a router to refresh this list from the device.
        </p>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-white/8 bg-white/[0.03] text-xs uppercase tracking-wider text-white/40">
            <tr>
              <th className="px-4 py-3">Voucher</th>
              <th className="px-4 py-3">Router</th>
              <th className="px-4 py-3">Client</th>
              <th className="px-4 py-3">Usage</th>
              <th className="px-4 py-3">Started</th>
              <th className="px-4 py-3">State</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {sessions.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-white/40">
                  No sessions recorded yet.
                </td>
              </tr>
            )}
            {sessions.map((session) => {
              const voucher = session.voucher as { code?: string } | null;
              const router = session.router as { name?: string } | null;
              return (
                <tr key={String(session.id)}>
                  <td className="px-4 py-3 font-mono text-xs text-white/85">{voucher?.code ?? "—"}</td>
                  <td className="px-4 py-3 text-white/60">{router?.name ?? "—"}</td>
                  <td className="px-4 py-3 text-xs text-white/45">
                    {String(session.ip_address ?? "—")}
                    {session.mac_address ? ` · ${String(session.mac_address)}` : ""}
                  </td>
                  <td className="px-4 py-3 text-xs text-white/55">
                    ↓ {formatBytes(Number(session.bytes_in ?? 0))} · ↑ {formatBytes(Number(session.bytes_out ?? 0))}
                  </td>
                  <td className="px-4 py-3 text-xs text-white/40">
                    {formatRelative(String(session.started_at))}
                    <span className="ml-2 text-white/25">{formatDate(String(session.started_at))}</span>
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={String(session.status)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
