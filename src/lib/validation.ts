import { z } from "zod";

const hostSchema = z
  .string()
  .trim()
  .min(3)
  .max(255)
  .refine(
    (value) =>
      /^[a-zA-Z0-9.-]+$/.test(value) ||
      /^[0-9a-fA-F:]+$/.test(value),
    "Use an IP address or hostname (no scheme, no path)",
  );

export const routerCreateSchema = z.object({
  name: z.string().trim().min(2).max(60),
  host: hostSchema,
  api_port: z.coerce.number().int().min(1).max(65535).default(8728),
  use_tls: z.boolean().default(false),
  tls_verify: z.boolean().default(false),
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(200),
  hotspot_server: z.string().trim().max(64).optional().nullable(),
  hotspot_login_url: z
    .string()
    .trim()
    .max(300)
    .refine((value) => value === "" || /^https?:\/\/[^\s]+$/i.test(value), "Use a full http(s) URL")
    .optional()
    .nullable(),
});

export const routerUpdateSchema = routerCreateSchema.partial().extend({
  password: z.string().min(1).max(200).optional(),
});

export const packageCreateSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(300).optional().nullable(),
  price: z.coerce.number().min(0).max(10_000_000),
  currency: z.string().trim().min(2).max(8).default("TZS"),
  duration_minutes: z.coerce.number().int().min(1).max(525_600),
  data_limit_mb: z.coerce.number().int().min(1).nullable().optional(),
  speed_limit_down: z.string().trim().max(20).optional().nullable(),
  speed_limit_up: z.string().trim().max(20).optional().nullable(),
  device_limit: z.coerce.number().int().min(1).max(100).default(1),
  is_active: z.boolean().default(true),
  router_profile: z.string().trim().max(40).optional().nullable(),
});

export const packageUpdateSchema = packageCreateSchema.partial();

export const voucherBatchSchema = z.object({
  package_id: z.string().uuid(),
  count: z.coerce.number().int().min(1).max(500),
  router_id: z.string().uuid().nullable().optional(),
  prefix: z
    .string()
    .trim()
    .max(6)
    .regex(/^[A-Za-z0-9]*$/, "Prefix must be letters or numbers")
    .optional()
    .nullable(),
  length: z.coerce.number().int().min(4).max(16).default(8),
});

export const portalActivateSchema = z.object({
  code: z.string().trim().min(4).max(40),
  router_id: z.string().uuid().nullable().optional(),
  mac: z.string().trim().max(32).optional().nullable(),
  ip: z.string().trim().max(64).optional().nullable(),
});

export const routerSyncSchema = z.object({
  provision: z.boolean().default(true),
});

export const mpesaCallbackSchema = z.object({
  Body: z.object({
    stkCallback: z.object({
      MerchantRequestID: z.string().optional(),
      CheckoutRequestID: z.string().optional(),
      ResultCode: z.number(),
      ResultDesc: z.string().optional(),
      CallbackMetadata: z
        .object({
          Item: z.array(
            z.object({
              Name: z.string(),
              Value: z.union([z.string(), z.number()]).optional(),
            }),
          ),
        })
        .optional(),
    }),
  }),
});

export type RouterCreateInput = z.infer<typeof routerCreateSchema>;
export type PackageCreateInput = z.infer<typeof packageCreateSchema>;
export type VoucherBatchInput = z.infer<typeof voucherBatchSchema>;
