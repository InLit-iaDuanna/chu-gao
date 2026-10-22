import { z } from "zod";

import {
  IMAGE_ASPECT_RATIO_OPTIONS,
  IMAGE_RESOLUTION_OPTIONS,
  IMAGE_SIZE_OPTIONS,
  RESPONSE_FORMAT_OPTIONS,
} from "@/lib/models/options";

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
  .refine((value) => Object.keys(value).length > 0, "至少提供一个字段");

export const providerChannelDeleteSchema = z.object({
  baseUrl: z.url(),
});

// 渠道请求格式：结构化字段（可选 size 列表 / 返回格式）+ 可选原始请求体模板。
export const channelRequestConfigPatchSchema = z.object({
  baseUrl: z.url(),
  sizes: z.array(z.enum(IMAGE_SIZE_OPTIONS)).max(8).optional(),
  responseFormat: z.enum(RESPONSE_FORMAT_OPTIONS).optional(),
  bodyTemplate: z.string().max(8000).nullable().optional(),
});

export const providerChannelPatchSchema = z
  .object({
    baseUrl: z.url(),
    displayName: z.string().trim().min(1).max(80).optional(),
    maxConcurrency: z.number().int().min(1).max(10_000).optional(),
  })
  .refine(
    (value) =>
      value.displayName !== undefined || value.maxConcurrency !== undefined,
    "至少提供一个字段",
  );

