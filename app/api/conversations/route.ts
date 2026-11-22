import { z } from "zod";

import { fail, ok } from "@/lib/api-response";
import { readJsonBodySafe } from "@/lib/request-body";
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
import { conversationVisibilityWhere } from "@/lib/conversation-access";
import { db } from "@/lib/db";
import { getImage2ChannelDisplayNameMap } from "@/lib/provider-channel-config";
import { isDatabaseUnavailableError } from "@/lib/service-errors";
import { CHAT_INPUT_MAX_CHARS } from "@/lib/chat-turn-types";

const createConversationSchema = z.object({
  title: z.string().trim().min(1).max(80).optional(),
  firstMessage: z.string().trim().min(1).max(CHAT_INPUT_MAX_CHARS).optional(),
  // 安卓 APP 内新建对话默认只保存在本机（LOCAL，绑定当前设备）；
  // 网页端不传，保持 CLOUD 行为不变。
  storage: z.enum(["local", "cloud"]).optional(),
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
    const [rows, displayNameMap] = await Promise.all([
      db.conversation.findMany({
        where: {
          archivedAt: null,
          ...conversationVisibilityWhere(session.id, session.deviceId),
        },
        include: conversationSummaryRowInclude(),
        orderBy: {
          lastMessageAt: "desc",
        },
        take: limit,
      }),
      getImage2ChannelDisplayNameMap(),
    ]);

    return ok({
      items: rows.map((row) =>
        serializeConversationSummary(row, { displayNameMap }),
      ),
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

  const body = await readJsonBodySafe(request);

  if (!body.ok) {
    return body.response;
  }

  const json = body.data;
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
    const storage = parsed.data.storage ?? "cloud";

    if (storage === "local" && !session.deviceId) {
      return fail("VALIDATION_ERROR", "当前设备无法创建仅保存在本机的对话", {
        status: 400,
      });
    }

    const title =
      parsed.data.title ?? conversationTitleFromText(firstMessage ?? "");
    const conversation = await db.conversation.create({
      data: {
        userId: session.id,
        title,
        storage: storage === "local" ? "LOCAL" : "CLOUD",
        localDeviceId: storage === "local" ? (session.deviceId ?? null) : null,
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

    const displayNameMap = await getImage2ChannelDisplayNameMap();

    return ok(await serializeConversation(conversation, { displayNameMap }));
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
        archivedAt: null,
        ...conversationVisibilityWhere(session.id, session.deviceId),
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
