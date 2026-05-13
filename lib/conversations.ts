import type { ConversationMessageRole, Prisma } from "@prisma/client";

import type {
  ConversationMessage,
  ConversationSummaryView,
  ConversationView,
} from "@/lib/conversation";
import { publicChannelAlias } from "@/lib/channel-alias";
import { privateImageUrl } from "@/lib/storage";

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

function firstGenerationImage(
  generation:
    | ConversationWithMessages["messages"][number]["generation"]
    | ConversationSummaryRow["generations"][number]
    | null,
) {
  const image = generation?.images[0];

  if (!generation || !image) {
    return null;
  }

  return {
    imageId: image.id,
    imageUrl: privateImageUrl(generation.id, image.id),
    generationStatus: generation.status,
    generationProvider: generation.provider?.name ?? null,
    generationProviderAccountName: publicChannelAlias(
      generation.providerAccount?.name,
      generation.provider?.name,
    ),
    generationStartedAt: generation.startedAt?.toISOString() ?? null,
    generationFinishedAt: generation.finishedAt?.toISOString() ?? null,
    generationProgress: generation.progress,
  };
}

export function serializeConversation(
  row: ConversationWithMessages,
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
      ...(firstGenerationImage(message.generation) ?? {}),
    })),
  };
}

export function serializeConversationSummary(
  row: ConversationSummaryRow,
): ConversationSummaryView {
  const latestGeneration = row.generations[0];
  const image = firstGenerationImage(latestGeneration);

  return {
    id: row.id,
    title: row.title,
    lastMessageAt: row.lastMessageAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    latestMessage: row.messages[0]?.content ?? null,
    thumbnailUrl: image?.imageUrl ?? null,
    generationCount: row._count.generations,
  };
}
