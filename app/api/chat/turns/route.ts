import { ok, fail } from "@/lib/api-response";
import { userActionRateLimitResponse } from "@/lib/api-rate-limit";
import { chatRequestUser, chatTurnFailure } from "@/lib/chat-turn-http";
import {
  chatTurnSchema,
  createChatTurn,
  getChatTurn,
  getChatTurnByRequest,
} from "@/lib/chat-turns";
import { chatWorkerOnline } from "@/lib/chat-worker";
import { readJsonBodySafe } from "@/lib/request-body";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await chatRequestUser(request);
  if (auth.response) return auth.response;
  const conversationId = new URL(request.url).searchParams.get(
    "conversationId",
  );
  if (!conversationId || conversationId.length > 128)
    return fail("VALIDATION_ERROR", "缺少有效的对话 ID", { status: 400 });
  try {
    const requestId = new URL(request.url).searchParams.get("clientRequestId");
    if (requestId) {
      if (requestId.length < 8 || requestId.length > 128)
        return fail("VALIDATION_ERROR", "请求标识不合法", { status: 400 });
      return ok(
        await getChatTurnByRequest(auth.userId!, conversationId, requestId),
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }
    const turn = await db.chatTurn.findFirst({
      where: {
        userId: auth.userId!,
        activeConversationId: conversationId,
        conversation: { archivedAt: null },
      },
      select: { id: true },
    });
    return ok(turn ? await getChatTurn(auth.userId!, turn.id) : null, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return chatTurnFailure(error);
  }
}

export async function POST(request: Request) {
  const auth = await chatRequestUser(request);
  if (auth.response) return auth.response;
  const limited = await userActionRateLimitResponse(
    auth.userId!,
    "chat-turn-create",
    undefined,
    20,
  );
  if (limited) return limited;
  const body = await readJsonBodySafe(request);
  if (!body.ok) return body.response;
  const parsed = chatTurnSchema.safeParse(body.data);
  if (!parsed.success)
    return fail("VALIDATION_ERROR", "对话任务参数不合法", { status: 400 });
  try {
    // Replays remain available while the worker is temporarily offline.
    const existing = await db.chatRequestReceipt.findUnique({
      where: {
        userId_scope_clientRequestId: {
          userId: auth.userId!,
          scope: "create",
          clientRequestId: parsed.data.clientRequestId,
        },
      },
      select: { id: true },
    });
    if (!existing && !(await chatWorkerOnline()))
      return fail("WORKER_UNAVAILABLE", "对话服务正在连接，请稍后重试", {
        status: 503,
      });
    return ok(await createChatTurn(auth.userId!, parsed.data), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return chatTurnFailure(error);
  }
}
