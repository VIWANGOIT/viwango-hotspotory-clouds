import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { loadLocalEnv } from "./db";

async function main() {
  loadLocalEnv();
  const [email, passwordArg] = process.argv.slice(2);
  if (!email || !email.includes("@")) {
    console.error("Usage: npm run create-admin -- you@example.com ['strong-password']");
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (see .env.example).");
    process.exit(1);
  }

  const password = passwordArg ?? `${randomBytes(9).toString("base64url")}Aa1!`;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createError || !created.user) {
    console.error(`Could not create the auth user: ${createError?.message ?? "unknown error"}`);
    process.exit(1);
  }

  const { error: adminError } = await admin
    .from("admin_users")
    .upsert({ user_id: created.user.id, email, role: "owner" }, { onConflict: "user_id" });

  if (adminError) {
    console.error(`User created but admin membership failed: ${adminError.message}`);
    process.exit(1);
  }

  console.log("Administrator ready.");
  console.log(`  email:    ${email}`);
  if (!passwordArg) console.log(`  password: ${password}`);
  console.log("Sign in at /login and change the password from Supabase Auth when you can.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
