import { requireAdmin } from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";
import { handle, HttpError, ok, parseJson } from "@/lib/http";
import { publicRouter } from "@/lib/routers/present";
import { checkRouter } from "@/lib/routers/service";
import { createAdminClient } from "@/lib/supabase/admin";
import type { RouterRow } from "@/lib/types";
import { routerCreateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  return handle(async () => {
    await requireAdmin();
    const admin = createAdminClient();
    const { data, error } = await admin.from("routers").select("*").order("created_at", { ascending: false });
    if (error) throw new HttpError(500, error.message);
    return ok((data as RouterRow[]).map(publicRouter));
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const adminUser = await requireAdmin();
    const input = await parseJson(request, routerCreateSchema);
    const admin = createAdminClient();

    const { data, error } = await admin
      .from("routers")
      .insert({
        name: input.name,
        host: input.host,
        api_port: input.api_port,
        use_tls: input.use_tls,
        tls_verify: input.tls_verify,
        username: input.username,
        password_enc: encryptSecret(input.password),
        hotspot_server: input.hotspot_server ?? null,
        hotspot_login_url: input.hotspot_login_url || null,
        created_by: adminUser.id,
      })
      .select("*")
      .single();

    if (error) {
      if (error.code === "23505") throw new HttpError(409, "A router with that name or endpoint already exists");
      throw new HttpError(500, error.message);
    }

    const router = data as RouterRow;
    const { result, router: checked } = await checkRouter(router, {
      expectedHotspotServer: router.hotspot_server,
    });

    return ok({ router: publicRouter(checked ?? router), acceptance: result }, 201);
  });
}
