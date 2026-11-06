import { z } from "zod";
import { fail, ok } from "@/lib/api-response";
import { chatRequestUser, chatTurnFailure } from "@/lib/chat-turn-http";
import { db } from "@/lib/db";
import { readJsonBodySafe } from "@/lib/request-body";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await chatRequestUser(request);
  if (auth.response) return auth.response;
  const body = await readJsonBodySafe(request);
  if (!body.ok) return body.response;
  const parsed = z
    .object({
      expectedAttemptId: z.string().min(1).max(128),
      renderedAt: z.iso.datetime(),
    })
    .strict()
    .safeParse(body.data);
  if (!parsed.success)
    return fail("VALIDATION_ERROR", "无效的显示时间记录", { status: 400 });
  try {
    const { id } = await context.params;
    const attempt = await db.chatAttempt.findFirst({
      where: {
        id: parsed.data.expectedAttemptId,
        turnId: id,
        turn: { userId: auth.userId!, conversation: { archivedAt: null } },
      },
      select: { id: true, createdAt: true },
    });
    if (!attempt) return fail("NOT_FOUND", "对话任务不存在", { status: 404 });
    const timestamp = new Date(parsed.data.renderedAt);
    // Client clocks are diagnostic only and never influence leases or billing.
    const bounded =
      timestamp.getTime() >= attempt.createdAt.getTime() - 300_000 &&
      timestamp.getTime() <= Date.now() + 300_000
        ? timestamp
        : new Date();
    await db.chatAttempt.updateMany({
      where: { id: attempt.id, firstTextRenderedAt: null },
      data: { firstTextRenderedAt: bounded },
    });
    return ok({ recorded: true });
  } catch (error) {
    return chatTurnFailure(error);
  }
}
