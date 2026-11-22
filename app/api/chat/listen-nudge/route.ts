import { z } from "zod";
import { fail, ok } from "@/lib/api-response";
import { chatRequestUser } from "@/lib/chat-turn-http";
import { db } from "@/lib/db";
import { readJsonBodySafe } from "@/lib/request-body";
import { generateListenNudge } from "@/lib/chat-listen-nudge";
import { logger } from "@/lib/logger";

/**
 * 倾听 (admin preview): the user has been hesitating in the input box, so
 * Xiie says one short line to help them go on. Reads only messages already
 * sent, never the draft, and stores nothing.
 */
export async function POST(request: Request) {
  const auth = await chatRequestUser(request);
  if (auth.response) return auth.response;
  const body = await readJsonBodySafe(request);
  if (!body.ok) return body.response;
  const parsed = z
    .object({
      conversationId: z.string().min(1).max(64),
      modelId: z.string().min(1).max(64),
      reason: z.enum(["stalled", "rewriting"]),
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
  const conversation = await db.conversation.findFirst({
    where: {
      id: parsed.data.conversationId,
      userId: auth.userId!,
      archivedAt: null,
    },
    select: { id: true },
  });
  if (!conversation)
    return fail("NOT_FOUND", "对话不存在", { status: 404 });
  const rows = await db.conversationMessage.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: "desc" },
    take: 12,
    select: { role: true, content: true },
  });
  try {
    const line = await generateListenNudge(
      parsed.data.modelId,
      rows.reverse(),
      parsed.data.reason,
      { userId: auth.userId!, conversationId: conversation.id },
    );
    return ok({ line });
  } catch (error) {
    logger.warn(
      { errorName: error instanceof Error ? error.name : "unknown" },
      "Listen nudge failed",
    );
    // A missed nudge is harmless: Xiie just keeps listening.
    return ok({ line: null });
  }
}
