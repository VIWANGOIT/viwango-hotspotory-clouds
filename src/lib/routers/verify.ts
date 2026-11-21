import type { RouterOsClient } from "@/lib/mikrotik/client";
import type { RouterOsAuthMode } from "@/lib/mikrotik/client";
import {
  readApiServices,
  readClockSkewSeconds,
  readHotspotServers,
  readSystemInfo,
  type HotspotServerInfo,
  type RouterSystemInfo,
} from "@/lib/mikrotik/hotspot";
import { describeRouterError } from "./credentials";
import type { RouterHealth } from "@/lib/types";

export type StepStatus = "pass" | "warn" | "fail" | "skip";

export interface AcceptanceStep {
  id: string;
  label: string;
  status: StepStatus;
  detail?: string;
}

export interface RouterAcceptance {
  accepted: boolean;
  authMode: RouterOsAuthMode | null;
  latencyMs: number;
  steps: AcceptanceStep[];
  warnings: string[];
  system: RouterSystemInfo | null;
  hotspotServers: HotspotServerInfo[];
  error: { code: string; message: string; hint?: string } | null;
}

export interface VerifyOptions {
  expectedHotspotServer?: string | null;
  useTls?: boolean;
}

/**
 * Full router acceptance check.
 *
 * "Accepted" means we proved the cloud can log in and read the device. The
 * remaining checks report warnings (license level, hotspot server, API address
 * restrictions, clock skew) because each of them breaks voucher provisioning in
 * a different way and the operator needs to see which one applies.
 */
export async function verifyRouterAcceptance(
  client: RouterOsClient,
  options: VerifyOptions = {},
): Promise<RouterAcceptance> {
  const steps: AcceptanceStep[] = [];
  const warnings: string[] = [];
  const startedAt = Date.now();
  let latencyMs = 0;
  let authMode: RouterOsAuthMode | null = null;
  let system: RouterSystemInfo | null = null;
  let hotspotServers: HotspotServerInfo[] = [];

  try {
    await client.connect();
    latencyMs = Date.now() - startedAt;
    steps.push({ id: "tcp", label: "TCP connection", status: "pass", detail: `Connected in ${latencyMs}ms` });
  } catch (error) {
    const described = describeRouterError(error);
    steps.push({ id: "tcp", label: "TCP connection", status: "fail", detail: described.message });
    return { accepted: false, authMode, latencyMs, steps, warnings, system, hotspotServers, error: described };
  }

  try {
    const result = await client.login();
    authMode = result.mode;
    steps.push({
      id: "auth",
      label: "API login handshake",
      status: "pass",
      detail:
        result.mode === "plain"
          ? "RouterOS 6.43+ plain login accepted"
          : "Legacy MD5 challenge accepted (RouterOS < 6.43)",
    });
  } catch (error) {
    const described = describeRouterError(error);
    steps.push({ id: "auth", label: "API login handshake", status: "fail", detail: described.message });
    return { accepted: false, authMode, latencyMs, steps, warnings, system, hotspotServers, error: described };
  }

  try {
    system = await readSystemInfo(client);
    const parts = [system.identity, system.boardName, system.version].filter(Boolean);
    steps.push({
      id: "identity",
      label: "Device identity",
      status: "pass",
      detail: parts.length > 0 ? parts.join(" / ") : "Router replied without identity fields",
    });
  } catch (error) {
    const described = describeRouterError(error);
    steps.push({ id: "identity", label: "Device identity", status: "warn", detail: described.message });
    warnings.push("Could not read /system/identity and /system/resource.");
  }

  if (system?.licenseLevel == null) {
    steps.push({
      id: "license",
      label: "License level",
      status: "skip",
      detail: "License level is not reported (CHR or RouterOS 7)",
    });
  } else if (system.licenseLevel >= 4) {
    steps.push({ id: "license", label: "License level", status: "pass", detail: `Level ${system.licenseLevel}` });
  } else {
    const detail = `Level ${system.licenseLevel}: hotspot requires level 4 or higher`;
    steps.push({ id: "license", label: "License level", status: "warn", detail });
    warnings.push(detail);
  }

  try {
    hotspotServers = await readHotspotServers(client);
    const enabled = hotspotServers.filter((server) => !server.disabled);
    const expected = options.expectedHotspotServer?.trim();

    if (enabled.length === 0) {
      const detail = "No enabled hotspot server on /ip/hotspot";
      steps.push({ id: "hotspot", label: "Hotspot server", status: "warn", detail });
      warnings.push(detail);
    } else if (expected && !enabled.some((server) => server.name === expected)) {
      const detail = `Expected hotspot server "${expected}" not found (found: ${enabled.map((s) => s.name).join(", ")})`;
      steps.push({ id: "hotspot", label: "Hotspot server", status: "warn", detail });
      warnings.push(detail);
    } else {
      steps.push({
        id: "hotspot",
        label: "Hotspot server",
        status: "pass",
        detail: enabled.map((server) => `${server.name} (${server.interface})`).join(", "),
      });
    }
  } catch (error) {
    const described = describeRouterError(error);
    steps.push({ id: "hotspot", label: "Hotspot server", status: "skip", detail: described.message });
  }

  try {
    const services = await readApiServices(client);
    const wanted = options.useTls ? "api-ssl" : "api";
    const service = services.find((entry) => entry.name === wanted);

    if (!service) {
      const detail = `/${wanted} service is not listed on /ip service`;
      steps.push({ id: "api-service", label: "API service", status: "warn", detail });
      warnings.push(detail);
    } else if (service.disabled) {
      const detail = `/${wanted} is disabled on the router`;
      steps.push({ id: "api-service", label: "API service", status: "warn", detail });
      warnings.push(detail);
    } else if (service.address && service.address !== "0.0.0.0/0" && service.address !== "::/0") {
      const detail = `/${wanted} is restricted to ${service.address}; allow the cloud egress IP`;
      steps.push({ id: "api-service", label: "API service", status: "warn", detail });
      warnings.push(detail);
    } else {
      steps.push({
        id: "api-service",
        label: "API service",
        status: "pass",
        detail: `/${wanted} enabled on port ${service.port || "default"}`,
      });
    }
  } catch (error) {
    const described = describeRouterError(error);
    steps.push({ id: "api-service", label: "API service", status: "skip", detail: described.message });
  }

  const skew = await readClockSkewSeconds(client).catch(() => null);
  if (skew == null) {
    steps.push({ id: "clock", label: "Clock", status: "skip", detail: "Clock could not be read" });
  } else if (Math.abs(skew) > 300) {
    const detail = `Router clock differs by ${Math.abs(skew)}s; enable NTP (/system ntp client)`;
    steps.push({ id: "clock", label: "Clock", status: "warn", detail });
    warnings.push(detail);
  } else {
    steps.push({ id: "clock", label: "Clock", status: "pass", detail: `${skew}s difference` });
  }

  return {
    accepted: true,
    authMode,
    latencyMs,
    steps,
    warnings,
    system,
    hotspotServers,
    error: null,
  };
}

export function toHealth(result: RouterAcceptance): RouterHealth {
  return {
    checked_at: new Date().toISOString(),
    latency_ms: result.latencyMs,
    auth_mode: result.authMode ?? "plain",
    warnings: result.warnings,
    steps: result.steps,
  };
}