export const providerAccountImportSchema = z
  .object({
    mode: z.enum(["csv", "lines"]).default("csv"),
    text: z.string().max(100_000).optional(),
    csvText: z.string().max(100_000).optional(),
    defaultMaxConcurrency: z.number().int().min(1).max(100).default(1),
    defaultWeight: z.number().int().min(1).max(100).default(1),
  })
  .superRefine((value, ctx) => {
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
    dailyGenLimit: z.number().int().min(1).max(1000000).optional(),
    concurrentLimit: z.number().int().min(1).max(10000).optional(),
    materialInboxBeta: z.boolean().optional(),
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
  providerChannelId: z.string().trim().min(1).max(200).nullable().optional(),
  image2Mode: z.enum(["standard", "high"]).nullable().optional(),
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
  operationKey: z.string().min(8).max(128),
  amount: z
    .number()
    .finite()
    .multipleOf(0.000001)
    .min(-1_000_000)
    .max(1_000_000)
    .refine((value) => value !== 0, {
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

export const integrationsPatchSchema = z
  .object({
    deepseek: z
      .object({
        enabled: z.boolean().optional(),
        baseUrl: z.url().optional(),
        model: z.string().trim().min(1).max(100).optional(),
        systemPrompt: z.string().max(4000).optional(),
        // 留空字符串 = 清除已存密钥；省略 = 不修改。
        apiKey: z.string().max(400).optional(),
      })
      .optional(),
    // 对话模型：独立于 DeepSeek 优化与出图渠道。
    conversation: z
      .object({
        enabled: z.boolean().optional(),
        baseUrl: z.url().optional(),
        model: z.string().trim().min(1).max(100).optional(),
        systemPrompt: z.string().max(4000).optional(),
        // 出图提示词编译指令（compile 端点用）。
        compileSystemPrompt: z.string().max(4000).optional(),
        reasoning: z.boolean().optional(),
        // 留空字符串 = 清除已存密钥；省略 = 不修改。
        apiKey: z.string().max(400).optional(),
      })
      .optional(),
    pptSystemPrompt: z.string().trim().max(4000).optional(),
  })
  .refine(
    (value) =>
      value.deepseek !== undefined ||
      value.conversation !== undefined ||
      value.pptSystemPrompt !== undefined,
    "至少提供一个字段",
  );

export const systemConfigPatchSchema = z.discriminatedUnion("key", [
  z.object({
    key: z.literal("registration.inviteOnly"),
    value: z.boolean(),
  }),
  z.object({
    key: z.literal("registration.defaultCredits"),
    value: z.number().int().min(0).max(1_000_000),
  }),
  z.object({
    key: z.literal("generation.globalConcurrency"),
    value: z.number().int().min(1).max(10_000),
  }),
  z.object({
    key: z.literal("generation.defaultDailyLimit"),
    value: z.number().int().min(1).max(10_000),
  }),
  z.object({
    key: z.literal("generation.image2AspectRatios"),
    value: z
      .array(
        z.enum([
          "1:1",
          "3:2",
          "2:3",
          "4:3",
          "3:4",
          "5:4",
          "4:5",
          "16:9",
          "9:16",
          "2:1",
          "1:2",
          "21:9",
          "9:21",
        ]),
      )
      .min(1),
  }),
  z.object({
    key: z.literal("generation.image2Resolutions"),
    value: z.array(z.enum(IMAGE_RESOLUTION_OPTIONS)).min(1),
  }),
  z.object({
    key: z.literal("generation.image2ResolutionAspectRatios"),
    value: z.object({
      "1K": z.array(z.enum(IMAGE_ASPECT_RATIO_OPTIONS)).min(1),
      "2K": z.array(z.enum(IMAGE_ASPECT_RATIO_OPTIONS)).min(1),
      "4K": z.array(z.enum(IMAGE_ASPECT_RATIO_OPTIONS)).min(1),
    }),
  }),
  z.object({
    key: z.literal("generation.image2MaxN"),
    value: z.number().int().min(1).max(4),
  }),
  z.object({
    key: z.literal("moderation.enabled"),
    value: z.boolean(),
  }),
  z.object({
    key: z.literal("moderation.blockedKeywords"),
    value: z.array(z.string().trim().min(1).max(80)).max(500),
  }),
]);

// ─── 公告（独立 Announcement 表）────────────────────────────────

const announcementDateField = z
  .string()
  .datetime({ offset: true })
  .nullable()
  .optional();

const announcementFields = {
  title: z.string().trim().max(80).default(""),
  body: z.string().trim().min(1, "公告内容不能为空").max(2000),
  tone: z.enum(["info", "warning", "success", "danger"]).default("info"),
  displayMode: z.enum(["banner", "popup", "both"]).default("banner"),
  linkLabel: z.string().trim().max(24).nullable().optional(),
  linkUrl: z
    .string()
    .trim()
    .max(500)
    .refine(
      (value) =>
        value === "" || /^https?:\/\//.test(value) || value.startsWith("/"),
      "链接需为 http(s) 或站内路径",
    )
    .nullable()
    .optional(),
  enabled: z.boolean().default(true),
  startsAt: announcementDateField,
  endsAt: announcementDateField,
};

const announcementPatchFields = {
  title: announcementFields.title.optional(),
  body: announcementFields.body.optional(),
  tone: announcementFields.tone.optional(),
  displayMode: announcementFields.displayMode.optional(),
  linkLabel: announcementFields.linkLabel,
  linkUrl: announcementFields.linkUrl,
  enabled: announcementFields.enabled.optional(),
  startsAt: announcementFields.startsAt,
  endsAt: announcementFields.endsAt,
};

function hasValidAnnouncementDates(value: {
  startsAt?: string | null;
  endsAt?: string | null;
}) {
  return (
    !value.startsAt ||
    !value.endsAt ||
    new Date(value.endsAt) > new Date(value.startsAt)
  );
}

export const announcementCreateSchema = z
  .object(announcementFields)
  .refine(hasValidAnnouncementDates, {
    message: "结束时间需晚于开始时间",
    path: ["endsAt"],
  });

export const announcementPatchSchema = z
  .object(announcementPatchFields)
  .refine((value) => Object.keys(value).length > 0, "至少提供一个字段")
  .refine(hasValidAnnouncementDates, {
    message: "结束时间需晚于开始时间",
    path: ["endsAt"],
  });
