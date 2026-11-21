import { afterEach, describe, expect, it } from "vitest";
import { RouterOsClient } from "@/lib/mikrotik/client";
import { verifyRouterAcceptance } from "@/lib/routers/verify";
import { FakeRouter, type FakeRouterOptions } from "./helpers/fake-router";

let routers: FakeRouter[] = [];

async function setup(options: FakeRouterOptions, password = "secret") {
  const router = new FakeRouter(options);
  routers.push(router);
  const port = await router.start();
  const client = new RouterOsClient({
    host: "127.0.0.1",
    port,
    username: "admin",
    password,
    connectTimeoutMs: 2000,
    replyTimeoutMs: 2000,
  });
  return { router, client };
}

afterEach(async () => {
  await Promise.all(routers.map((router) => router.stop()));
  routers = [];
});

describe("router acceptance", () => {
  it("accepts a RouterOS 6.43+ router and records the handshake", async () => {
    const { client } = await setup({ mode: "plain" });
    const result = await verifyRouterAcceptance(client);

    expect(result.accepted).toBe(true);
    expect(result.authMode).toBe("plain");
    expect(result.error).toBeNull();
    expect(result.system?.identity).toBe("VIWANGO-Test");
    expect(result.system?.licenseLevel).toBe(4);
    expect(result.hotspotServers.map((server) => server.name)).toEqual(["hotspot1"]);

    const steps = Object.fromEntries(result.steps.map((step) => [step.id, step.status]));
    expect(steps).toMatchObject({
      tcp: "pass",
      auth: "pass",
      identity: "pass",
      license: "pass",
      hotspot: "pass",
      "api-service": "pass",
      clock: "pass",
    });
    expect(result.warnings).toEqual([]);
    client.close();
  });

  it("accepts a legacy router through the MD5 challenge", async () => {
    const { client } = await setup({ mode: "legacy" });
    const result = await verifyRouterAcceptance(client);

    expect(result.accepted).toBe(true);
    expect(result.authMode).toBe("legacy-md5");
    client.close();
  });

  it("rejects bad credentials without pretending the router is online", async () => {
    const { client } = await setup({ mode: "plain" }, "wrong-password");
    const result = await verifyRouterAcceptance(client);

    expect(result.accepted).toBe(false);
    expect(result.error?.code).toBe("ROUTER_AUTH_FAILED");
    const steps = Object.fromEntries(result.steps.map((step) => [step.id, step.status]));
    expect(steps.tcp).toBe("pass");
    expect(steps.auth).toBe("fail");
    expect(result.steps.some((step) => step.id === "identity")).toBe(false);
    client.close();
  });

  it("warns when the api service is restricted to another network", async () => {
    const { client } = await setup({ mode: "plain", apiAddress: "203.0.113.0/24" });
    const result = await verifyRouterAcceptance(client);

    expect(result.accepted).toBe(true);
    const apiStep = result.steps.find((step) => step.id === "api-service");
    expect(apiStep?.status).toBe("warn");
    expect(result.warnings.join(" ")).toContain("203.0.113.0/24");
    client.close();
  });

  it("warns when the expected hotspot server is missing", async () => {
    const { client } = await setup({ mode: "plain" });
    const result = await verifyRouterAcceptance(client, { expectedHotspotServer: "hotspot-9" });

    expect(result.accepted).toBe(true);
    expect(result.steps.find((step) => step.id === "hotspot")?.status).toBe("warn");
    expect(result.warnings.join(" ")).toContain("hotspot-9");
    client.close();
  });
});
