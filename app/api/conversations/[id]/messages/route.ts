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

const appendMessagesSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1).max(4000),
        generationId: z.string().optional(),
      }),
    )
    .min(1)
    .max(8),
});

function conversationsUnavailable() {
  return fail("SERVICE_UNAVAILABLE", "对话服务暂时不可用", { status: 503 });
}

export async function POST(
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
  const parsed = appendMessagesSchema.safeParse(json);

  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "消息参数不合法", {
      status: 400,
      details: parsed.error.flatten(),
    });
  }

  try {
    const session = authenticatedUser(sessionResult);
    const conversation = await db.conversation.findFirst({
      where: {
        id,
        userId: session.id,
        archivedAt: null,
      },
      select: {
        id: true,
      },
    });

    if (!conversation) {
      return fail("NOT_FOUND", "对话不存在", { status: 404 });
    }

    const generationIds = [
      ...new Set(
        parsed.data.messages
          .map((message) => message.generationId)
          .filter((value): value is string => Boolean(value)),
      ),
    ];

    if (generationIds.length) {
      const generations = await db.generation.findMany({
        where: {
          id: {
            in: generationIds,
          },
          userId: session.id,
          conversationId: id,
          deletedAt: null,
        },
        select: {
          id: true,
        },
      });

      if (generations.length !== generationIds.length) {
        return fail("GENERATION_NOT_FOUND", "关联任务不存在或不属于当前对话", {
          status: 404,
        });
      }
    }

    await db.$transaction(async (tx) => {
      for (const message of parsed.data.messages) {
        await tx.conversationMessage.create({
          data: {
            conversationId: id,
            role: message.role === "user" ? "USER" : "ASSISTANT",
            content: message.content,
            generationId: message.generationId,
          },
        });
      }

      await tx.conversation.update({
        where: { id },
        data: {
          lastMessageAt: new Date(),
        },
      });
    });

    const updated = await db.conversation.findFirstOrThrow({
      where: {
        id,
        userId: session.id,
      },
      include: conversationMessagesInclude(),
    });

    const displayNameMap = await getImage2ChannelDisplayNameMap();

    return ok(serializeConversation(updated, { displayNameMap }));
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      return conversationsUnavailable();
    }

    throw error;
  }
}

export async function DELETE(
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
      select: {
        id: true,
      },
    });

    if (!conversation) {
      return fail("NOT_FOUND", "对话不存在", { status: 404 });
    }

    const deleted = await db.conversationMessage.deleteMany({
      where: {
        conversationId: id,
      },
    });

    await db.conversation.update({
      where: { id },
      data: {
        lastMessageAt: new Date(),
      },
    });

    return ok({
      deleted: deleted.count,
    });
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      return conversationsUnavailable();
    }

    throw error;
  }
}
