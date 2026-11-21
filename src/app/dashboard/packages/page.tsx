import { createAdminClient } from "@/lib/supabase/admin";
import { PackageManager } from "@/components/PackageManager";
import type { PackageRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function PackagesPage() {
  const admin = createAdminClient();
  const { data } = await admin.from("packages").select("*").order("price", { ascending: true });
  return <PackageManager packages={(data ?? []) as PackageRow[]} />;
}
