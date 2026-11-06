import type { Prisma } from "@prisma/client";

import { contextSourceHash } from "@/lib/chat-context-manifest";
import {
  ChatContextError,
  type ChatContextTool,
  type ChatContextToolResult,
} from "@/lib/chat-context-types";
import {
  storedChatReferences,
  type ChatReference,
} from "@/lib/chat-references-types";
import type { ChatSearchSource } from "@/lib/chat-search";
import { db } from "@/lib/db";

const historySelect = {
  id: true,
  contextRevision: true,
  messages: {
    select: {
      id: true,
      role: true,
      content: true,
      chatTurnId: true,
      chatAttemptId: true,
      chatStatus: true,
      chatReferences: true,
      chatSources: true,
      generation: {
        select: {
          status: true,
          deletedAt: true,
          images: {
            select: { id: true },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          },
        },
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
  chatTurns: {
    select: {
      id: true,
      status: true,
      activeAttemptId: true,
      attempts: {
        select: {
          id: true,
          ordinal: true,
          status: true,
          parts: true,
          sources: true,
        },
        orderBy: { ordinal: "asc" },
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
} satisfies Prisma.ConversationSelect;

export type ContextHistory = Prisma.ConversationGetPayload<{
  select: typeof historySelect;
}>;
type HistoryRow = ContextHistory["messages"][number];

export interface ContextMessage {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  references: ChatReference[];
  toolResult: ChatContextToolResult | null;
}

export interface ContextTurn {
  key: string;
  turnId: string | null;
  outcome: string;
  closed: boolean;
  messages: ContextMessage[];
  source: unknown;
}

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown, limit: number) =>
  typeof value === "string"
    ? value
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
        .trim()
        .slice(0, limit)
    : "";

function sources(values: unknown[]): ChatSearchSource[] {
  const result: ChatSearchSource[] = [];
  for (const value of values) {
    const item = object(value);
    try {
      if (typeof item.url !== "string" || item.url.length > 2048) continue;
      const url = new URL(item.url);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        continue;
      if (!result.some((entry) => entry.url === url.href))
        result.push({
          url: url.href,
          title: text(item.title, 240) || url.hostname,
        });
      if (result.length === 24) break;
    } catch {
      /* Malformed sources are not evidence. */
    }
  }
  return result;
}

const toolTypes = new Set([
  "web_search_call",
  "file_search_call",
  "function_call",
  "function_call_output",
  "tool_call",
  "tool_result",
  "tool_output",
  "code_interpreter_call",
]);
const array = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

/** Only application-side evidence is replayed, never opaque native calls or reasoning. */
export function sanitizeContextToolResult(
  row: Pick<HistoryRow, "id" | "chatTurnId" | "chatAttemptId" | "chatSources">,
  parts: unknown,
  attemptSources: unknown,
): ChatContextToolResult | null {
  const bundle = object(parts);
  const items = Array.isArray(parts)
    ? parts
    : [...array(bundle.parts), ...array(bundle.tools), ...array(bundle.items)];
  const candidates = [...array(row.chatSources), ...array(attemptSources)];
  const tools: ChatContextTool[] = [];
  for (const value of items.slice(0, 256)) {
    const item = object(value);
    candidates.push(...array(item.annotations));
    for (const content of array(item.content))
      candidates.push(...array(object(content).annotations));
    if (typeof item.type !== "string" || !toolTypes.has(item.type)) continue;
    const action = object(item.action);
    const toolSources = sources([
      ...array(action.sources),
      ...array(item.sources),
    ]);
    const status = text(item.status, 40);
    const failed = [
      "failed",
      "incomplete",
      "cancelled",
      "interrupted",
      "in_progress",
    ].includes(status);
    if (!failed) candidates.push(...toolSources);
    const output = failed ? "" : text(item.output ?? item.text, 8_000);
    const tool: ChatContextTool = { type: item.type };
    const fields = {
      itemId: text(item.id ?? item.itemId, 128),
      callId: text(item.call_id ?? item.callId, 128),
      name: text(item.name, 128),
      status,
      query: text(action.query ?? item.query, 512),
      text: output,
    };
    for (const [key, value] of Object.entries(fields))
      if (value) Object.assign(tool, { [key]: value });
    const original = item.output ?? item.text;
    if (!failed && typeof original === "string" && original.length > 8_000)
      tool.truncated = true;
    if (toolSources.length && !failed) tool.sources = toolSources;
    tools.push(tool);
  }
  const safeSources = sources(candidates);
  return safeSources.length || tools.length
    ? {
        messageId: row.id,
        turnId: row.chatTurnId,
        attemptId: row.chatAttemptId,
        sources: safeSources,
        tools,
      }
    : null;
}

export async function loadContextHistory(
  userId: string,
  conversationId: string,
  client: Pick<Prisma.TransactionClient, "conversation"> = db,
): Promise<ContextHistory> {
  const history = await client.conversation.findFirst({
    where: { id: conversationId, userId, archivedAt: null },
    select: historySelect,
  });
  if (!history) throw new ChatContextError("NOT_FOUND", "对话不存在", 404);
  return history;
}

export function historyHash(history: ContextHistory): string {
  return contextSourceHash({
    messages: history.messages,
    turns: history.chatTurns,
  });
}

export function contextTurns(
  history: ContextHistory,
  currentMessageId: string | null,
): ContextTurn[] {
  const currentIndex = currentMessageId
    ? history.messages.findIndex((row) => row.id === currentMessageId)
    : history.messages.length;
  if (
    currentMessageId &&
    (currentIndex < 0 || history.messages[currentIndex].role !== "USER")
  )
    throw new ChatContextError(
      "CHAT_CONTEXT_CHANGED",
      "本轮用户消息不存在，请刷新后重试",
      409,
    );
  const currentTurnId = currentMessageId
    ? history.messages[currentIndex].chatTurnId
    : null;
  if (
    currentMessageId &&
    history.messages
      .slice(currentIndex + 1)
      .some(
        (row) =>
          row.role === "USER" ||
          !currentTurnId ||
          row.chatTurnId !== currentTurnId ||
          row.chatStatus === "completed",
      )
  )
    throw new ChatContextError(
      "CHAT_CONTEXT_CHANGED",
      "本轮之后的历史已变化，请刷新后重试",
      409,
    );

  const groups: { key: string; turnId: string | null; rows: HistoryRow[] }[] =
    [];
  const byTurn = new Map<string, (typeof groups)[number]>();
  for (const row of history.messages.slice(0, currentIndex)) {
    let group = row.chatTurnId ? byTurn.get(row.chatTurnId) : undefined;
    if (!row.chatTurnId && row.role === "ASSISTANT" && !groups.at(-1)?.turnId)
      group = groups.at(-1);
    if (!group) {
      group = {
        key: row.chatTurnId ?? `legacy:${row.id}`,
        turnId: row.chatTurnId,
        rows: [],
      };
      groups.push(group);
      if (row.chatTurnId) byTurn.set(row.chatTurnId, group);
    }
    group.rows.push(row);
  }
  return groups.map((group, index) => {
    const turn = history.chatTurns.find((item) => item.id === group.turnId);
    const assistant = group.rows.filter((row) => row.role === "ASSISTANT");
    const completed = assistant.some(
      (row) => row.chatStatus == null || row.chatStatus === "completed",
    );
    const final = assistant.at(-1);
    const imageOutcome = final?.generation
      ? final.generation.status === "SUCCEEDED" && !final.generation.deletedAt
        ? "completed"
        : ["PENDING", "RUNNING"].includes(final.generation.status)
          ? "running"
          : "failed"
      : null;
    const outcome =
      turn?.status ??
      imageOutcome ??
      final?.chatStatus ??
      (completed ? "completed" : "unanswered");
    const closed =
      !["queued", "running"].includes(outcome) &&
      (outcome !== "unanswered" ||
        index < groups.length - 1 ||
        !!currentMessageId);
    const messages: ContextMessage[] = [];
    for (const row of group.rows) {
      const attempt = turn?.attempts.find(
        (item) => item.id === row.chatAttemptId,
      );
      if (
        row.role === "ASSISTANT" &&
        (outcome !== "completed" ||
          (row.chatStatus != null && row.chatStatus !== "completed") ||
          (turn?.activeAttemptId &&
            row.chatAttemptId !== turn.activeAttemptId) ||
          (attempt && attempt.status !== "completed") ||
          (row.generation &&
            (row.generation.status !== "SUCCEEDED" ||
              row.generation.deletedAt)))
      )
        continue;
      let references: ChatReference[];
      try {
        references = storedChatReferences(row.chatReferences);
      } catch {
        throw new ChatContextError(
          "CHAT_CONTEXT_REFERENCES_INVALID",
          "历史参考图记录无效，原始消息已保留",
          409,
        );
      }
      if (
        row.role === "ASSISTANT" &&
        row.generation?.status === "SUCCEEDED" &&
        !row.generation.deletedAt
      )
        references.push(
          ...row.generation.images.map((image) => ({
            kind: "generated" as const,
            id: image.id,
          })),
        );
      const toolResult =
        row.role === "ASSISTANT"
          ? sanitizeContextToolResult(row, attempt?.parts, attempt?.sources)
          : null;
      if (row.content || references.length || toolResult)
        messages.push({
          id: row.id,
          role: row.role,
          content: row.content,
          references,
          toolResult,
        });
    }
    return {
      key: group.key,
      turnId: group.turnId,
      outcome,
      closed,
      messages,
      source: { rows: group.rows, turn: turn ?? null },
    };
  });
}

export const turnsHash = (turns: ContextTurn[]) =>
  contextSourceHash(turns.map((turn) => turn.source));
