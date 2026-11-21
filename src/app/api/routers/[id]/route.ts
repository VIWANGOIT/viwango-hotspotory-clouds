import { requireAdmin } from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";
import { handle, HttpError, ok, parseJson } from "@/lib/http";
import { publicRouter } from "@/lib/routers/present";
import { checkRouter } from "@/lib/routers/service";
import { createAdminClient } from "@/lib/supabase/admin";
import type { RouterRow } from "@/lib/types";
import { routerUpdateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const maxDuration = 60;

type Context = { params: Promise<{ id: string }> };

const CONNECTION_FIELDS = ["host", "api_port", "use_tls", "tls_verify", "username", "password"] as const;

export async function GET(_request: Request, context: Context) {
  return handle(async () => {
    await requireAdmin();
    const { id } = await context.params;
    const admin = createAdminClient();
    const { data, error } = await admin.from("routers").select("*").eq("id", id).maybeSingle();
    if (error) throw new HttpError(500, error.message);
    if (!data) throw new HttpError(404, "Router not found");
    return ok(publicRouter(data as RouterRow));
  });
}

export async function PATCH(request: Request, context: Context) {
  return handle(async () => {
    await requireAdmin();
    const { id } = await context.params;
    const input = await parseJson(request, routerUpdateSchema);
    const admin = createAdminClient();

    const patch: Record<string, unknown> = {};
    for (const key of ["name", "host", "api_port", "use_tls", "tls_verify", "username", "hotspot_server", "hotspot_login_url"] as const) {
      if (input[key] !== undefined) patch[key] = input[key];
    }
    if (input.password) patch.password_enc = encryptSecret(input.password);
    if (Object.keys(patch).length === 0) throw new HttpError(400, "Nothing to update");

    const { data, error } = await admin.from("routers").update(patch).eq("id", id).select("*").single();
    if (error) {
      if (error.code === "23505") throw new HttpError(409, "A router with that name or endpoint already exists");
      throw new HttpError(500, error.message);
    }

    const router = data as RouterRow;
    const connectionChanged = CONNECTION_FIELDS.some((field) => input[field] !== undefined);

    if (connectionChanged) {
      const { result, router: checked } = await checkRouter(router, {
        expectedHotspotServer: router.hotspot_server,
      });
      return ok({ router: publicRouter(checked ?? router), acceptance: result });
    }

    return ok({ router: publicRouter(router) });
  });
}

export async function DELETE(_request: Request, context: Context) {
  return handle(async () => {
    await requireAdmin();
    const { id } = await context.params;
    const admin = createAdminClient();
    const { error } = await admin.from("routers").delete().eq("id", id);
    if (error) throw new HttpError(500, error.message);
    return ok({ deleted: true });
  });
}
