import { requireAdmin } from "@/lib/auth";
import { handle, HttpError, ok, parseJson } from "@/lib/http";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PackageRow } from "@/lib/types";
import { packageUpdateSchema } from "@/lib/validation";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  return handle(async () => {
    await requireAdmin();
    const { id } = await context.params;
    const input = await parseJson(request, packageUpdateSchema);
    if (Object.keys(input).length === 0) throw new HttpError(400, "Nothing to update");

    const admin = createAdminClient();
    const { data, error } = await admin.from("packages").update(input).eq("id", id).select("*").single();
    if (error) {
      if (error.code === "23505") throw new HttpError(409, "A package with that name already exists");
      throw new HttpError(500, error.message);
    }
    return ok(data as PackageRow);
  });
}

export async function DELETE(_request: Request, context: Context) {
  return handle(async () => {
    await requireAdmin();
    const { id } = await context.params;
    const admin = createAdminClient();

    const { count } = await admin
      .from("vouchers")
      .select("id", { count: "exact", head: true })
      .eq("package_id", id);
    if ((count ?? 0) > 0) {
      throw new HttpError(409, "This package already has vouchers. Deactivate it instead of deleting it.");
    }

    const { error } = await admin.from("packages").delete().eq("id", id);
    if (error) throw new HttpError(500, error.message);
    return ok({ deleted: true });
  });
}
