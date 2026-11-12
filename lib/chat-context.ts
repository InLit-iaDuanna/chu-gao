import { Prisma, type ContextSnapshot } from "@prisma/client";

import { getConversationSystemPrompt } from "@/lib/ai-config";
import { renderStructuredChatMemory } from "@/lib/chat-context-memory";
import {
  contextTurns,
  historyHash,
  loadContextHistory,
  turnsHash,
  type ContextHistory,
  type ContextMessage,
  type ContextTurn,
} from "@/lib/chat-context-history";
import {
  contextSourceHash,
  finalizeChatContextManifest,
  immutableContextManifest,
} from "@/lib/chat-context-manifest";
import {
  assertContextNotAborted,
  contextSummarizerProfileVersion,
  createContextSummarizer,
  estimateMessageTokens,
  estimateTextTokens,
  MAX_SUMMARY_INPUT_TOKENS,
  MAX_SUMMARY_TOKENS,
  summaryInputTokens,
} from "@/lib/chat-context-summary";
import {
  CHAT_CONTEXT_AUTO_COMPACT_RATIO,
  CHAT_CONTEXT_ESTIMATOR_VERSION,
  ChatContextError,
  normalizeChatContextBudget,
  type ChatContextAsset,
  type ChatContextManifest,
  type ChatContextStatus,
} from "@/lib/chat-context-types";
import { chatSystemInstructions } from "@/lib/chat-instructions";
import {
  LUNA_MODEL_ID,
  SOL_MODEL_ID,
  OPUS_MODEL_ID,
} from "@/lib/chat-model-options";
import {
  normalizeChatReferences,
  storedChatReferences,
  type ChatReference,
  type ChatReferencesInput,
} from "@/lib/chat-references-types";
import { resolveChatReferences } from "@/lib/chat-references";
import type { UpstreamChatMessage } from "@/lib/chat-upstream";
import { db } from "@/lib/db";
import { getChatProfile } from "@/lib/chat-profiles";

export { ChatContextError } from "@/lib/chat-context-types";
export type {
  ChatContextStatus,
  ChatContextManifest,
} from "@/lib/chat-context-types";
export {
  finalizeChatContextManifest,
  chatRequestHash,
} from "@/lib/chat-context-manifest";

const KEEP_TURNS = 4;
const MAX_ACTIVE_TURNS = 20;
const MAX_SUMMARY_CALLS = 4;
const MAX_SEGMENT_MESSAGES = 96;
const compacting = new Set<string>();

export interface ContextInput {
  userId: string;
  conversationId: string;
  modelId: string;
  budgetTokens?: number;
  signal?: AbortSignal;
  /** Supply the frozen execution instructions for an exact prompt estimate. */
  instructions?: string;
  profileVersion?: string;
}

export interface PrepareContextInput extends ContextInput, ChatReferencesInput {
  latestMessage: UpstreamChatMessage;
  /** Persisted user identity; never inferred from matching text. */
  latestMessageId?: string;
  /** Alternatively resolve the single persisted USER belonging to this turn. */
  currentTurnId?: string;
  forceCompact?: boolean;
  /** Optional: bind the manifest to the exact body that the worker will send. */
  buildRequest?: (messages: UpstreamChatMessage[]) => unknown;
  /** Admission must prepare a bounded request without an unreserved summary call. */
  skipCompaction?: boolean;
}

interface SnapshotState {
  row: ContextSnapshot;
  boundary: number;
}
interface CurrentMessage {
  id: string | null;
  turnId: string | null;
  message: UpstreamChatMessage;
  references: ChatReference[];
}
interface ContextState {
  history: ContextHistory;
  turns: ContextTurn[];
  snapshot: SnapshotState | null;
  current: CurrentMessage | null;
  systemTokens: number;
  budgetTokens: number;
}
interface Template {
  message: UpstreamChatMessage;
  references: ChatReference[];
  needsImages: boolean;
}

function validateModel(modelId: string) {
  if (
    !["default", LUNA_MODEL_ID, SOL_MODEL_ID, OPUS_MODEL_ID].includes(modelId)
  )
    throw new ChatContextError("VALIDATION_ERROR", "不支持的对话模型", 400);
}

const turnMessages = (turns: ContextTurn[]) =>
  turns.flatMap((turn) => turn.messages);
const toolManifest = (turns: ContextTurn[]) =>
  turnMessages(turns).flatMap((row) =>
    row.toolResult ? [row.toolResult] : [],
  );

