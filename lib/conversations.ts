import type { ConversationMessageRole, Prisma } from "@prisma/client";
import { storedChatReferences } from "@/lib/chat-references-types";

import type {
  ConversationMessage,
  ConversationSummaryView,
  ConversationView,
} from "@/lib/conversation";
import type { Image2ChannelDisplayNameMap } from "@/lib/provider-channels";
import { privateImageThumbnailUrl, privateImageUrl } from "@/lib/storage";

const conversationInclude = {
  messages: {
    include: {
      generation: {
        include: {
          provider: {
            select: {
              name: true,
            },
          },
          providerAccount: {
            select: {
              name: true,
              baseUrl: true,
            },
          },
          images: {
            orderBy: {
              createdAt: "asc",
            },
          },
        },
      },
    },
    orderBy: {
      createdAt: "asc",
    },
  },
} satisfies Prisma.ConversationInclude;

const conversationSummaryInclude = {
  messages: {
    orderBy: {
      createdAt: "desc",
    },
    take: 1,
  },
  generations: {
    include: {
      provider: {
        select: {
          name: true,
        },
      },
      providerAccount: {
        select: {
          name: true,
          baseUrl: true,
        },
      },
      images: {
        orderBy: {
          createdAt: "asc",
        },
        take: 1,
      },
    },
    orderBy: {
      createdAt: "desc",
    },
    take: 1,
  },
  _count: {
    select: {
      generations: true,
    },
  },
} satisfies Prisma.ConversationInclude;

export type ConversationWithMessages = Prisma.ConversationGetPayload<{
  include: typeof conversationInclude;
}>;

export type ConversationSummaryRow = Prisma.ConversationGetPayload<{
  include: typeof conversationSummaryInclude;
}>;

export function conversationMessagesInclude() {
  return conversationInclude;
}

export function conversationSummaryRowInclude() {
  return conversationSummaryInclude;
}

export function conversationTitleFromText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "新的创作对话";
  }

  return normalized.length > 28 ? `${normalized.slice(0, 28)}...` : normalized;
}

function roleToView(
  role: ConversationMessageRole,
): ConversationMessage["role"] {
  return role === "USER" ? "user" : "assistant";
}

function generationMessageMeta(
  generation:
    | ConversationWithMessages["messages"][number]["generation"]
    | ConversationSummaryRow["generations"][number]
    | null,
  _options: { displayNameMap?: Image2ChannelDisplayNameMap } = {},
) {
  if (!generation) {
    return null;
  }

  const images = [...generation.images]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((image) => ({
      id: image.id,
      src: privateImageUrl(generation.id, image.id),
      url: privateImageUrl(generation.id, image.id),
      downloadUrl: privateImageUrl(generation.id, image.id),
      thumbnailUrl: image.thumbnailKey
        ? privateImageThumbnailUrl(generation.id, image.id)
        : privateImageUrl(generation.id, image.id),
      width: image.width,
      height: image.height,
      mimeType: image.mimeType,
    }));
  const image = images[0];
  const paramsRaw =
    generation.paramsRaw && typeof generation.paramsRaw === "object"
      ? (generation.paramsRaw as Record<string, unknown>)
      : null;

  return {
    ...(image
      ? {
          imageId: image.id,
          imageUrl: image.src,
          images,
          thumbnailUrl: image.thumbnailUrl,
        }
      : {}),
    generationPrompt: generation.prompt,
    generationModelId: generation.modelId,
    generationSize: typeof paramsRaw?.size === "string" ? paramsRaw.size : null,
    generationCount: generation.n,
    generationErrorCode: generation.errorCode,
    generationErrorMessage: generation.errorMessage,
    generationStatus: generation.status,
    generationProvider: null,
    generationProviderChannelId: null,
    generationProviderChannelName: null,
    generationProviderAccountName: null,
    generationStartedAt: generation.startedAt?.toISOString() ?? null,
    generationFinishedAt: generation.finishedAt?.toISOString() ?? null,
    generationProgress: generation.progress,
  };
}

function serializeChatReferences(value: unknown) {
  try {
    return storedChatReferences(value);
  } catch {
    return [];
  }
}

export function serializeConversation(
  row: ConversationWithMessages,
  options: { displayNameMap?: Image2ChannelDisplayNameMap } = {},
): ConversationView {
  return {
    id: row.id,
    title: row.title,
    lastMessageAt: row.lastMessageAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    messages: row.messages.map((message) => ({
      id: message.id,
      role: roleToView(message.role),
      content: message.content,
      generationId: message.generationId ?? undefined,
      chatTurnId: message.chatTurnId ?? undefined,
      chatAttemptId: message.chatAttemptId ?? undefined,
      chatStatus: message.chatStatus ?? undefined,
      chatReferences: serializeChatReferences(message.chatReferences),
      chatSources: Array.isArray(message.chatSources)
        ? (message.chatSources as unknown as import("@/lib/chat-search").ChatSearchSource[])
        : [],
      chatUsage:
        message.chatUsage &&
        typeof message.chatUsage === "object" &&
        !Array.isArray(message.chatUsage)
          ? (message.chatUsage as Record<string, unknown>)
          : null,
      chatError:
        message.chatError &&
        typeof message.chatError === "object" &&
        !Array.isArray(message.chatError)
          ? String(
              (message.chatError as Record<string, unknown>).publicMessage ??
                "本次回复未完成，内容已保存",
            )
          : null,
      createdAt: message.createdAt.toISOString(),
      ...(generationMessageMeta(message.generation, options) ?? {}),
    })),
  };
}

export function serializeConversationSummary(
  row: ConversationSummaryRow,
  options: { displayNameMap?: Image2ChannelDisplayNameMap } = {},
): ConversationSummaryView {
  const latestGeneration = row.generations[0];
  const generationMeta = generationMessageMeta(latestGeneration, options);

  return {
    id: row.id,
    title: row.title,
    lastMessageAt: row.lastMessageAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    latestMessage: row.messages[0]?.content ?? null,
    thumbnailUrl:
      generationMeta && "thumbnailUrl" in generationMeta
        ? (generationMeta.thumbnailUrl ?? null)
        : null,
    generationCount: row._count.generations,
  };
}
