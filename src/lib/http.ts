import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";

export class HttpError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.details = details;
  }
}

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ ok: true, data }, { status });
}

export function fail(status: number, message: string, details?: unknown): NextResponse {
  return NextResponse.json({ ok: false, error: message, details }, { status });
}

/** Wraps a route handler so thrown errors become consistent JSON responses. */
export async function handle(run: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof HttpError) {
      return fail(error.status, error.message, error.details);
    }
    if (error instanceof ZodError) {
      return fail(422, "Validation failed", error.issues);
    }
    const message = error instanceof Error ? error.message : "Unexpected server error";
    console.error("[api]", error);
    return fail(500, message);
  }
}

export async function parseJson<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    throw new HttpError(400, "Request body must be valid JSON");
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new HttpError(422, "Validation failed", parsed.error.issues);
  }
  return parsed.data;
}

export function requireCronSecret(request: Request): void {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new HttpError(503, "CRON_SECRET is not configured");
  const header = request.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7) : "";
  if (token !== secret) throw new HttpError(401, "Invalid cron credentials");
}
