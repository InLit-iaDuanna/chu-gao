import { createHash } from "node:crypto";

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
import { providerAccountSchema } from "@/lib/validators";

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function GET(
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

  const accounts = await db.providerAccount.findMany({
    where: { providerId: id },
    orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
  });

  return ok(
    accounts.map((account) => ({
      ...account,
      apiKeyEnc: undefined,
      hasApiKey: Boolean(account.apiKeyEnc),
    })),
  );
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
  const parsed = providerAccountSchema.safeParse(json);

  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "账号参数不合法", {
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
  const baseUrl = normalizeProviderBaseUrl(parsed.data.baseUrl, provider.protocol);
  const account = await db.providerAccount.create({
    data: {
      providerId: id,
      name: parsed.data.name,
      baseUrl,
      apiKeyEnc: encrypt(parsed.data.apiKey),
      apiKeyFingerprint: fingerprint(parsed.data.apiKey),
      priority: parsed.data.priority,
      weight: parsed.data.weight,
      maxConcurrency: parsed.data.maxConcurrency,
      dailyLimit: parsed.data.dailyLimit,
      note: parsed.data.note,
    },
  });

  await audit({
    actorId: admin.id,
    action: "admin.provider_account.create",
    target: account.id,
    diff: {
      ...parsed.data,
      baseUrl,
      apiKey: "***",
    },
    request,
  });

  return ok({ ...account, apiKeyEnc: undefined, hasApiKey: true }, { status: 201 });
}
