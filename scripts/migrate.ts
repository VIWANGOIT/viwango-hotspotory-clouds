import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { loadLocalEnv, requireDbTarget, runSql } from "./db";

async function main() {
  loadLocalEnv();
  const { ref, token } = requireDbTarget();
  const dir = path.join(process.cwd(), "supabase", "migrations");
  const files = readdirSync(dir).filter((file) => file.endsWith(".sql")).sort();

  await runSql(
    ref,
    token,
    `create table if not exists public._migrations (
       name text primary key,
       applied_at timestamptz not null default now()
     );`,
  );

  const appliedRows = (await runSql(ref, token, "select name from public._migrations;")) as Array<{ name: string }>;
  const applied = new Set((appliedRows ?? []).map((row) => row.name));

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`skip  ${file}`);
      continue;
    }
    const sql = readFileSync(path.join(dir, file), "utf8");
    process.stdout.write(`apply ${file} ... `);
    await runSql(ref, token, sql);
    await runSql(ref, token, `insert into public._migrations (name) values ('${file}') on conflict do nothing;`);
    console.log("ok");
  }

  console.log("Migrations complete.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
