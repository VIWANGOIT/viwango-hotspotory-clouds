import { z } from "zod";

const urlString = z.string().refine(
  (value) => {
    try {
      new URL(value);
      return true;
    } catch {
      return false;
    }
  },
  { message: "Must be a valid URL" },
);

const serverEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: urlString,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  ROUTER_CREDENTIALS_KEY: z.string().min(16),
  APP_URL: urlString.optional(),
  CRON_SECRET: z.string().min(16).optional(),
  MPESA_CONSUMER_KEY: z.string().optional(),
  MPESA_CONSUMER_SECRET: z.string().optional(),
  MPESA_SHORTCODE: z.string().optional(),
  MPESA_PASSKEY: z.string().optional(),
  MPESA_CALLBACK_URL: urlString.optional(),
  MPESA_ENVIRONMENT: z.enum(["sandbox", "production"]).optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
  if (cached) return cached;

  const parsed = serverEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    ROUTER_CREDENTIALS_KEY: process.env.ROUTER_CREDENTIALS_KEY,
    APP_URL: process.env.APP_URL,
    CRON_SECRET: process.env.CRON_SECRET,
    MPESA_CONSUMER_KEY: process.env.MPESA_CONSUMER_KEY,
    MPESA_CONSUMER_SECRET: process.env.MPESA_CONSUMER_SECRET,
    MPESA_SHORTCODE: process.env.MPESA_SHORTCODE,
    MPESA_PASSKEY: process.env.MPESA_PASSKEY,
    MPESA_CALLBACK_URL: process.env.MPESA_CALLBACK_URL,
    MPESA_ENVIRONMENT: process.env.MPESA_ENVIRONMENT as "sandbox" | "production" | undefined,
  });

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid server environment: ${issues}`);
  }

  cached = parsed.data;
  return cached;
}

export function isMpesaConfigured(): boolean {
  const env = getServerEnv();
  return Boolean(
    env.MPESA_CONSUMER_KEY &&
      env.MPESA_CONSUMER_SECRET &&
      env.MPESA_SHORTCODE &&
      env.MPESA_PASSKEY &&
      env.MPESA_CALLBACK_URL,
  );
}
