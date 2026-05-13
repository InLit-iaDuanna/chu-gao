import { z } from "zod";

import { fail, ok } from "@/lib/api-response";
import {
  authenticatedUser,
  checkSession,
  sessionFailureResponse,
} from "@/lib/auth";
import {
  conversationMessagesInclude,
  serializeConversation,
} from "@/lib/conversations";
import { db } from "@/lib/db";
import { isDatabaseUnavailableError } from "@/lib/service-errors";

const updateMessageSchema = z.object({
  content: z.string().trim().min(1).max(4000),
});

function conversationsUnavailable() {
  return fail("SERVICE_UNAVAILABLE", "对话服务暂时不可用", { status: 503 });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; messageId: string }> },
) {
  const sessionResult = await checkSession(request);
  const failure = sessionFailureResponse(sessionResult);
  const { id, messageId } = await context.params;

  if (failure) {
    return failure;
  }

  if (sessionResult.status !== "authenticated") {
    return fail("UNAUTHORIZED", "请先登录", { status: 401 });
  }

  if (!process.env.DATABASE_URL) {
    return fail("SERVICE_UNAVAILABLE", "对话服务未配置数据库", { status: 503 });
  }

  const json = (await request.json()) as unknown;
  const parsed = updateMessageSchema.safeParse(json);

  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "消息参数不合法", {
      status: 400,
      details: parsed.error.flatten(),
    });
  }

  try {
    const session = authenticatedUser(sessionResult);
    const message = await db.conversationMessage.findFirst({
      where: {
        id: messageId,
        conversationId: id,
        role: "USER",
        conversation: {
          userId: session.id,
          archivedAt: null,
        },
      },
      select: {
        id: true,
      },
    });

    if (!message) {
      return fail("NOT_FOUND", "消息不存在", { status: 404 });
    }

    await db.conversationMessage.update({
      where: {
        id: messageId,
      },
      data: {
        content: parsed.data.content,
      },
    });

    const conversation = await db.conversation.findFirstOrThrow({
      where: {
        id,
        userId: session.id,
      },
      include: conversationMessagesInclude(),
    });

    return ok(serializeConversation(conversation));
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      return conversationsUnavailable();
    }

    throw error;
  }
}
