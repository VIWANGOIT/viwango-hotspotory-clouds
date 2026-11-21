/**
 * Development helper: runs the RouterOS test double so the cloud app can be
 * exercised without a physical MikroTik.
 *
 *   npx tsx scripts/dev-fake-router.ts --port 8728 --mode plain
 *   npx tsx scripts/dev-fake-router.ts --port 8728 --mode legacy
 */
import { FakeRouter } from "../tests/helpers/fake-router";

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

async function main() {
  const mode = arg("mode", "plain") as "plain" | "legacy";
  const port = Number(arg("port", "8728"));
  const username = arg("user", "admin");
  const password = arg("password", "secret");

  const router = new FakeRouter({ mode, username, password });
  const actualPort = await router.start(port);
  if (actualPort !== port) {
    console.warn(`Fake router is listening on ${actualPort} (requested ${port})`);
  }
  console.log(`Fake RouterOS API on 127.0.0.1:${actualPort} (${mode} handshake, user ${username})`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
