import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/lib/env";

let adminClient: SupabaseClient | null = null;

/** Service-role client. Server only: it bypasses row level security. */
export function createAdminClient(): SupabaseClient {
  if (adminClient) return adminClient;
  const env = getServerEnv();
  adminClient = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { "X-Client-Info": "viwango-hotspot-cloud/admin" } },
  });
  return adminClient;
}
