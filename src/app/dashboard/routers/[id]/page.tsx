import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicRouter } from "@/lib/routers/present";
import { RouterDetailPanel } from "@/components/RouterDetailPanel";
import type { RouterEventRow, RouterRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function RouterDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = createAdminClient();

  const [{ data: routerRow }, { data: events }] = await Promise.all([
    admin.from("routers").select("*").eq("id", id).maybeSingle(),
    admin.from("router_events").select("*").eq("router_id", id).order("created_at", { ascending: false }).limit(25),
  ]);

  if (!routerRow) notFound();

  return (
    <RouterDetailPanel
      router={publicRouter(routerRow as RouterRow)}
      events={(events ?? []) as RouterEventRow[]}
    />
  );
}
