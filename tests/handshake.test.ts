import { afterEach, describe, expect, it } from "vitest";
import { RouterOsClient } from "@/lib/mikrotik/client";
import { FakeRouter, type FakeRouterOptions } from "./helpers/fake-router";

let routers: FakeRouter[] = [];

async function startRouter(options: FakeRouterOptions) {
  const router = new FakeRouter(options);
  routers.push(router);
  const port = await router.start();
  return { router, port };
}

function clientFor(port: number, overrides: Partial<ConstructorParameters<typeof RouterOsClient>[0]> = {}) {
  return new RouterOsClient({
    host: "127.0.0.1",
    port,
    username: "admin",
    password: "secret",
    connectTimeoutMs: 2000,
    replyTimeoutMs: 2000,
    ...overrides,
  });
}

afterEach(async () => {
  await Promise.all(routers.map((router) => router.stop()));
  routers = [];
});

describe("RouterOS login handshake", () => {
  it("authenticates with plain login on RouterOS 6.43+", async () => {
    const { port } = await startRouter({ mode: "plain" });
    const client = clientFor(port);

    await client.connect();
    const auth = await client.login();
    expect(auth.mode).toBe("plain");

    const rows = await client.print("/system/identity");
    expect(rows[0].name).toBe("VIWANGO-Test");
    client.close();
  });

  it("falls back to the legacy MD5 challenge when the router asks for it", async () => {
    const { router, port } = await startRouter({ mode: "legacy" });
    const client = clientFor(port);

    await client.connect();
    const auth = await client.login();
    expect(auth.mode).toBe("legacy-md5");

    const response = router.received
      .flat()
      .find((word) => word.startsWith("=response="));
    expect(response).toMatch(/^=response=00[0-9a-f]{32}$/);
    client.close();
  });

  it("never sends a challenge response to a plain-login router", async () => {
    const { router, port } = await startRouter({ mode: "plain" });
    const client = clientFor(port);
    await client.connect();
    await client.login();

    const responses = router.received.flat().filter((word) => word.startsWith("=response="));
    expect(responses).toEqual([]);
    client.close();
  });

  it("reports bad credentials from a plain login router", async () => {
    const { port } = await startRouter({ mode: "plain" });
    const client = clientFor(port, { password: "wrong" });
    await client.connect();

    await expect(client.login()).rejects.toMatchObject({ code: "ROUTER_AUTH_FAILED" });
    client.close();
  });

  it("reports bad credentials from a legacy router", async () => {
    const { port } = await startRouter({ mode: "legacy" });
    const client = clientFor(port, { password: "wrong" });
    await client.connect();

    await expect(client.login()).rejects.toMatchObject({ code: "ROUTER_AUTH_FAILED" });
    client.close();
  });

  it("supports forcing the legacy handshake", async () => {
    const { port } = await startRouter({ mode: "legacy" });
    const client = clientFor(port, { legacyAuth: "force" });
    await client.connect();

    const auth = await client.login();
    expect(auth.mode).toBe("legacy-md5");
    client.close();
  });

  it("explains when force is used against a plain-login router", async () => {
    const { port } = await startRouter({ mode: "plain" });
    const client = clientFor(port, { legacyAuth: "force" });
    await client.connect();

    await expect(client.login()).rejects.toMatchObject({ code: "ROUTER_AUTH_FAILED" });
    client.close();
  });

  it("explains when plain-only mode meets a legacy router", async () => {
    const { port } = await startRouter({ mode: "legacy" });
    const client = clientFor(port, { legacyAuth: "never" });
    await client.connect();

    await expect(client.login()).rejects.toMatchObject({ code: "ROUTER_HANDSHAKE_FAILED" });
    client.close();
  });

  it("refuses commands before login", async () => {
    const { port } = await startRouter({ mode: "plain" });
    const client = clientFor(port);
    await client.connect();

    await expect(client.print("/system/identity")).rejects.toMatchObject({ code: "ROUTER_HANDSHAKE_FAILED" });
    client.close();
  });

  it("times out when the router accepts the socket but never replies", async () => {
    const { port } = await startRouter({ mode: "plain", silent: true });
    const client = clientFor(port, { replyTimeoutMs: 300 });
    await client.connect();

    const startedAt = Date.now();
    await expect(client.login()).rejects.toMatchObject({ code: "ROUTER_TIMEOUT" });
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(250);
    client.close();
  });

  it("reports a refused port as unreachable", async () => {
    const { router, port } = await startRouter({ mode: "plain" });
    await router.stop();
    routers = routers.filter((entry) => entry !== router);

    const client = clientFor(port, { connectTimeoutMs: 1000 });
    await expect(client.connect()).rejects.toMatchObject({ code: "ROUTER_UNREACHABLE" });
  });

  it("surfaces router trap messages for failed commands", async () => {
    const { port } = await startRouter({ mode: "plain", failOn: "/ip/hotspot/user/add" });
    const client = clientFor(port);
    await client.connect();
    await client.login();

    await expect(client.add("/ip/hotspot/user", { name: "ABC" })).rejects.toMatchObject({
      code: "ROUTER_COMMAND_FAILED",
      message: "failure for testing",
    });
    client.close();
  });
});
