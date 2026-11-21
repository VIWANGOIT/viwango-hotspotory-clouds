import { readFileSync } from "node:fs";
import path from "node:path";
import { loadLocalEnv, requireDbTarget, runSql } from "./db";

async function main() {
  loadLocalEnv();
  const { ref, token } = requireDbTarget();
  const sql = readFileSync(path.join(process.cwd(), "supabase", "seed.sql"), "utf8");
  await runSql(ref, token, sql);
  console.log("Seed complete.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
