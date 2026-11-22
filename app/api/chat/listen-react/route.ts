import { z } from "zod";
import { fail, ok } from "@/lib/api-response";
import { chatRequestUser } from "@/lib/chat-turn-http";
import { db } from "@/lib/db";
import { readJsonBodySafe } from "@/lib/request-body";
import { generateListenReaction } from "@/lib/chat-listen-flash";
import { logger } from "@/lib/logger";

/**
 * 倾听 (admin preview): the user just said a line and paused, so Xiie gives
 * a quick reaction (a nod, a little heart, maybe a murmur). The lines are the
 * ones already said in this stretch, not the draft; nothing is stored.
 */
export async function POST(request: Request) {
  const auth = await chatRequestUser(request);
  if (auth.response) return auth.response;
  const body = await readJsonBodySafe(request);
  if (!body.ok) return body.response;
  const parsed = z
    .object({
      conversationId: z.string().min(1).max(64).nullable(),
      lines: z.array(z.string().min(1).max(2_000)).min(1).max(12),
      murmurs: z.array(z.string().max(24)).max(6).optional(),
    })
    .strict()
    .safeParse(body.data);
  if (!parsed.success)
    return fail("VALIDATION_ERROR", "无效的请求", { status: 400 });
  const user = await db.user.findUnique({
    where: { id: auth.userId! },
    select: { role: true },
  });
  if (user?.role !== "ADMIN")
    return fail("FORBIDDEN", "该功能仅对管理员开放", { status: 403 });
  let history: { role: string; content: string }[] = [];
  const conversationId = parsed.data.conversationId;
  if (conversationId) {
    const conversation = await db.conversation.findFirst({
      where: { id: conversationId, userId: auth.userId!, archivedAt: null },
      select: { id: true },
    });
    if (!conversation)
      return fail("NOT_FOUND", "对话不存在", { status: 404 });
    const rows = await db.conversationMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { role: true, content: true },
    });
    history = rows.reverse();
  }
  try {
    const result = await generateListenReaction(
      history,
      parsed.data.lines,
      { userId: auth.userId!, ...(conversationId ? { conversationId } : {}) },
      parsed.data.murmurs ?? [],
    );
    return ok(result ?? { reaction: null, line: null });
  } catch (error) {
    logger.warn(
      { errorName: error instanceof Error ? error.name : "unknown" },
      "Listen reaction failed",
    );
    // A missed reaction is harmless: Xiie just keeps listening.
    return ok({ reaction: null, line: null });
  }
}
