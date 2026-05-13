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

  return modelsByProtocol(
    providerProtocolToModelProtocol(image2Protocol()),
  ).map((model) => model.id);
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

  logger.info("Seed completed.");
}

main().catch((error) => {
  logger.error(error);
  process.exitCode = 1;
});
