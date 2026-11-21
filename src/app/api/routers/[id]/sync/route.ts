import { requireAdmin } from "@/lib/auth";
import { handle, HttpError, ok } from "@/lib/http";
import { syncActiveSessions } from "@/lib/routers/service";
import { createAdminClient } from "@/lib/supabase/admin";
import type { RouterRow } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await requireAdmin();
    const { id } = await context.params;
    const admin = createAdminClient();
    const { data, error } = await admin.from("routers").select("*").eq("id", id).maybeSingle();
    if (error) throw new HttpError(500, error.message);
    if (!data) throw new HttpError(404, "Router not found");

    const summary = await syncActiveSessions(data as RouterRow);
    return ok(summary);
  });
}
