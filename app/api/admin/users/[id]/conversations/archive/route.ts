import { fail, ok } from "@/lib/api-response";
import { audit } from "@/lib/audit";
import {
  adminFailureResponse,
  authenticatedUser,
  checkSession,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { adminArchiveConversationsSchema } from "@/lib/validators";

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
    return fail("SERVICE_UNAVAILABLE", "会话服务未配置数据库", { status: 503 });
  }

  const json = (await request.json()) as unknown;
  const parsed = adminArchiveConversationsSchema.safeParse(json);

  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "归档参数不合法", {
      status: 400,
      details: parsed.error.flatten(),
    });
  }

  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const archived = await db.conversation.updateMany({
    where: {
      userId: id,
      archivedAt: null,
      ...(parsed.data.mode === "inactive"
        ? { lastMessageAt: { lt: cutoff } }
        : {}),
    },
    data: { archivedAt: new Date() },
  });
  const admin = authenticatedUser(sessionResult);

  await audit({
    actorId: admin.id,
    action: "admin.user.conversations_archive",
    target: id,
    diff: { mode: parsed.data.mode, count: archived.count },
    request,
  });

  return ok({ archived: archived.count });
}
