import { fail, ok } from "@/lib/api-response";
import { readJsonBodySafe } from "@/lib/request-body";
import { audit } from "@/lib/audit";
import {
  adminFailureResponse,
  authenticatedUser,
  checkSession,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { adminArchiveConversationsSchema } from "@/lib/validators";
import { assertChatConversationIdle, ChatTurnError } from "@/lib/chat-turns";

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

  const body = await readJsonBodySafe(request);

  if (!body.ok) {
    return body.response;
  }

  const json = body.data;
  const parsed = adminArchiveConversationsSchema.safeParse(json);

  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "归档参数不合法", {
      status: 400,
      details: parsed.error.flatten(),
    });
  }

  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const where = {
    userId: id,
    archivedAt: null,
    ...(parsed.data.mode === "inactive"
      ? { lastMessageAt: { lt: cutoff } }
      : {}),
  };
  const candidates = await db.conversation.findMany({
    where,
    select: { id: true },
    orderBy: { id: "asc" },
  });
  let count = 0;
  for (const candidate of candidates)
    count += await db.$transaction(async (tx) => {
      try {
        await assertChatConversationIdle(tx, candidate.id, id);
      } catch (error) {
        if (
          error instanceof ChatTurnError &&
          (error.code === "CHAT_TURN_BUSY" || error.code === "NOT_FOUND")
        )
          return 0;
        throw error;
      }
      return (
        await tx.conversation.updateMany({
          where: { ...where, id: candidate.id },
          data: { archivedAt: new Date() },
        })
      ).count;
    });
  const admin = authenticatedUser(sessionResult);

  await audit({
    actorId: admin.id,
    action: "admin.user.conversations_archive",
    target: id,
    diff: { mode: parsed.data.mode, count },
    request,
  });

  return ok({ archived: count });
}
