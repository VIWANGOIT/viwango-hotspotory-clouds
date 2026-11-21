import { RouterOsClient, RouterOsError, type RouterOsClientOptions } from "@/lib/mikrotik/client";
import { decryptSecret } from "@/lib/crypto";
import type { RouterRow } from "@/lib/types";

export function routerClientOptions(
  router: RouterRow,
  overrides: Partial<RouterOsClientOptions> = {},
): RouterOsClientOptions {
  return {
    host: router.host,
    port: router.api_port,
    username: router.username,
    password: decryptSecret(router.password_enc),
    tls: router.use_tls,
    tlsRejectUnauthorized: router.tls_verify,
    tlsServername: router.host,
    legacyAuth: "auto",
    ...overrides,
  };
}

export function newRouterClient(
  router: RouterRow,
  overrides: Partial<RouterOsClientOptions> = {},
): RouterOsClient {
  return new RouterOsClient(routerClientOptions(router, overrides));
}

export function describeRouterError(error: unknown): { code: string; message: string; hint?: string } {
  if (error instanceof RouterOsError) {
    return { code: error.code, message: error.message, hint: error.hint };
  }
  if (error instanceof Error) {
    return { code: "ROUTER_ERROR", message: error.message };
  }
  return { code: "ROUTER_ERROR", message: "Unknown router error" };
}
