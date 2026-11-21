import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth";
import { DashboardNav } from "@/components/DashboardNav";
import { SignOutButton } from "@/components/SignOutButton";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const admin = await getAdminSession();
  if (!admin) redirect("/login");

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col lg:flex-row">
      <aside className="border-b border-white/8 px-5 py-5 lg:w-64 lg:border-r lg:border-b-0">
        <Link href="/dashboard" className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand text-base font-bold text-ink">V</span>
          <div>
            <p className="font-display text-xs font-semibold tracking-[0.2em] text-white/80">VIWANGO</p>
            <p className="text-[11px] text-white/40">Hotspot Cloud</p>
          </div>
        </Link>
        <div className="mt-6">
          <DashboardNav />
        </div>
        <div className="mt-6 hidden rounded-xl border border-white/8 bg-white/[0.03] p-3 lg:block">
          <p className="text-[11px] uppercase tracking-wider text-white/35">Signed in</p>
          <p className="mt-1 truncate text-xs text-white/70">{admin.email}</p>
          <p className="text-[11px] text-white/35">{admin.role}</p>
          <div className="mt-3">
            <SignOutButton />
          </div>
        </div>
      </aside>

      <div className="flex-1 px-5 py-6 lg:px-8">
        <div className="mb-4 flex items-center justify-between lg:hidden">
          <p className="truncate text-xs text-white/50">{admin.email}</p>
          <SignOutButton />
        </div>
        {children}
      </div>
    </div>
  );
}
