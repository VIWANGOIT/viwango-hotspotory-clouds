import { createAdminClient } from "@/lib/supabase/admin";
import { isMpesaConfigured } from "@/lib/env";
import { PortalClient } from "@/components/PortalClient";
import type { PackageRow, RouterRow } from "@/lib/types";

export const dynamic = "force-dynamic";

interface PortalSettings {
  business_name?: string;
  support_phone?: string;
  tagline?: string;
}

export default async function PortalPage({
  searchParams,
}: {
  searchParams: Promise<{ router?: string }>;
}) {
  const params = await searchParams;
  const routerId = typeof params.router === "string" ? params.router : null;
  const admin = createAdminClient();

  const [settingsRes, packagesRes, routerRes] = await Promise.all([
    admin.from("settings").select("value").eq("key", "portal").maybeSingle(),
    admin.from("packages").select("*").eq("is_active", true).order("price", { ascending: true }),
    routerId ? admin.from("routers").select("id, name").eq("id", routerId).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const settings = (settingsRes.data?.value ?? {}) as PortalSettings;
  let mpesaEnabled = false;
  try {
    mpesaEnabled = isMpesaConfigured();
  } catch {
    mpesaEnabled = false;
  }

  const router = routerRes.data as Pick<RouterRow, "id" | "name"> | null;

  return (
    <main>
      {router && (
        <p className="mx-auto w-full max-w-3xl px-5 pt-6 text-center text-xs text-white/30">Hotspot: {router.name}</p>
      )}
      <PortalClient
        businessName={settings.business_name || "VIWANGO Hotspot"}
        tagline={settings.tagline || "Internet ya haraka, bili rahisi"}
        supportPhone={settings.support_phone || ""}
        packages={((packagesRes.data ?? []) as PackageRow[]).map((pkg) => ({
          id: pkg.id,
          name: pkg.name,
          price: Number(pkg.price),
          currency: pkg.currency,
          duration_minutes: pkg.duration_minutes,
          speed_limit_down: pkg.speed_limit_down,
          speed_limit_up: pkg.speed_limit_up,
        }))}
        routerId={routerId}
        mpesaEnabled={mpesaEnabled}
      />
    </main>
  );
}
