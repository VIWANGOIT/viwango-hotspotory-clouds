import { createAdminClient } from "@/lib/supabase/admin";
import { VoucherManager } from "@/components/VoucherManager";
import type { PackageRow, RouterRow, VoucherWithPackage } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function VouchersPage() {
  const admin = createAdminClient();
  const [vouchersRes, packagesRes, routersRes] = await Promise.all([
    admin
      .from("vouchers")
      .select("*, package:packages(id,name,duration_minutes,price,currency,speed_limit_down,speed_limit_up,data_limit_mb,device_limit)")
      .order("created_at", { ascending: false })
      .limit(200),
    admin.from("packages").select("*").eq("is_active", true).order("price", { ascending: true }),
    admin.from("routers").select("id, name, status").order("name", { ascending: true }),
  ]);

  return (
    <VoucherManager
      vouchers={(vouchersRes.data ?? []) as VoucherWithPackage[]}
      packages={(packagesRes.data ?? []) as PackageRow[]}
      routers={(routersRes.data ?? []) as Array<Pick<RouterRow, "id" | "name" | "status">>}
    />
  );
}
