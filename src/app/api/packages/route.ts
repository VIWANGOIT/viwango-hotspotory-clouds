import { requireAdmin } from "@/lib/auth";
import { handle, HttpError, ok, parseJson } from "@/lib/http";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PackageRow } from "@/lib/types";
import { packageCreateSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET() {
  return handle(async () => {
    await requireAdmin();
    const admin = createAdminClient();
    const { data, error } = await admin.from("packages").select("*").order("price", { ascending: true });
    if (error) throw new HttpError(500, error.message);
    return ok(data as PackageRow[]);
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    await requireAdmin();
    const input = await parseJson(request, packageCreateSchema);
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("packages")
      .insert({
        ...input,
        description: input.description ?? null,
        data_limit_mb: input.data_limit_mb ?? null,
        speed_limit_down: input.speed_limit_down ?? null,
        speed_limit_up: input.speed_limit_up ?? null,
        router_profile: input.router_profile ?? null,
      })
      .select("*")
      .single();

    if (error) {
      if (error.code === "23505") throw new HttpError(409, "A package with that name already exists");
      throw new HttpError(500, error.message);
    }
    return ok(data as PackageRow, 201);
  });
}
