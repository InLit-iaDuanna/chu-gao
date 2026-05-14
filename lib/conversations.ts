import type { ConversationMessageRole, Prisma } from "@prisma/client";

import type {
  ConversationMessage,
  ConversationSummaryView,
  ConversationView,
} from "@/lib/conversation";
import { publicChannelAlias } from "@/lib/channel-alias";
import {
  displayNameForProviderChannelWithMap,
  getImage2ProviderChannelName,
  resolveImage2ProviderChannelId,
  type Image2ChannelDisplayNameMap,
} from "@/lib/provider-channels";
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
            take: 1,
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
  options: { displayNameMap?: Image2ChannelDisplayNameMap } = {},
) {
  if (!generation) {
    return null;
  }

  const image = generation.images[0];
  const providerChannelId = resolveImage2ProviderChannelId(
    generation.modelId,
    generation.paramsRaw,
    generation.providerAccount?.baseUrl,
  );
  const paramsRaw =
    generation.paramsRaw && typeof generation.paramsRaw === "object"
      ? (generation.paramsRaw as Record<string, unknown>)
      : null;
  const paramsProviderChannelBaseUrl =
    typeof paramsRaw?.providerChannelBaseUrl === "string"
      ? paramsRaw.providerChannelBaseUrl
      : null;
  const paramsProviderChannelName =
    typeof paramsRaw?.providerChannelName === "string"
      ? paramsRaw.providerChannelName
      : null;

  return {
    ...(image
      ? {
          imageId: image.id,
          imageUrl: privateImageUrl(generation.id, image.id),
          thumbnailUrl: image.thumbnailKey
            ? privateImageThumbnailUrl(generation.id, image.id)
            : privateImageUrl(generation.id, image.id),
        }
      : {}),
    generationStatus: generation.status,
    generationProvider: generation.provider?.name ?? null,
    generationProviderChannelId: providerChannelId,
    generationProviderChannelName:
      paramsProviderChannelName ??
      displayNameForProviderChannelWithMap(
        generation.providerAccount?.baseUrl ?? paramsProviderChannelBaseUrl,
        generation.provider?.name,
        options.displayNameMap,
      ) ??
      getImage2ProviderChannelName(providerChannelId),
    generationProviderAccountName: publicChannelAlias(
      generation.providerAccount?.name,
      generation.provider?.name,
      generation.providerAccount?.baseUrl,
    ),
    generationStartedAt: generation.startedAt?.toISOString() ?? null,
    generationFinishedAt: generation.finishedAt?.toISOString() ?? null,
    generationProgress: generation.progress,
  };
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
