import { fail, ok } from "@/lib/api-response";
import { z } from "zod";
import { readJsonBodySafe } from "@/lib/request-body";
import { chatRequestUser, chatTurnFailure } from "@/lib/chat-turn-http";
import { cancelChatTurn } from "@/lib/chat-turns";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await chatRequestUser(request);
  if (auth.response) return auth.response;
  const body = await readJsonBodySafe(request);
  if (!body.ok) return body.response;
  const parsed = z
    .object({ expectedAttemptId: z.string().min(1).max(128) })
    .strict()
    .safeParse(body.data);
  if (!parsed.success)
    return fail("VALIDATION_ERROR", "缺少目标尝试标识，请刷新后停止", {
      status: 400,
    });
  try {
    return ok(
      await cancelChatTurn(
        auth.userId!,
        (await context.params).id,
        parsed.data.expectedAttemptId,
      ),
    );
  } catch (error) {
    return chatTurnFailure(error);
  }
}