function assets(turns: ContextTurn[], compacted = false): ChatContextAsset[] {
  return turns.flatMap((turn) =>
    turn.messages.flatMap((row) =>
      row.references.map((reference, index) => ({
        messageId: row.id,
        turnId: turn.turnId,
        index,
        reference,
        compacted,
      })),
    ),
  );
}

function attachmentManifest(turns: ContextTurn[]) {
  return {
    version: 1,
    turnKeys: turns.map((turn) => turn.key),
    messageIds: turnMessages(turns).map((row) => row.id),
    assets: assets(turns, true),
  };
}

async function loadSnapshot(
  history: ContextHistory,
  turns: ContextTurn[],
  modelId?: string,
) {
  const candidates = await db.contextSnapshot.findMany({
    where: {
      conversationId: history.id,
      estimatorVersion: CHAT_CONTEXT_ESTIMATOR_VERSION,
      ...(modelId
        ? { summarizerProfileVersion: contextSummarizerProfileVersion(modelId) }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  let snapshot: SnapshotState | null = null;
  for (const row of candidates) {
    const manifest = row.attachmentManifest as {
      version?: unknown;
      turnKeys?: unknown;
    } | null;
    const boundary = Array.isArray(manifest?.turnKeys)
      ? manifest.turnKeys.length
      : 0;
    if (
      !boundary ||
      boundary > turns.length ||
      boundary <= (snapshot?.boundary ?? 0) ||
      manifest?.version !== 1 ||
      row.revision > history.contextRevision ||
      !row.summary.trim() ||
      estimateTextTokens(row.summary) > MAX_SUMMARY_TOKENS
    )
      continue;
    const covered = turns.slice(0, boundary);
    // Revision is a commit fence; an unchanged prefix can still be reused after appends.
    if (
      covered.some((turn) => !turn.closed) ||
      turnsHash(covered) !== row.sourceHash ||
      (covered.at(-1)?.turnId ?? null) !== row.throughTurnId ||
      contextSourceHash(attachmentManifest(covered)) !==
        contextSourceHash(row.attachmentManifest) ||
      contextSourceHash({ version: 1, entries: toolManifest(covered) }) !==
        contextSourceHash(row.toolResultManifest)
    )
      continue;
    snapshot = { row, boundary };
  }
  return snapshot;
}

async function loadState(
  input: ContextInput,
  latest?: PrepareContextInput,
  allProfiles = false,
): Promise<ContextState> {
  const history = await loadContextHistory(input.userId, input.conversationId);
  let currentId = latest?.latestMessageId ?? null;
  if (latest?.currentTurnId) {
    const users = history.messages.filter(
      (row) => row.chatTurnId === latest.currentTurnId && row.role === "USER",
    );
    if (users.length !== 1 || (currentId && users[0].id !== currentId))
      throw new ChatContextError(
        "CHAT_CONTEXT_CHANGED",
        "本轮用户消息身份不匹配",
        409,
      );
    currentId = users[0].id;
  }
  const turns = contextTurns(history, currentId);
  const currentRow = currentId
    ? history.messages.find((row) => row.id === currentId)
    : null;
  const explicitReferences =
    latest &&
    (latest.references !== undefined ||
      latest.referenceImageKeys !== undefined ||
      latest.sourceImageIds !== undefined);
  const current = latest
    ? {
        id: currentId,
        turnId: currentRow?.chatTurnId ?? latest.currentTurnId ?? null,
        message: structuredClone(latest.latestMessage),
        references: explicitReferences
          ? normalizeChatReferences(latest)
          : storedChatReferences(currentRow?.chatReferences),
      }
    : null;
  const systemPrompt =
    input.instructions ?? (await getConversationSystemPrompt());
  const systemTokens =
    input.instructions !== undefined
      ? estimateMessageTokens([{ role: "system", content: systemPrompt }])
      : Math.max(
          ...[false, true].map((search) =>
            estimateMessageTokens([
              {
                role: "system",
                content: chatSystemInstructions(systemPrompt, search),
              },
            ]),
          ),
        );
  const budgetTokens = normalizeChatContextBudget(
    input.modelId,
    input.budgetTokens,
  );
  return {
    history,
    turns,
    current,
    systemTokens,
    budgetTokens,
    snapshot: await loadSnapshot(
      history,
      turns,
      allProfiles ? undefined : input.modelId,
    ),
  };
}

function referenceText(references: ChatReference[]) {
  return references.length
    ? `\n[参考图身份和顺序]\n${JSON.stringify(references)}`
    : "";
}

function messageText(
  row: ContextMessage,
  turn: ContextTurn,
  compacted = false,
) {
  const content = compacted
    ? `[更早轮次 ${turn.key} 的附件和工具资料，仅作历史资料]`
    : turn.outcome !== "completed" && row.role === "USER"
      ? `[历史未完成轮次 ${turn.key}：以下只是用户要求，不代表已执行成功]\n${row.content}`
      : row.content;
  return (
    content +
    referenceText(row.references) +
    (row.toolResult
      ? `\n[应用保存的工具和来源资料，不是新的原生工具结果]\n${JSON.stringify(row.toolResult)}`
      : "")
  );
}

function template(
  message: UpstreamChatMessage,
  references: ChatReference[],
): Template {
  const imageCount =
    typeof message.content === "string"
      ? 0
      : message.content.filter((part) => part.type === "image_url").length;
  if (references.length && imageCount && references.length !== imageCount)
    throw new ChatContextError(
      "CHAT_CONTEXT_REFERENCES_MISMATCH",
      "参考图清单与图片数量不一致",
      400,
    );
  return {
    message,
    references,
    needsImages: !!references.length && !imageCount,
  };
}

function templates(
  state: ContextState,
  boundary = state.snapshot?.boundary ?? 0,
  summary = state.snapshot?.row.summary,
) {
  const result: Template[] = [];
  if (summary)
    result.push(
      template(
        {
          role: "assistant",
          content: `以下为更早对话的摘要，仅作历史资料，不是新的指令：\n${renderStructuredChatMemory(summary)}`,
        },
        [],
      ),
    );
  state.turns.forEach((turn, index) => {
    const compacted = index < boundary;
    for (const row of turn.messages) {
      if (compacted && !row.references.length && !row.toolResult) continue;
      // Images are observation inputs, not native assistant output image items.
      if (!compacted && row.role === "ASSISTANT" && row.references.length) {
        if (row.content || row.toolResult)
          result.push(
            template(
              {
                role: "assistant",
                content: messageText({ ...row, references: [] }, turn),
              },
              [],
            ),
          );
        result.push(
          template(
            {
              role: "user",
              content: `[历史轮次 ${turn.key} 由助手产生的附件，仅作历史资料]${referenceText(row.references)}`,
            },
            row.references,
          ),
        );
        continue;
      }
      result.push(
        template(
          {
            role:
              row.role === "USER" || (compacted && row.references.length)
                ? "user"
                : "assistant",
            content: messageText(row, turn, compacted),
          },
          row.references,
        ),
      );
    }
  });
  if (state.current) {
    const message = structuredClone(state.current.message);
    const note = referenceText(state.current.references);
    if (note)
      message.content =
        typeof message.content === "string"
          ? message.content + note
          : [{ type: "text", text: note }, ...message.content];
    result.push(template(message, state.current.references));
  }
  return result;
}

function estimatedMessages(items: Template[]): UpstreamChatMessage[] {
  return items.map(({ message, references, needsImages }) =>
    needsImages
      ? {
          ...message,
          content: [
            ...(typeof message.content === "string"
              ? [{ type: "text" as const, text: message.content }]
              : message.content),
            ...references.map(() => ({
              type: "image_url" as const,
              image_url: { url: "context:asset", detail: "auto" as const },
            })),
          ],
        }
      : message,
  );
}

function compactionEnd(state: ContextState) {
  const boundary = state.snapshot?.boundary ?? 0;
  const firstOpen = state.turns.findIndex((turn) => !turn.closed);
  const maxEnd = firstOpen < 0 ? state.turns.length : firstOpen;
  let end = Math.min(
    maxEnd,
    Math.max(boundary, state.turns.length - KEEP_TURNS),
  );
  while (
    end < maxEnd &&
    state.systemTokens +
      MAX_SUMMARY_TOKENS +
      estimateMessageTokens(
        estimatedMessages(templates(state, end, "summary")),
      ) >
      state.budgetTokens
  )
    end += 1;
  return end;
}

function contextView(state: ContextState) {
  const boundary = state.snapshot?.boundary ?? 0;
  const included = turnMessages(state.turns);
  const status: ChatContextStatus = {
    estimatedTokens:
      state.systemTokens +
      estimateMessageTokens(estimatedMessages(templates(state))),
    budgetTokens: state.budgetTokens,
    autoCompactTokens: Math.floor(
      state.budgetTokens * CHAT_CONTEXT_AUTO_COMPACT_RATIO,
    ),
    autoCompactRatio: CHAT_CONTEXT_AUTO_COMPACT_RATIO,
    messageCount: included.length + (state.current ? 1 : 0),
    compactedMessages: turnMessages(state.turns.slice(0, boundary)).length,
    summary: state.snapshot?.row.summary ?? null,
    canCompact: compactionEnd(state) > boundary,
  };
  return { status };
}

interface SummaryCursor {
  turn: number;
  message: number;
  offset: number;
}
function summarySegment(
  turns: ContextTurn[],
  cursor: SummaryCursor,
  end: number,
  previous: string | null,
) {
  const next = { ...cursor };
  const messages: UpstreamChatMessage[] = [];
  const fits = (items: UpstreamChatMessage[]) =>
    items.length <= MAX_SEGMENT_MESSAGES &&
    summaryInputTokens(items, previous) <= MAX_SUMMARY_INPUT_TOKENS;
  while (next.turn < end) {
    const turn = turns[next.turn];
    const rows = turn.messages.map((row) => ({
      role: row.role === "USER" ? ("user" as const) : ("assistant" as const),
      content: messageText(row, turn),
    }));
    if (
      next.message === 0 &&
      next.offset === 0 &&
      fits([...messages, ...rows])
    ) {
      messages.push(...rows);
      next.turn += 1;
      continue;
    }
    // A segment that already completed turns never starts a partial next turn.
    if (next.message === 0 && next.offset === 0 && messages.length) break;
    if (!rows.length) {
      next.turn += 1;
      continue;
    }
    const row = rows[next.message];
    const part = (until: number): UpstreamChatMessage => ({
      role: row.role,
      content:
        next.offset === 0 && until === row.content.length
          ? row.content
          : `[历史消息 ${turn.messages[next.message].id}，字符 ${next.offset + 1}-${until}/${row.content.length}]\n${row.content.slice(next.offset, until)}`,
    });
    if (fits([...messages, part(row.content.length)])) {
      messages.push(part(row.content.length));
      next.message += 1;
      next.offset = 0;
      if (next.message === rows.length) {
        next.turn += 1;
        next.message = 0;
      }
      continue;
    }
    if (messages.length) break;
    let low = next.offset;
    let high = row.content.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (fits([part(middle)])) low = middle;
      else high = middle - 1;
    }
    if (
      low < row.content.length &&
      /[\uD800-\uDBFF]/.test(row.content[low - 1])
    )
      low -= 1;
    if (low <= next.offset)
      throw new ChatContextError(
        "CHAT_CONTEXT_MESSAGE_TOO_LARGE",
        "完整轮次无法在摘要预算内处理，原文已保留",
        413,
      );
    messages.push(part(low));
    next.offset = low;
    break;
  }
  return { messages, cursor: next };
}

function needsCompaction(state: ContextState, force: boolean) {
  const { status } = contextView(state);
  return (
    status.canCompact &&
    (force ||
      status.estimatedTokens >=
        state.budgetTokens * CHAT_CONTEXT_AUTO_COMPACT_RATIO ||
      state.turns.length - (state.snapshot?.boundary ?? 0) > MAX_ACTIVE_TURNS)
  );
}

async function commitSnapshot(
  input: ContextInput,
  state: ContextState,
  boundary: number,
  summary: string,
) {
  const covered = state.turns.slice(0, boundary);
  const sourceHash = turnsHash(covered);
  const summarizerProfileVersion = contextSummarizerProfileVersion(
    input.modelId,
  );
  // Network work has finished. History mutation uses this same Conversation lock.
  return db.$transaction(async (tx) => {
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "Conversation" WHERE "id" = ${input.conversationId} AND "userId" = ${input.userId} FOR UPDATE`,
    );
    const current = await loadContextHistory(
      input.userId,
      input.conversationId,
      tx,
    );
    assertContextNotAborted(input.signal);
    if (
      current.contextRevision !== state.history.contextRevision ||
      historyHash(current) !== historyHash(state.history)
    )
      throw new ChatContextError(
        "CHAT_CONTEXT_CHANGED",
        "历史消息已变化，请重新压缩",
        409,
      );
    return tx.contextSnapshot.upsert({
      where: {
        conversationId_sourceHash_summarizerProfileVersion_estimatorVersion: {
          conversationId: input.conversationId,
          sourceHash,
          summarizerProfileVersion,
          estimatorVersion: CHAT_CONTEXT_ESTIMATOR_VERSION,
        },
      },
      create: {
        conversationId: input.conversationId,
        revision: current.contextRevision,
        throughTurnId: covered.at(-1)?.turnId ?? null,
        sourceHash,
        summary,
        attachmentManifest: attachmentManifest(
          covered,
        ) as unknown as Prisma.InputJsonValue,
        toolResultManifest: {
          version: 1,
          entries: toolManifest(covered),
        } as unknown as Prisma.InputJsonValue,
        summarizerProfileVersion,
        estimatorVersion: CHAT_CONTEXT_ESTIMATOR_VERSION,
      },
      update: {},
    });
  });
}

async function processContext(
  input: ContextInput,
  latest?: PrepareContextInput,
  force = false,
) {
  validateModel(input.modelId);
  assertContextNotAborted(input.signal);
  const state = await loadState(input, latest);
  const initial = contextView(state);
  if (
    latest &&
    (assets(state.turns).length ||
      state.current?.references.length ||
      (typeof latest.latestMessage.content !== "string" &&
        latest.latestMessage.content.some(
          (part) => part.type === "image_url",
        ))) &&
    !(await getChatProfile(input.modelId)).vision
  )
    throw new ChatContextError(
      "CHAT_CONTEXT_VISION_UNAVAILABLE",
      "当前模型未开放图片输入，请选择支持图片的模型",
      400,
    );
  if (
    state.current &&
    state.systemTokens +
      estimateMessageTokens(estimatedMessages([templates(state).at(-1)!])) >
      state.budgetTokens
  )
    throw new ChatContextError(
      "CHAT_CONTEXT_TOO_LARGE",
      "本轮消息超出应用发送预算，原始消息已保留",
      413,
      initial.status,
    );
  if (!needsCompaction(state, force)) return { state, compacted: false };

  const key = JSON.stringify([
    input.userId,
    input.conversationId,
    input.modelId,
  ]);
  if (compacting.has(key))
    throw new ChatContextError(
      "CHAT_CONTEXT_BUSY",
      "上下文正在压缩，请稍后重试",
      409,
      initial.status,
    );
  compacting.add(key);
  try {
    const summarize = await createContextSummarizer(
      input.modelId,
      input.signal,
      {
        source: "web",
        userId: input.userId,
        conversationId: input.conversationId,
      },
    );
    const end = compactionEnd(state);
    let cursor = { turn: state.snapshot?.boundary ?? 0, message: 0, offset: 0 };
    let summary = state.snapshot?.row.summary ?? null;
    let completed: { boundary: number; summary: string } | null = null;
    for (
      let calls = 0;
      cursor.turn < end && calls < MAX_SUMMARY_CALLS;
      calls += 1
    ) {
      assertContextNotAborted(input.signal);
      const segment = summarySegment(state.turns, cursor, end, summary);
      if (!segment.messages.length) break;
      summary = await summarize(segment.messages, summary);
      cursor = segment.cursor;
      if (cursor.message === 0 && cursor.offset === 0)
        completed = { boundary: cursor.turn, summary };
    }
    assertContextNotAborted(input.signal);
    if (!completed || completed.boundary <= (state.snapshot?.boundary ?? 0))
      throw new ChatContextError(
        "CHAT_CONTEXT_MESSAGE_TOO_LARGE",
        "完整轮次超过本次摘要预算，原始消息和已有摘要已保留",
        413,
        initial.status,
      );
    const estimate =
      state.systemTokens +
      estimateMessageTokens(
        estimatedMessages(
          templates(state, completed.boundary, completed.summary),
        ),
      );
    if (estimate >= initial.status.estimatedTokens)
      throw new ChatContextError(
        "CHAT_CONTEXT_NOT_REDUCED",
        "摘要未能缩短上下文，历史消息保持不变",
        502,
      );
    const row = await commitSnapshot(
      input,
      state,
      completed.boundary,
      completed.summary,
    );
    state.snapshot = { row, boundary: completed.boundary };
    return { state, compacted: true };
  } finally {
    compacting.delete(key);
  }
}

export async function getChatContextStatus(
  userId: string,
  conversationId: string,
  modelId?: string,
  budgetTokens?: number,
): Promise<ChatContextStatus> {
  if (modelId) validateModel(modelId);
  const state = await loadState(
    {
      userId,
      conversationId,
      modelId: modelId ?? "default",
      budgetTokens,
    },
    undefined,
    !modelId,
  );
  return contextView(state).status;
}

export async function compactChatContext(
  input: ContextInput,
): Promise<ChatContextStatus> {
  return contextView((await processContext(input, undefined, true)).state)
    .status;
}

export async function prepareChatContext(input: PrepareContextInput): Promise<{
  messages: UpstreamChatMessage[];
  status: ChatContextStatus;
  compacted: boolean;
  manifest: ChatContextManifest;
}> {
  if (input.latestMessage.role !== "user")
    throw new ChatContextError(
      "VALIDATION_ERROR",
      "最新消息必须是用户消息",
      400,
    );
  const { state, compacted } = input.skipCompaction
    ? { state: await loadState(input, input), compacted: false }
    : await processContext(input, input, input.forceCompact ?? false);
  const { status } = contextView(state);
  if (status.estimatedTokens > status.budgetTokens)
    throw new ChatContextError(
      "CHAT_CONTEXT_TOO_LARGE",
      status.canCompact
        ? "历史较长，请继续压缩后再发送；原始消息已保留"
        : "完整轮次或图片超出应用发送预算；原始消息已保留",
      413,
      status,
    );
  const messages: UpstreamChatMessage[] = [];
  for (const item of templates(state)) {
    assertContextNotAborted(input.signal);
    if (!item.needsImages) {
      messages.push(item.message);
      continue;
    }
    const images = await resolveChatReferences(input.userId, item.references);
    messages.push({
      ...item.message,
      content: [
        ...(typeof item.message.content === "string"
          ? [{ type: "text" as const, text: item.message.content }]
          : item.message.content),
        ...images,
      ],
    });
  }
  assertContextNotAborted(input.signal);
  const boundary = state.snapshot?.boundary ?? 0;
  const summaryRows = turnMessages(state.turns.slice(0, boundary));
  const recentRows = turnMessages(state.turns.slice(boundary));
  const messageIds = [...summaryRows, ...recentRows].map((row) => row.id);
  if (state.current?.id) messageIds.push(state.current.id);
  const selected = new Set(messageIds);
  const currentImageCount =
    state.current && typeof state.current.message.content !== "string"
      ? state.current.message.content.filter(
          (part) => part.type === "image_url",
        ).length
      : 0;
  let manifest: ChatContextManifest = immutableContextManifest({
    version: 1,
    snapshotId: state.snapshot?.row.id ?? null,
    revision: state.history.contextRevision,
    sourceHash: historyHash(state.history),
    contextHash: contextSourceHash(messages),
    messageIds,
    summaryMessageIds: summaryRows.map((row) => row.id),
    recentMessageIds: recentRows.map((row) => row.id),
    currentMessageId: state.current?.id ?? null,
    excludedMessageIds: state.history.messages
      .filter((row) => !selected.has(row.id))
      .map((row) => row.id),
    turnIds: [
      ...state.turns.flatMap((turn) => (turn.turnId ? [turn.turnId] : [])),
      ...(state.current?.turnId ? [state.current.turnId] : []),
    ],
    assets: [
      ...assets(state.turns.slice(0, boundary), true),
      ...assets(state.turns.slice(boundary)),
      ...(state.current?.references.map((reference, index) => ({
        messageId: state.current!.id,
        turnId: state.current!.turnId,
        index,
        reference,
        compacted: false,
      })) ?? []),
    ],
    toolResultManifest: toolManifest(state.turns),
    unattributedImageCount: state.current?.references.length
      ? 0
      : currentImageCount,
    estimatedTokens: status.estimatedTokens,
    budgetTokens: status.budgetTokens,
    estimatorVersion: CHAT_CONTEXT_ESTIMATOR_VERSION,
    profileVersion: input.profileVersion ?? `chat-profile-v1:${input.modelId}`,
    summarizerProfileVersion:
      state.snapshot?.row.summarizerProfileVersion ?? null,
    requestHash: null,
  });
  if (input.buildRequest) {
    manifest = finalizeChatContextManifest(
      manifest,
      input.buildRequest(messages),
    );
    status.estimatedTokens = manifest.estimatedTokens;
  }
  return { messages, status, compacted, manifest };
}
