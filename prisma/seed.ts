import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";
import type { ProviderProtocol } from "@prisma/client";

import { encrypt } from "@/lib/crypto";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { modelsByProtocol } from "@/lib/models/registry";
import { safeUrlForDiagnostics } from "@/lib/providers/diagnostics";
import {
  normalizeProviderBaseUrl,
  providerProtocolToModelProtocol,
} from "@/lib/providers/protocols";
import { SYSTEM_CONFIG_DEFAULT_ROWS } from "@/lib/system-config";

function image2Protocol(): ProviderProtocol {
  const configured = process.env.IMAGE2_PROVIDER_PROTOCOL;
  const wireApi = process.env.IMAGE2_WIRE_API?.toLowerCase();

  if (wireApi === "responses") {
    return "OPENAI_RESPONSES_IMAGE";
  }

  if (
    configured === "OPENAI_IMAGES" ||
    configured === "OPENAI_RESPONSES_IMAGE" ||
    configured === "GEMINI_IMAGE"
  ) {
    return configured;
  }

  return "OPENAI_RESPONSES_IMAGE";
}

function image2ModelIds(): string[] {
  const configured = process.env.IMAGE2_MODELS_SUPPORTED?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (configured?.length) {
    return configured;
  }

  const modelIds = modelsByProtocol(
    providerProtocolToModelProtocol(image2Protocol()),
  ).map((model) => model.id);

  return modelIds;
}

function apiKeyFingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function seedImage2Provider(): Promise<void> {
  const baseUrl = process.env.IMAGE2_BASE_URL;
  const apiKey = process.env.IMAGE2_API_KEY;

  if (!baseUrl || !apiKey) {
    logger.warn(
      "IMAGE2_BASE_URL or IMAGE2_API_KEY missing, skipped image2 provider seed.",
    );
    return;
  }

  const name = process.env.IMAGE2_PROVIDER_NAME ?? "sub2api";
  const protocol = image2Protocol();
  const data = {
    name,
    protocol,
    baseUrl: normalizeProviderBaseUrl(baseUrl, protocol),
    apiKeyEnc: encrypt(apiKey),
    priority: Number(process.env.IMAGE2_PRIORITY ?? 100),
    modelsSupported: image2ModelIds(),
    costMultiplier: Number(process.env.IMAGE2_COST_MULTIPLIER ?? 1),
    isActive: true,
    health: "HEALTHY" as const,
    note:
      process.env.IMAGE2_PROVIDER_NOTE ??
      "Seeded from IMAGE2_* environment variables for Responses image generation.",
  };

  const existing = await db.provider.findFirst({
    where: { name },
    select: { id: true },
  });

  if (existing) {
    await db.provider.update({
      where: { id: existing.id },
      data,
    });
    await db.providerAccount.upsert({
      where: {
        providerId_baseUrl_apiKeyFingerprint: {
          providerId: existing.id,
          baseUrl: data.baseUrl,
          apiKeyFingerprint: apiKeyFingerprint(apiKey),
        },
      },
      create: {
        providerId: existing.id,
        name: `${name} 默认账号`,
        baseUrl: data.baseUrl,
        apiKeyEnc: data.apiKeyEnc,
        apiKeyFingerprint: apiKeyFingerprint(apiKey),
        maxConcurrency: Number(process.env.IMAGE2_ACCOUNT_CONCURRENCY ?? 1),
      },
      update: {
        baseUrl: data.baseUrl,
        apiKeyEnc: data.apiKeyEnc,
        isActive: true,
      },
    });
    logger.info(
      {
        providerId: existing.id,
        name,
        protocol,
        baseUrl: safeUrlForDiagnostics(data.baseUrl),
        modelsSupported: data.modelsSupported,
      },
      "Updated image2 provider.",
    );
    return;
  }

  const provider = await db.provider.create({
    data: {
      ...data,
      accounts: {
        create: {
          name: `${name} 默认账号`,
          baseUrl: data.baseUrl,
          apiKeyEnc: data.apiKeyEnc,
          apiKeyFingerprint: apiKeyFingerprint(apiKey),
          maxConcurrency: Number(process.env.IMAGE2_ACCOUNT_CONCURRENCY ?? 1),
        },
      },
    },
  });
  logger.info(
    {
      providerId: provider.id,
      name,
      protocol,
      baseUrl: safeUrlForDiagnostics(data.baseUrl),
      modelsSupported: data.modelsSupported,
    },
    "Created image2 provider.",
  );
}

