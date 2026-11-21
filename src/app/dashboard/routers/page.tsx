import { createAdminClient } from "@/lib/supabase/admin";
import { publicRouter } from "@/lib/routers/present";
import { RoutersPanel } from "@/components/RoutersPanel";
import type { RouterRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function RoutersPage() {
  const admin = createAdminClient();
  const { data } = await admin.from("routers").select("*").order("created_at", { ascending: false });
  const routers = ((data ?? []) as RouterRow[]).map(publicRouter);

  return <RoutersPanel routers={routers} />;
}
