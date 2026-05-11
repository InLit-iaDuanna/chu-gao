import { createHash } from "node:crypto";

import { Prisma } from "@prisma/client";

import { fail, ok } from "@/lib/api-response";
import { audit } from "@/lib/audit";
import {
  adminFailureResponse,
  authenticatedUser,
  checkSession,
} from "@/lib/auth";
import { encrypt } from "@/lib/crypto";
import { db } from "@/lib/db";
import { normalizeProviderBaseUrl } from "@/lib/providers/protocols";
import { providerAccountImportSchema } from "@/lib/validators";

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseLine(line: string) {
  const parts = line.includes(",")
    ? line.split(",").map((part) => part.trim())
    : line.trim().split(/\s+/);

  const [baseUrl, apiKey, maxConcurrency, weight, name] = parts;

  if (!baseUrl || !apiKey) {
    return null;
  }

  return {
    baseUrl,
    apiKey,
    maxConcurrency: maxConcurrency ? Number(maxConcurrency) : undefined,
    weight: weight ? Number(weight) : undefined,
    name,
  };
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const sessionResult = await checkSession(request);
  const { id } = await context.params;
  const failure = adminFailureResponse(sessionResult);

  if (failure) {
    return failure;
  }

  if (!process.env.DATABASE_URL) {
    return fail("SERVICE_UNAVAILABLE", "号池服务未配置数据库", { status: 503 });
  }

  const json = (await request.json()) as unknown;
  const parsed = providerAccountImportSchema.safeParse(json);

  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "批量导入参数不合法", {
      status: 400,
      details: parsed.error.flatten(),
    });
  }

  const provider = await db.provider.findUnique({
    where: { id },
    select: { id: true, protocol: true },
  });

  if (!provider) {
    return fail("NOT_FOUND", "渠道池不存在", { status: 404 });
  }

  const admin = authenticatedUser(sessionResult);
  const rows = parsed.data.text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseLine)
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
  const created = [];
  const skipped = [];

  for (const row of rows) {
    const baseUrl = normalizeProviderBaseUrl(row.baseUrl, provider.protocol);

    try {
      const account = await db.providerAccount.create({
        data: {
          providerId: id,
          name: row.name,
          baseUrl,
          apiKeyEnc: encrypt(row.apiKey),
          apiKeyFingerprint: fingerprint(row.apiKey),
          maxConcurrency:
            row.maxConcurrency && Number.isFinite(row.maxConcurrency)
              ? row.maxConcurrency
              : parsed.data.defaultMaxConcurrency,
          weight:
            row.weight && Number.isFinite(row.weight)
              ? row.weight
              : parsed.data.defaultWeight,
        },
      });

      created.push(account.id);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        skipped.push(baseUrl);
        continue;
      }

      throw error;
    }
  }

  await audit({
    actorId: admin.id,
    action: "admin.provider_account.import",
    target: id,
    diff: {
      created: created.length,
      skipped: skipped.length,
    },
    request,
  });

  return ok({ created: created.length, skipped: skipped.length });
}
