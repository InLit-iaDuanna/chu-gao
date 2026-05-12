import { z } from "zod";

import { SYSTEM_CONFIG_DEFAULT_ROWS } from "@/lib/system-config";

export const loginSchema = z.object({
  email: z.email("邮箱格式不正确"),
  password: z.string().min(8, "密码至少 8 位"),
});

export const registerSchema = loginSchema.extend({
  name: z.string().trim().min(1).max(40).optional(),
  inviteCode: z.string().trim().min(4).max(40).optional(),
});

export const providerSchema = z.object({
  name: z.string().min(1).max(80),
  protocol: z.enum(["OPENAI_IMAGES", "OPENAI_RESPONSES_IMAGE", "GEMINI_IMAGE"]),
  baseUrl: z.url(),
  apiKey: z.string().min(1),
  priority: z.number().int().min(0),
  modelsSupported: z.array(z.string().min(1)).min(1),
  costMultiplier: z.number().positive(),
  note: z.string().max(200).optional(),
});

export const providerAccountSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  baseUrl: z.url(),
  apiKey: z.string().min(1),
  priority: z.number().int().min(0).default(0),
  weight: z.number().int().min(1).max(100).default(1),
  maxConcurrency: z.number().int().min(1).max(100).default(1),
  dailyLimit: z.number().int().min(1).optional(),
  note: z.string().max(200).optional(),
});

export const providerAccountPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(80).nullable().optional(),
    baseUrl: z.url().optional(),
    apiKey: z.string().min(1).optional(),
    priority: z.number().int().min(0).optional(),
    weight: z.number().int().min(1).max(100).optional(),
    maxConcurrency: z.number().int().min(1).max(100).optional(),
    dailyLimit: z.number().int().min(1).nullable().optional(),
    note: z.string().max(200).nullable().optional(),
    isActive: z.boolean().optional(),
    health: z.enum(["HEALTHY", "DEGRADED", "DOWN"]).optional(),
    cooldownUntil: z.string().datetime().nullable().optional(),
    consecutiveErrors: z.number().int().min(0).optional(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "至少提供一个字段");

export const providerAccountImportSchema = z.object({
  mode: z.enum(["csv", "lines"]).default("csv"),
  text: z.string().max(100_000).optional(),
  csvText: z.string().max(100_000).optional(),
  defaultMaxConcurrency: z.number().int().min(1).max(100).default(1),
  defaultWeight: z.number().int().min(1).max(100).default(1),
}).superRefine((value, ctx) => {
  const source = value.mode === "csv" ? value.csvText : value.text;

  if (!source?.trim()) {
    ctx.addIssue({
      code: "custom",
      message: value.mode === "csv" ? "CSV 内容不能为空" : "文本内容不能为空",
      path: [value.mode === "csv" ? "csvText" : "text"],
    });
  }
});

export const providerPatchSchema = providerSchema
  .extend({
    apiKey: z.string().min(1).optional(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "至少提供一个字段");

export const adminUserPatchSchema = z
  .object({
    email: z.email("邮箱格式不正确").optional(),
    name: z.string().trim().min(1).max(40).nullable().optional(),
    role: z.enum(["USER", "ADMIN"]).optional(),
    status: z.enum(["ACTIVE", "BANNED"]).optional(),
    dailyGenLimit: z.number().int().min(1).max(1000).optional(),
    concurrentLimit: z.number().int().min(1).max(20).optional(),
    bannedReason: z.string().trim().max(200).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "至少提供一个字段");

export const adminPasswordResetSchema = z.object({
  password: z.string().min(8, "密码至少 8 位").max(200),
});

export const adminRevokeSessionsSchema = z.object({
  reason: z.string().trim().max(200).optional(),
});

export const adminArchiveConversationsSchema = z.object({
  mode: z.enum(["all", "inactive"]),
});

export const adminDeleteGenerationsSchema = z.object({
  mode: z.enum(["all", "failed", "beforeDate"]),
  beforeDate: z.string().datetime().optional(),
});

export const inviteBatchSchema = z.object({
  count: z.number().int().min(1).max(200),
  maxUses: z.number().int().min(1).max(999).optional(),
  initialCredits: z.number().int().min(0).optional(),
  note: z.string().max(200).optional(),
  expiresAt: z.string().datetime().optional(),
});

export const modelPricingSchema = z.object({
  modelId: z.string().min(1),
  resolution: z.string().min(1).nullable().optional(),
  aspectRatio: z.string().min(1).nullable().optional(),
  outputFormat: z.string().min(1).nullable().optional(),
  background: z.string().min(1).nullable().optional(),
  usesReference: z.boolean().nullable().optional(),
  credits: z.number().int().min(0).max(1_000_000),
  priority: z.number().int().min(0).max(10_000).default(0),
  note: z.string().max(200).nullable().optional(),
  isActive: z.boolean().optional(),
});

export const modelPricingPatchSchema = modelPricingSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, "至少提供一个字段");

export const adminCreditAdjustmentSchema = z.object({
  amount: z.number().int().min(-1_000_000).max(1_000_000).refine((value) => value !== 0, {
    message: "点数变动不能为 0",
  }),
  note: z.string().trim().max(200).optional(),
});

export const redemptionCodeBatchSchema = z.object({
  count: z.number().int().min(1).max(500),
  credits: z.number().int().min(1).max(1_000_000),
  maxUses: z.number().int().min(1).max(9999).default(1),
  perUserLimit: z.literal(1).default(1),
  note: z.string().max(200).optional(),
  expiresAt: z.string().datetime().optional(),
});

export const redeemCodeSchema = z.object({
  code: z.string().trim().min(4).max(80),
});

export const systemConfigPatchSchema = z.object({
  key: z.enum(Object.keys(SYSTEM_CONFIG_DEFAULT_ROWS) as [string, ...string[]]),
  value: z.unknown(),
});
