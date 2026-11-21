const styles: Record<string, string> = {
  online: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
  active: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
  paid: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
  pass: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
  offline: "border-red-400/30 bg-red-400/10 text-red-200",
  rejected: "border-red-400/30 bg-red-400/10 text-red-200",
  fail: "border-red-400/30 bg-red-400/10 text-red-200",
  revoked: "border-red-400/30 bg-red-400/10 text-red-200",
  failed: "border-red-400/30 bg-red-400/10 text-red-200",
  pending: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  unused: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  warn: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  used: "border-white/15 bg-white/5 text-white/60",
  expired: "border-white/15 bg-white/5 text-white/50",
  closed: "border-white/15 bg-white/5 text-white/50",
  skip: "border-white/15 bg-white/5 text-white/45",
};

export function StatusPill({ status, label }: { status: string; label?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium capitalize ${
        styles[status] ?? "border-white/15 bg-white/5 text-white/60"
      }`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
      {label ?? status}
    </span>
  );
}
