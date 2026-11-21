import { requireAdmin } from "@/lib/auth";
import { handle, HttpError, ok } from "@/lib/http";
import { publicRouter } from "@/lib/routers/present";
import { checkRouterById } from "@/lib/routers/service";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await requireAdmin();
    const { id } = await context.params;
    const { result, router } = await checkRouterById(id, { timeoutMs: 10000 });
    if (!router) throw new HttpError(500, "Router health could not be saved");
    return ok({ acceptance: result, router: publicRouter(router) });
  });
}
