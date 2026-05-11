import bcrypt from "bcryptjs";

import { fail, ok } from "@/lib/api-response";
import { audit } from "@/lib/audit";
import {
  adminFailureResponse,
  authenticatedUser,
  checkSession,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { adminPasswordResetSchema } from "@/lib/validators";

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
    return fail("SERVICE_UNAVAILABLE", "用户服务未配置数据库", { status: 503 });
  }

  const json = (await request.json()) as unknown;
  const parsed = adminPasswordResetSchema.safeParse(json);

  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "密码参数不合法", {
      status: 400,
      details: parsed.error.flatten(),
    });
  }

  const admin = authenticatedUser(sessionResult);
  const user = await db.user.update({
    where: { id },
    data: {
      passwordHash: await bcrypt.hash(parsed.data.password, 12),
      sessionVersion: { increment: 1 },
    },
    select: {
      id: true,
      email: true,
      sessionVersion: true,
    },
  });

  await audit({
    actorId: admin.id,
    action: "admin.user.password_reset",
    target: id,
    diff: { sessionVersion: user.sessionVersion },
    request,
  });

  return ok({ id: user.id, email: user.email, sessionVersion: user.sessionVersion });
}