async function seedInspirationCircle(): Promise<void> {
  const curator = await db.user.findFirst({
    where: { role: "ADMIN" },
    select: { id: true, name: true, email: true },
  });
  const authorId = curator?.id ?? null;
  const authorName =
    curator?.name?.trim() || curator?.email?.split("@")[0] || "Chūgǎo 策展";
  const seedPosts = [
    {
      shape: "PATTERN" as const,
      discipline: "PRODUCT" as const,
      title: "安静的界面：什么信息可以晚一点出现？",
      story:
        "不是所有反馈都需要立刻抢占注意力。分享一个你见过或设计过的“延迟反馈”模式。",
      tags: ["交互模式", "注意力"],
    },
    {
      shape: "TEARDOWN" as const,
      discipline: "INDUSTRIAL" as const,
      title: "材料会怎样替产品说话？",
      story: "从握持、重量、温度或磨损出发，拆解一个材料选择如何改变使用判断。",
      tags: ["材料", "工业设计"],
    },
    {
      // This is a discussion pattern, not a sourced reference to a specific
      // external work. Keeping it as PATTERN avoids a misleading source field.
      shape: "PATTERN" as const,
      discipline: "BRAND" as const,
      title: "一个品牌如何把立场说得不吵？",
      story: "分享一个不靠大声口号，而是通过细节建立立场的品牌模式。",
      tags: ["品牌策略", "语气"],
    },
    {
      // PROCESS requires at least two media items. This text-only seed is a
      // reusable reasoning pattern, so PATTERN is the accurate shape.
      shape: "PATTERN" as const,
      discipline: "DATAVIZ" as const,
      title: "从数据到判断：你会先画什么？",
      story:
        "梳理一次从原始数据、问题定义到视觉结论的推理模式，哪一步最容易被跳过？",
      tags: ["信息可视化", "过程"],
    },
    {
      shape: "PATTERN" as const,
      discipline: "GRAPHIC" as const,
      title: "让海报留白成为一种回应",
      story: "留白不是空白。记录一次你如何让缺席的内容参与版面叙事。",
      tags: ["版式", "留白"],
    },
  ];

  for (const seed of seedPosts) {
    const existing = await db.designPost.findFirst({
      where: { title: seed.title },
      select: { id: true, rankScore: true, trustTier: true },
    });
    if (existing) {
      // Correct older seed revisions in place instead of creating another row
      // or leaving a media-less PROCESS / source-less REFERENCE behind.
      if (existing.rankScore === 18 && existing.trustTier === "TRUSTED") {
        await db.designPost.update({
          where: { id: existing.id },
          data: {
            shape: seed.shape,
            discipline: seed.discipline,
            story: seed.story,
          },
        });
      }
      continue;
    }
    const post = await db.designPost.create({
      data: {
        authorId,
        authorNameSnapshot: authorName,
        shape: seed.shape,
        discipline: seed.discipline,
        title: seed.title,
        story: seed.story,
        status: "PUBLISHED",
        trustTier: "TRUSTED",
        publishedAt: new Date(),
        rankScore: 18,
        tags: {
          create: await Promise.all(
            seed.tags.map(async (name) => {
              const slug = name.toLowerCase().replace(/\s+/g, "-");
              const tag = await db.designTag.upsert({
                where: { slug },
                create: { slug, name, kind: "STYLE" },
                update: {},
              });
              return { tagId: tag.id };
            }),
          ),
        },
      },
    });
    logger.info({ postId: post.id }, "Seeded inspiration post.");
  }

  const dailyDay = new Date("2026-08-04T00:00:00.000Z");
  const dailyTitle = "公共服务里的等待，怎样才不焦虑？";
  const dailyPrompt =
    "当等待不可避免时，设计应该管理时间，还是管理等待者对时间的感受？从空间、信息反馈和情绪节奏中选择一个切口，提出你的判断。";
  const legacyDuplicateStory =
    "当等待不可避免时，设计应该管理时间，还是管理等待者对时间的感受？欢迎从空间、信息反馈和情绪节奏三个角度回应。";

  await db.$transaction(async (tx) => {
    const seededAt = new Date();
    const existingPrompt = await tx.dailyPrompt.findFirst({
      where: { day: dailyDay, title: dailyTitle },
      select: { id: true, questionPostId: true, publishedAt: true },
    });
    const prompt = existingPrompt
      ? await tx.dailyPrompt.update({
          where: { id: existingPrompt.id },
          data: {
            discipline: "SERVICE",
            title: dailyTitle,
            prompt: dailyPrompt,
            keywords: ["服务设计", "等待", "信息反馈"],
            status: "PUBLISHED",
            publishedAt: existingPrompt.publishedAt ?? seededAt,
          },
          select: { id: true, questionPostId: true },
        })
      : await tx.dailyPrompt.create({
          data: {
            day: dailyDay,
            discipline: "SERVICE",
            title: dailyTitle,
            prompt: dailyPrompt,
            keywords: ["服务设计", "等待", "信息反馈"],
            status: "PUBLISHED",
            publishedAt: seededAt,
          },
          select: { id: true, questionPostId: true },
        });

    const linkedQuestion = prompt.questionPostId
      ? await tx.designPost.findUnique({
          where: { id: prompt.questionPostId },
          select: { id: true, publishedAt: true },
        })
      : null;
    const legacyQuestion = linkedQuestion
      ? null
      : await tx.designPost.findFirst({
          where: {
            title: dailyTitle,
            story: legacyDuplicateStory,
            shape: "QUESTION",
            discipline: "SERVICE",
            dailyPromptId: null,
            rankScore: 18,
          },
          select: { id: true, publishedAt: true },
        });
    const reusableQuestion = linkedQuestion ?? legacyQuestion;
    const question = reusableQuestion
      ? await tx.designPost.update({
          where: { id: reusableQuestion.id },
          data: {
            authorId,
            authorNameSnapshot: authorName,
            shape: "QUESTION",
            discipline: "SERVICE",
            title: dailyTitle,
            story: dailyPrompt,
            status: "PUBLISHED",
            trustTier: "TRUSTED",
            publishedAt: reusableQuestion.publishedAt ?? seededAt,
            dailyPromptId: null,
            rankScore: 24,
            hiddenAt: null,
            deletedAt: null,
          },
          select: { id: true },
        })
      : await tx.designPost.create({
          data: {
            authorId,
            authorNameSnapshot: authorName,
            shape: "QUESTION",
            discipline: "SERVICE",
            title: dailyTitle,
            story: dailyPrompt,
            status: "PUBLISHED",
            trustTier: "TRUSTED",
            publishedAt: seededAt,
            dailyPromptId: null,
            rankScore: 24,
          },
          select: { id: true },
        });

    if (prompt.questionPostId !== question.id) {
      await tx.dailyPrompt.update({
        where: { id: prompt.id },
        data: { questionPostId: question.id },
      });
    }

    // A previous seed revision also inserted the daily topic into seedPosts.
    // Delete only that exact legacy row, never similarly titled user content.
    await tx.designPost.deleteMany({
      where: {
        id: { not: question.id },
        title: dailyTitle,
        story: legacyDuplicateStory,
        shape: "QUESTION",
        discipline: "SERVICE",
        dailyPromptId: null,
        rankScore: 18,
      },
    });
  });
}

async function main() {
  await Promise.all(
    Object.entries(SYSTEM_CONFIG_DEFAULT_ROWS).map(([key, value]) =>
      db.systemConfig.upsert({
        where: { key },
        create: { key, value },
        update: {},
      }),
    ),
  );

  const adminCount = await db.user.count({
    where: { role: "ADMIN" },
  });

  if (adminCount === 0) {
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;
    const adminName = process.env.ADMIN_NAME ?? "Admin";

    if (!adminEmail || !adminPassword) {
      logger.warn(
        "ADMIN_EMAIL or ADMIN_PASSWORD missing, skipped admin bootstrap.",
      );
    } else {
      await db.user.create({
        data: {
          email: adminEmail,
          name: adminName,
          passwordHash: await bcrypt.hash(adminPassword, 12),
          role: "ADMIN",
          credits: Number(process.env.DEFAULT_USER_CREDITS ?? 100),
        },
      });
    }
  }

  await seedImage2Provider();
  await seedInspirationCircle();

  logger.info("Seed completed.");
}

main().catch((error) => {
  logger.error(error);
  process.exitCode = 1;
});
