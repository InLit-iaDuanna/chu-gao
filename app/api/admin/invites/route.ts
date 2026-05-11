import { randomBytes } from "node:crypto";

import { fail, ok } from "@/lib/api-response";
import { audit } from "@/lib/audit";
import {
  adminFailureResponse,
  authenticatedUser,
  checkSession,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { inviteBatchSchema } from "@/lib/validators";

function createInviteCode(): string {
  return `CHUGAO-${randomBytes(3).toString("hex").toUpperCase()}`;
}

export async function GET(request: Request) {
  const sessionResult = await checkSession(request);
  const failure = adminFailureResponse(sessionResult);

  if (failure) {
    return failure;
  }

  if (sessionResult.status !== "authenticated") {
    return fail("UNAUTHORIZED", "缺少管理员身份", { status: 401 });
  }

  if (!process.env.DATABASE_URL) {
    return fail("SERVICE_UNAVAILABLE", "邀请码服务未配置数据库", {
      status: 503,
    });
  }

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const now = new Date();
    const invites = await db.inviteCode.findMany({
      where: {
        ...(status === "active"
          ? {
              revokedAt: null,
              OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
            }
          : {}),
        ...(status === "revoked" ? { revokedAt: { not: null } } : {}),
        ...(status === "expired"
          ? { expiresAt: { lte: now }, revokedAt: null }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    return ok(invites);
  } catch (error) {
    return fail("INTERNAL_ERROR", "邀请码列表读取失败", {
      status: 500,
      details: error instanceof Error ? error.message : "unknown",
    });
  }
}

export async function POST(request: Request) {
  const sessionResult = await checkSession(request);
  const failure = adminFailureResponse(sessionResult);

  if (failure) {
    return failure;
  }

  if (sessionResult.status !== "authenticated") {
    return fail("UNAUTHORIZED", "缺少管理员身份", { status: 401 });
  }

  if (!process.env.DATABASE_URL) {
    return fail("SERVICE_UNAVAILABLE", "邀请码服务未配置数据库", {
      status: 503,
    });
  }

  const admin = authenticatedUser(sessionResult);

  const json = (await request.json()) as unknown;
  const parsed = inviteBatchSchema.safeParse(json);

  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "邀请码参数不合法", {
      status: 400,
      details: parsed.error.flatten(),
    });
  }

  try {
    const rows = await db.$transaction(
      Array.from({ length: parsed.data.count }, () =>
        db.inviteCode.create({
          data: {
            code: createInviteCode(),
            maxUses: parsed.data.maxUses ?? 1,
            initialCredits: parsed.data.initialCredits ?? 100,
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
      action: "admin.invite.create",
      target: rows.map((row) => row.id).join(","),
      diff: {
        count: rows.length,
        maxUses: parsed.data.maxUses ?? 1,
        initialCredits: parsed.data.initialCredits ?? 100,
      },
      request,
    });

    return ok(rows, { status: 201 });
  } catch (error) {
    return fail("INTERNAL_ERROR", "邀请码生成失败", {
      status: 500,
      details: error instanceof Error ? error.message : "unknown",
    });
  }
}
