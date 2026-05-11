import { randomBytes } from "node:crypto";

import { fail, ok } from "@/lib/api-response";
import { audit } from "@/lib/audit";
import {
  adminFailureResponse,
  authenticatedUser,
  checkSession,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { redemptionCodeBatchSchema } from "@/lib/validators";

function createCode(): string {
  return `CREDIT-${randomBytes(4).toString("hex").toUpperCase()}`;
}

export async function GET(request: Request) {
  const sessionResult = await checkSession(request);
  const failure = adminFailureResponse(sessionResult);

  if (failure) {
    return failure;
  }

  if (!process.env.DATABASE_URL) {
    return fail("SERVICE_UNAVAILABLE", "兑换码服务未配置数据库", { status: 503 });
  }

  const codes = await db.creditRedemptionCode.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      _count: {
        select: { redemptions: true },
      },
    },
  });

  return ok(codes);
}

export async function POST(request: Request) {
  const sessionResult = await checkSession(request);
  const failure = adminFailureResponse(sessionResult);

  if (failure) {
    return failure;
  }

  if (!process.env.DATABASE_URL) {
    return fail("SERVICE_UNAVAILABLE", "兑换码服务未配置数据库", { status: 503 });
  }

  const json = (await request.json()) as unknown;
  const parsed = redemptionCodeBatchSchema.safeParse(json);

  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "兑换码参数不合法", {
      status: 400,
      details: parsed.error.flatten(),
    });
  }

  const admin = authenticatedUser(sessionResult);
  const rows = await db.$transaction(
    Array.from({ length: parsed.data.count }, () =>
      db.creditRedemptionCode.create({
        data: {
          code: createCode(),
          credits: parsed.data.credits,
          maxUses: parsed.data.maxUses,
          perUserLimit: parsed.data.perUserLimit,
          note: parsed.data.note,
          expiresAt: parsed.data.expiresAt
            ? new Date(parsed.data.expiresAt)
            : undefined,
          createdBy: admin.id,
        },
      }),
    ),
  );

  await audit({
    actorId: admin.id,
    action: "admin.redemption_code.create",
    target: rows.map((row) => row.id).join(","),
    diff: {
      count: rows.length,
      credits: parsed.data.credits,
      maxUses: parsed.data.maxUses,
    },
    request,
  });

  return ok(rows, { status: 201 });
}
