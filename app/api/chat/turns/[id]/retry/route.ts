import { z } from "zod";
import { fail, ok } from "@/lib/api-response";
import { userActionRateLimitResponse } from "@/lib/api-rate-limit";
import { chatRequestUser, chatTurnFailure } from "@/lib/chat-turn-http";
import { retryChatTurn } from "@/lib/chat-turns";
import { chatWorkerOnline } from "@/lib/chat-worker";
import { readJsonBodySafe } from "@/lib/request-body";
import { db } from "@/lib/db";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await chatRequestUser(request);
  if (auth.response) return auth.response;
  const limited = await userActionRateLimitResponse(
    auth.userId!,
    "chat-turn-retry",
    undefined,
    10,
  );
  if (limited) return limited;
  const body = await readJsonBodySafe(request);
  if (!body.ok) return body.response;
  const parsed = z
    .object({
      clientRequestId: z.string().min(8).max(128),
      expectedPreviousAttemptId: z.string().min(1).max(128),
    })
    .strict()
    .safeParse(body.data);
  if (!parsed.success)
    return fail("VALIDATION_ERROR", "重试参数不合法", { status: 400 });
  try {
    const replay = await db.chatRequestReceipt.findUnique({
      where: {
        userId_scope_clientRequestId: {
          userId: auth.userId!,
          scope: "retry",
          clientRequestId: parsed.data.clientRequestId,
        },
      },
    });
    if (!replay && !(await chatWorkerOnline()))
      return fail("WORKER_UNAVAILABLE", "对话服务暂时不可用", { status: 503 });
    return ok(
      await retryChatTurn(
        auth.userId!,
        (await context.params).id,
        parsed.data.clientRequestId,
        parsed.data.expectedPreviousAttemptId,
      ),
    );
  } catch (error) {
    return chatTurnFailure(error);
  }
}
