import { handle, ok, requireCronSecret } from "@/lib/http";
import { heartbeatAllRouters } from "@/lib/routers/service";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  return handle(async () => {
    requireCronSecret(request);
    const url = new URL(request.url);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 25) || 25, 50);
    const summary = await heartbeatAllRouters(limit);
    return ok(summary);
  });
}
