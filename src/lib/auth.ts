import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { HttpError } from "@/lib/http";

export interface AdminUser {
  id: string;
  email: string;
  role: string;
}

/**
 * Every mutating route goes through this. Being signed in is not enough: the
 * user id must exist in `admin_users`, which RLS also relies on.
 */
export async function requireAdmin(): Promise<AdminUser> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new HttpError(401, "Sign in to continue");
  }

  const admin = createAdminClient();
  const { data: membership, error: membershipError } = await admin
    .from("admin_users")
    .select("user_id, role, email")
    .eq("user_id", data.user.id)
    .maybeSingle();

  if (membershipError) throw new HttpError(500, membershipError.message);
  if (!membership) throw new HttpError(403, "This account is not a VIWANGO administrator");

  return {
    id: data.user.id,
    email: membership.email ?? data.user.email ?? "",
    role: membership.role ?? "admin",
  };
}

export async function getAdminSession(): Promise<AdminUser | null> {
  try {
    return await requireAdmin();
  } catch {
    return null;
  }
}
