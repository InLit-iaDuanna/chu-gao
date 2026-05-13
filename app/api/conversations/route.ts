import { z } from "zod";

import { fail, ok } from "@/lib/api-response";
import {
  authenticatedUser,
  checkSession,
  sessionFailureResponse,
} from "@/lib/auth";
import {
  conversationMessagesInclude,
  conversationSummaryRowInclude,
  conversationTitleFromText,
  serializeConversation,
  serializeConversationSummary,
} from "@/lib/conversations";
import { db } from "@/lib/db";
import { isDatabaseUnavailableError } from "@/lib/service-errors";

const createConversationSchema = z.object({
  title: z.string().trim().min(1).max(80).optional(),
  firstMessage: z.string().trim().min(1).max(4000).optional(),
});

function conversationsUnavailable() {
  return fail("SERVICE_UNAVAILABLE", "对话服务暂时不可用", { status: 503 });
}

export async function GET(request: Request) {
  const sessionResult = await checkSession(request);
  const failure = sessionFailureResponse(sessionResult);

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
    const { searchParams } = new URL(request.url);
    const limit = Math.min(
      Math.max(Number(searchParams.get("limit") ?? 20), 1),
      50,
    );
    const rows = await db.conversation.findMany({
      where: {
        userId: session.id,
        archivedAt: null,
      },
      include: conversationSummaryRowInclude(),
      orderBy: {
        lastMessageAt: "desc",
      },
      take: limit,
    });

    return ok({
      items: rows.map(serializeConversationSummary),
    });
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      return conversationsUnavailable();
    }

    throw error;
  }
}

export async function POST(request: Request) {
  const sessionResult = await checkSession(request);
  const failure = sessionFailureResponse(sessionResult);

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
  const parsed = createConversationSchema.safeParse(json);

  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "对话参数不合法", {
      status: 400,
      details: parsed.error.flatten(),
    });
  }

  try {
    const session = authenticatedUser(sessionResult);
    const firstMessage = parsed.data.firstMessage;
    const title =
      parsed.data.title ?? conversationTitleFromText(firstMessage ?? "");
    const conversation = await db.conversation.create({
      data: {
        userId: session.id,
        title,
        ...(firstMessage
          ? {
              lastMessageAt: new Date(),
              messages: {
                create: {
                  role: "USER",
                  content: firstMessage,
                },
              },
            }
          : {}),
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

export async function DELETE(request: Request) {
  const sessionResult = await checkSession(request);
  const failure = sessionFailureResponse(sessionResult);

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
    const archived = await db.conversation.updateMany({
      where: {
        userId: session.id,
        archivedAt: null,
      },
      data: {
        archivedAt: new Date(),
      },
    });

    return ok({
      archived: archived.count,
    });
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      return conversationsUnavailable();
    }

    throw error;
  }
}
