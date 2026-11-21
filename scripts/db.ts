import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export function loadLocalEnv(cwd = process.cwd()): void {
  for (const file of [".env.local", ".env"]) {
    const full = path.join(cwd, file);
    if (!existsSync(full)) continue;
    for (const line of readFileSync(full, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separator = trimmed.indexOf("=");
      if (separator === -1) continue;
      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
      if (!(key in process.env)) process.env[key] = value;
    }
  }
}

export function requireDbTarget(): { ref: string; token: string } {
  const ref = process.env.SUPABASE_PROJECT_REF?.trim();
  const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  if (!ref || !token) {
    throw new Error(
      "Set SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN (a Supabase personal access token) to run migrations.",
    );
  }
  return { ref, token };
}

/** Runs SQL through the Supabase Management API using the access token. */
export async function runSql(ref: string, token: string, sql: string): Promise<unknown> {
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`SQL failed (${response.status}): ${body.slice(0, 2000)}`);
  }
  return response.json().catch(() => null);
}
