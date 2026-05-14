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
import { getImage2ChannelDisplayNameMap } from "@/lib/provider-channel-config";
import { isDatabaseUnavailableError } from "@/lib/service-errors";

const updateConversationSchema = z.object({
  title: z.string().trim().min(1).max(80).optional(),
  archived: z.boolean().optional(),
});

function conversationsUnavailable() {
  return fail("SERVICE_UNAVAILABLE", "对话服务暂时不可用", { status: 503 });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const sessionResult = await checkSession(request);
  const failure = sessionFailureResponse(sessionResult);
  const { id } = await context.params;

  if (failure) {
    return failure;
  }

  if (sessionResult.status !== "authenticated") {
    return fail("UNAUTHORIZED", "请先登录", { status: 401 });
  }

  if (!process.env.DATABASE_URL) {
    return fail("SERVICE_UNAVAILABLE", "对话服务未配置数据库", { status: 503 });
  }

  try {
    const session = authenticatedUser(sessionResult);
    const conversation = await db.conversation.findFirst({
      where: {
        id,
        userId: session.id,
        archivedAt: null,
      },
      include: conversationMessagesInclude(),
    });

    if (!conversation) {
      return fail("NOT_FOUND", "对话不存在", { status: 404 });
    }

    const displayNameMap = await getImage2ChannelDisplayNameMap();

    return ok(serializeConversation(conversation, { displayNameMap }));
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      return conversationsUnavailable();
    }

    throw error;
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const sessionResult = await checkSession(request);
  const failure = sessionFailureResponse(sessionResult);
  const { id } = await context.params;

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
  const parsed = updateConversationSchema.safeParse(json);

  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "对话参数不合法", {
      status: 400,
      details: parsed.error.flatten(),
    });
  }

  try {
    const session = authenticatedUser(sessionResult);
    const updated = await db.conversation.updateMany({
      where: {
        id,
        userId: session.id,
      },
      data: {
        ...(parsed.data.title ? { title: parsed.data.title } : {}),
        ...(parsed.data.archived === undefined
          ? {}
          : { archivedAt: parsed.data.archived ? new Date() : null }),
      },
    });

    if (updated.count === 0) {
      return fail("NOT_FOUND", "对话不存在", { status: 404 });
    }

    const conversation = await db.conversation.findFirstOrThrow({
      where: {
        id,
        userId: session.id,
      },
      include: conversationMessagesInclude(),
    });

    const displayNameMap = await getImage2ChannelDisplayNameMap();

    return ok(serializeConversation(conversation, { displayNameMap }));
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      return conversationsUnavailable();
    }

    throw error;
  }
}
