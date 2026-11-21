import { afterEach, describe, expect, it } from "vitest";
import { RouterOsClient } from "@/lib/mikrotik/client";
import { packageProfileName, packageRateLimit, provisionVoucher, deprovisionVoucher } from "@/lib/provisioning";
import type { PackageRow } from "@/lib/types";
import { FakeRouter } from "./helpers/fake-router";

const pkg: PackageRow = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Siku 1",
  description: null,
  price: 2000,
  currency: "TZS",
  duration_minutes: 1440,
  data_limit_mb: 500,
  speed_limit_down: "3M",
  speed_limit_up: "1M",
  device_limit: 2,
  is_active: true,
  router_profile: null,
  created_at: new Date().toISOString(),
};

let router: FakeRouter | null = null;

afterEach(async () => {
  await router?.stop();
  router = null;
});

describe("package to RouterOS mapping", () => {
  it("derives a stable profile name from the package name", () => {
    expect(packageProfileName(pkg)).toBe("vw-siku-1");
    expect(packageProfileName({ name: "Wiki 1 (Premium)", router_profile: null })).toBe("vw-wiki-1-premium");
    expect(packageProfileName({ name: "Saa 1", router_profile: "custom-profile" })).toBe("custom-profile");
  });

  it("builds the RouterOS rate limit as down/up", () => {
    expect(packageRateLimit(pkg)).toBe("3M/1M");
    expect(packageRateLimit({ speed_limit_down: null, speed_limit_up: "1M" })).toBe("1M/1M");
    expect(packageRateLimit({ speed_limit_down: null, speed_limit_up: null })).toBeNull();
  });
});

describe("hotspot provisioning", () => {
  it("creates the profile and the hotspot user with the right limits", async () => {
    router = new FakeRouter({ mode: "plain" });
    const port = await router.start();
    const client = new RouterOsClient({ host: "127.0.0.1", port, username: "admin", password: "secret" });
    await client.connect();
    await client.login();

    const result = await provisionVoucher(client, {
      voucher: { code: "ABCD2345", expires_at: null },
      pkg,
    });

    expect(result.ok).toBe(true);
    expect(result.created).toBe(true);
    expect(result.profile).toBe("vw-siku-1");

    const profileAdd = router.received.find((words) => words[0] === "/ip/hotspot/user/profile" && words[1] === "add");
    expect(profileAdd).toContain("=name=vw-siku-1");
    expect(profileAdd).toContain("=rate-limit=3M/1M");
    expect(profileAdd).toContain("=shared-users=2");

    const user = router.createdUsers.find((entry) => entry.name === "ABCD2345");
    expect(user).toMatchObject({ profile: "vw-siku-1", "limit-uptime": "24h" });

    const userAdd = router.received.find((words) => words[0] === "/ip/hotspot/user" && words[1] === "add");
    expect(userAdd).toContain("=limit-bytes-total=524288000");
    expect(userAdd).toContain("=password=ABCD2345");

    client.close();
  });

  it("reuses an existing hotspot user instead of duplicating it", async () => {
    router = new FakeRouter({
      mode: "plain",
      hotspotUsers: [{ name: "ABCD2345", password: "ABCD2345", profile: "vw-siku-1" }],
    });
    const port = await router.start();
    const client = new RouterOsClient({ host: "127.0.0.1", port, username: "admin", password: "secret" });
    await client.connect();
    await client.login();

    const result = await provisionVoucher(client, { voucher: { code: "ABCD2345", expires_at: null }, pkg });
    expect(result.ok).toBe(true);
    expect(result.created).toBe(false);
    expect(router.received.some((words) => words[0] === "/ip/hotspot/user" && words[1] === "add")).toBe(false);

    client.close();
  });

  it("reports provisioning failures instead of throwing", async () => {
    router = new FakeRouter({ mode: "plain", failOn: "/ip/hotspot/user/add" });
    const port = await router.start();
    const client = new RouterOsClient({ host: "127.0.0.1", port, username: "admin", password: "secret" });
    await client.connect();
    await client.login();

    const result = await provisionVoucher(client, { voucher: { code: "ZZZZ9999", expires_at: null }, pkg });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("failure for testing");

    client.close();
  });

  it("removes the user and disconnects active sessions", async () => {
    router = new FakeRouter({ mode: "plain" });
    const port = await router.start();
    const client = new RouterOsClient({ host: "127.0.0.1", port, username: "admin", password: "secret" });
    await client.connect();
    await client.login();
    await provisionVoucher(client, { voucher: { code: "REMOVE12", expires_at: null }, pkg });

    const cleanup = await deprovisionVoucher(client, "REMOVE12");
    expect(cleanup.removed).toBe(true);
    expect(cleanup.disconnected).toBe(0);

    client.close();
  });
});
