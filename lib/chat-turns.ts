import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { conversationAccessWhere } from "@/lib/conversation-access";
import { getChatProfile } from "@/lib/chat-profiles";
import { debitChatCredits } from "@/lib/chat-billing";
import {
  chatInputTokenUpperBound,
  chatTokenCost,
  chatTokenReserve,
  normalizeChatTokenUsage,
  readChatTokenPricingSnapshot,
} from "@/lib/chat-token-billing";
import { prepareChatContext } from "@/lib/chat-context";
import {
  ChatContextError,
  COMPACTION_FALLBACK_CODES,
} from "@/lib/chat-context-types";
import { normalizeChatContextBudget } from "@/lib/chat-context-types";
import {
  anthropicMessagesRequestBody,
  chatCompletionsRequestBody,
  geminiUpstreamModel,
  responsesRequestBody,
  type UpstreamChatMessage,
} from "@/lib/chat-upstream";
import {
  closeChatReserve,
  operationHash,
  recordChatReserve,
} from "@/lib/chat-credit-ledger";
import {
  assertChatRuntimeAdmission,
  CHAT_TASK_PROTOCOL_VERSION,
} from "@/lib/chat-runtime-config";
import { getConversationSystemPrompt } from "@/lib/ai-config";
import {
  chatSystemInstructions,
  chatTalkInstructions,
  chatTimeInstruction,
} from "@/lib/chat-instructions";
import {
  CHAT_MODEL_IDS,
  ACCEPTED_CHAT_MODEL_IDS,
  isTokenPricedChatModel,
  REASONING_EFFORTS,
  type ReasoningEffort,
} from "@/lib/chat-model-options";
import {
  chatIsTerminal,
  CHAT_INPUT_MAX_CHARS,
  type ChatTurnView,
  type ChatTurnEvent,
  type ChatTerminalStatus,
} from "@/lib/chat-turn-types";
import type { ChatSearchSource } from "@/lib/chat-search";
import {
  chatReferencesSchema,
  normalizeChatReferences,
} from "@/lib/chat-references-types";
import { resolveChatReferences } from "@/lib/chat-references";
import {
  CONVERSATION_MODES,
  conversationModeInstruction,
  DEFAULT_CONVERSATION_MODE,
  isShortConversationMode,
  latestMessageSuffix,
  LISTEN_SILENCE_STREAK_MAX,
  normalizeConversationMode,
  SHORT_MODE_MAX_OUTPUT_TOKENS,
  TALK_REASONING_EFFORT,
  trailingSilenceStreak,
  type ConversationMode,
} from "@/lib/chat-conversation-mode";
import {
  CHAT_TOOL_MAX_REQUESTS,
  chatRequestTools,
  chatSearchAsTool,
} from "@/lib/chat-tool-set";
import {
  chatCreditSettlement,
  chatReplyErrorMessage,
} from "@/lib/turn-credit-types";

export const chatTurnSchema = z
  .object({
    conversationId: z.string().min(1).max(128),
    clientRequestId: z.string().min(8).max(128),
    content: z.string().trim().min(1).max(CHAT_INPUT_MAX_CHARS),
    modelId: z.enum(ACCEPTED_CHAT_MODEL_IDS),
    contextBudgetTokens: z.number().int().optional(),
    reasoningEffort: z.enum(REASONING_EFFORTS).optional(),
    webSearch: z.boolean().default(false),
    referenceImageKeys: z.array(z.string().min(1).max(512)).max(8).default([]),
    sourceImageIds: z.array(z.string().min(1).max(128)).max(8).default([]),
    imageModelId: z.string().min(1).max(128).optional(),
    imageSize: z.string().min(1).max(32).optional(),
    imageQuality: z.string().min(1).max(32).optional(),
    imageOutputFormat: z.string().min(1).max(16).optional(),
    imageN: z.number().int().min(1).max(4).optional(),
    references: chatReferencesSchema.optional(),
    // Admin preview; ignored (treated as detail) for everyone else.
    conversationMode: z.enum(CONVERSATION_MODES).optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.referenceImageKeys.length + input.sourceImageIds.length <= 8,
  );

export class ChatTurnError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

function readActivityHistory(value: unknown): string[] {
  const history = object(value).activityHistory;
  return Array.isArray(history)
    ? history.filter((item): item is string => typeof item === "string")
    : [];
}

export async function appendChatEvent(
  tx: Prisma.TransactionClient,
  turnId: string,
  attemptId: string,
  type: string,
  payload: unknown,
) {
  const turn = await tx.chatTurn.update({
    where: { id: turnId },
    data: { nextSeq: { increment: 1 } },
    select: { nextSeq: true },
  });
  return tx.chatEvent.create({
    data: {
      turnId,
      attemptId,
      seq: turn.nextSeq,
      type,
      payload: json(payload),
    },
  });
}

export async function appendActiveChatEvent(
  tx: Prisma.TransactionClient,
  input: {
    turnId: string;
    attemptId: string;
    executionToken: string;
    type: string;
    payload: unknown;
  },
) {
  await lockTurn(tx, input.turnId);
  await lockAttempt(tx, input.attemptId);
  const attempt = await tx.chatAttempt.findFirst({
    where: {
      id: input.attemptId,
      turnId: input.turnId,
      executionToken: input.executionToken,
      status: "running",
      turn: { activeAttemptId: input.attemptId },
    },
    select: { id: true },
  });
  if (!attempt) return false;
  await appendChatEvent(
    tx,
    input.turnId,
    input.attemptId,
    input.type,
    input.payload,
  );
  return true;
}

export async function getChatTurnByRequest(
  userId: string,
  conversationId: string,
  clientRequestId: string,
  deviceId?: string | null,
) {
  const receipt = await db.chatRequestReceipt.findUnique({
    where: {
      userId_scope_clientRequestId: {
        userId,
        scope: "create",
        clientRequestId,
      },
    },
  });
  if (!receipt || receipt.conversationId !== conversationId) return null;
  if (receipt.contentClearedAt)
    throw new ChatTurnError(
      "CONTENT_CLEARED",
      "这次请求的聊天内容已清空，不会再次执行",
      410,
    );
  return getChatTurn(userId, receipt.turnId, true, deviceId);
}

async function receiptTurn(
  userId: string,
  scope: string,
  clientRequestId: string,
  inputHash: string,
  deviceId?: string | null,
) {
  const receipt = await db.chatRequestReceipt.findUnique({
    where: { userId_scope_clientRequestId: { userId, scope, clientRequestId } },
  });
  if (!receipt) return null;
  if (receipt.inputHash !== inputHash)
    throw new ChatTurnError(
      "IDEMPOTENCY_CONFLICT",
      "同一请求标识不能用于不同操作",
      409,
    );
  if (receipt.contentClearedAt)
    throw new ChatTurnError(
      "CONTENT_CLEARED",
      "这次请求的聊天内容已清空，不会再次执行",
      410,
    );
  return getChatTurn(userId, receipt.turnId, true, deviceId);
}

export function serializeChatEvent(row: {
  turnId: string;
  attemptId: string;
  seq: number;
  type: string;
  payload: unknown;
}): ChatTurnEvent {
  return {
    v: 1,
    turnId: row.turnId,
    attemptId: row.attemptId,
    seq: row.seq,
    type: row.type,
    payload: object(row.payload),
  };
}

export async function getChatTurn(
  userId: string,
  id: string,
  reconcile = true,
  deviceId?: string | null,
): Promise<ChatTurnView> {
  const turn = await db.$transaction(
    (tx) =>
      tx.chatTurn.findFirst({
        where: {
          id,
          userId,
          conversation: {
            archivedAt: null,
            ...conversationAccessWhere(userId, deviceId),
          },
        },
        include: { attempts: { orderBy: { ordinal: "desc" }, take: 1 } },
      }),
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  if (!turn || !turn.attempts[0])
    throw new ChatTurnError("NOT_FOUND", "对话任务不存在", 404);
  const attempt = turn.attempts[0];
  if (reconcile && !chatIsTerminal(attempt.status)) {
    const [clock] = await db.$queryRaw<
      Array<{ now: Date }>
    >`SELECT CURRENT_TIMESTAMP AS "now"`;
    const now = clock.now;
    const threshold = new Date(now.getTime() - 60_000);
    const lastActive =
      attempt.status === "queued"
        ? attempt.createdAt
        : (attempt.heartbeatAt ?? attempt.startedAt ?? attempt.createdAt);
    const queueExpired =
      attempt.status === "queued" &&
      attempt.queueDeadline &&
      attempt.queueDeadline <= now;
    if (
      queueExpired ||
      (attempt.status === "running" && lastActive < threshold)
    ) {
      await finishChatAttempt({
        turnId: turn.id,
        attemptId: attempt.id,
        status: "interrupted",
        expectedStatus: attempt.status,
        ...(queueExpired
          ? { queueExpiredBefore: now }
          : { staleBefore: threshold }),
        error: {
          code: queueExpired ? "QUEUE_TIMEOUT" : "EXECUTION_LEASE_LOST",
          publicMessage: queueExpired
            ? "排队等待超时，文字回复未收费；可以稍后重试"
            : "文字回复已中断，已有内容已保存，文字回复未收费；可以重新生成回复",
        },
      });
      return getChatTurn(userId, id, false);
    }
  }
  const error = object(attempt.error);
  const assistant = db.conversationMessage
    ? await db.conversationMessage.findFirst({
        where: { chatAttemptId: attempt.id, role: "ASSISTANT" },
        select: { generationId: true },
      })
    : null;
  return {
    id: turn.id,
    conversationId: turn.conversationId,
    modelId: turn.modelId,
    status: attempt.status,
    attemptId: attempt.id,
    attemptNumber: attempt.ordinal,
    text: attempt.rawText,
    sources: Array.isArray(attempt.sources)
      ? (attempt.sources as unknown as ChatSearchSource[])
      : [],
    usage: attempt.usage ? object(attempt.usage) : null,
    error: attempt.error
      ? {
          message:
            typeof error.publicMessage === "string"
              ? chatReplyErrorMessage(error.publicMessage)
              : "本次回复未完成，已保存收到的内容",
          code: typeof error.code === "string" ? error.code : undefined,
        }
      : null,
    priceCredits: turn.priceCredits,
    chargedCredits: turn.chargedCredits,
    billingState: attempt.billingState,
    billing: chatCreditSettlement({
      billingState: attempt.billingState,
      chargedCredits: turn.chargedCredits,
      heldCredits: attempt.heldCredits,
    }),
    lastSeq: turn.nextSeq,
    activity: attempt.activity,
    activityHistory: readActivityHistory(attempt.parts),
    parts: attempt.parts,
    timings: {
      ...object(attempt.timings),
      first_text_sent_at: attempt.firstTextSentAt?.toISOString() ?? null,
      first_text_rendered_at:
        attempt.firstTextRenderedAt?.toISOString() ?? null,
    },
    createdAt: attempt.createdAt.toISOString(),
    startedAt: attempt.startedAt?.toISOString() ?? null,
    protocolVersion: attempt.protocolVersion,
    ...(assistant?.generationId
      ? { generationId: assistant.generationId }
      : {}),
  };
}

async function lockTurn(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw(
    Prisma.sql`SELECT "id" FROM "ChatTurn" WHERE "id" = ${id} FOR UPDATE`,
  );
}

async function lockAttempt(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw(
    Prisma.sql`SELECT "id" FROM "ChatAttempt" WHERE "id" = ${id} FOR UPDATE`,
  );
}

export async function clearChatConversationContent(
  tx: Prisma.TransactionClient,
  conversationId: string,
  userId: string,
) {
  await assertChatConversationIdle(tx, conversationId, userId);
  await tx.chatRequestReceipt.updateMany({
    where: { conversationId, userId },
    data: { contentClearedAt: new Date() },
  });
  await tx.contextSnapshot.deleteMany({ where: { conversationId } });
  const removed = await tx.conversationMessage.deleteMany({
    where: { conversationId },
  });
  await tx.chatTurn.deleteMany({ where: { conversationId } });
  await tx.conversation.update({
    where: { id: conversationId },
    data: { contextRevision: { increment: 1 }, lastMessageAt: new Date() },
  });
  return removed;
}

export async function assertChatConversationIdle(
  tx: Prisma.TransactionClient,
  conversationId: string,
  userId?: string,
  deviceId?: string | null,
) {
  await tx.$queryRaw(
    Prisma.sql`SELECT "id" FROM "Conversation" WHERE "id" = ${conversationId} FOR UPDATE`,
  );
  if (
    userId &&
    !(await tx.conversation.findFirst({
      where: {
        id: conversationId,
        archivedAt: null,
        ...conversationAccessWhere(userId, deviceId),
      },
      select: { id: true },
    }))
  )
    throw new ChatTurnError("NOT_FOUND", "对话不存在", 404);
  if (
    await tx.chatTurn.findUnique({
      where: { activeConversationId: conversationId },
    })
  )
    throw new ChatTurnError(
      "CHAT_TURN_BUSY",
      "请先停止或等待当前回复完成，再修改对话历史",
      409,
    );
}

async function assertChatConcurrency(
  tx: Prisma.TransactionClient,
  userId: string,
) {
  const user = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: { concurrentLimit: true },
  });
  if (
    (await tx.chatTurn.count({
      where: { userId, activeConversationId: { not: null } },
    })) >= Math.max(1, user.concurrentLimit)
  )
    throw new ChatTurnError(
      "CHAT_TURN_BUSY",
      "同时进行的对话已达上限，请先完成或停止其他任务",
      409,
    );
}

/**
 * The mode actually used for a turn: only admins may leave detail (preview).
 * Listen mode counts the trailing silent replies so a long silence ends in a
 * recap.
 */
async function resolveConversationMode(
  userId: string,
  conversationId: string,
  requested: ConversationMode | undefined,
): Promise<{ mode: ConversationMode; instruction: string }> {
  const mode = normalizeConversationMode(requested);
  if (!isShortConversationMode(mode)) return { mode, instruction: "" };
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  if (user?.role !== "ADMIN")
    return { mode: DEFAULT_CONVERSATION_MODE, instruction: "" };
  let silenceStreak = 0;
  if (mode === "listen") {
    const recent = await db.conversationMessage.findMany({
      where: { conversationId, role: "ASSISTANT" },
      orderBy: { createdAt: "desc" },
      take: LISTEN_SILENCE_STREAK_MAX,
      select: { content: true },
    });
    silenceStreak = trailingSilenceStreak(recent.map((row) => row.content));
  }
  return {
    mode,
    instruction: conversationModeInstruction(mode, { silenceStreak }),
  };
}

export async function createChatTurn(
  userId: string,
  input: z.infer<typeof chatTurnSchema>,
  deviceId?: string | null,
) {
  const { clientRequestId, ...content } = input;
  const inputHash = createHash("sha256")
    .update(JSON.stringify(content))
    .digest("hex");
  const existing = await receiptTurn(
    userId,
    "create",
    clientRequestId,
    inputHash,
    deviceId,
  );
  if (existing) return existing;
  await assertChatRuntimeAdmission(userId, input.modelId);
  const config = await getChatProfile(input.modelId);
  const contextBudgetTokens = normalizeChatContextBudget(
    input.modelId,
    input.contextBudgetTokens,
  );
  const tokenPricing = readChatTokenPricingSnapshot(
    "tokenPricing" in config ? config.tokenPricing : undefined,
  );
  const references = normalizeChatReferences(input);
  if (!config.enabled || !config.apiKey)
    throw new ChatTurnError("SERVICE_UNAVAILABLE", "所选对话模型未配置", 503);
  if (input.webSearch && !config.webSearch)
    throw new ChatTurnError("VALIDATION_ERROR", "当前模型不支持联网");
  if (input.reasoningEffort && !config.efforts.includes(input.reasoningEffort))
    throw new ChatTurnError("VALIDATION_ERROR", "当前模型尚未开放这个思考强度");
  if (!config.vision && references.length)
    throw new ChatTurnError(
      "VALIDATION_ERROR",
      "当前模型的图片输入尚未验证，请先移除参考图",
    );
  if (references.length) {
    try {
      await resolveChatReferences(userId, references);
    } catch {
      throw new ChatTurnError(
        "REFERENCE_NOT_FOUND",
        "参考图不存在、无法读取或不属于当前账号，请重新选择",
        400,
      );
    }
  }
  const conversationMode = await resolveConversationMode(
    userId,
    input.conversationId,
    input.conversationMode,
  );
  const modeInstruction = conversationMode.instruction;
  // 对谈 / 倾听 are quick spoken turns: a short contract, three tools, no
  // search (the relay's search tool alone doubles the input) and a fixed low
  // effort, so each line costs about a third of a detail turn.
  const talk = isShortConversationMode(conversationMode.mode);
  const webSearch = input.webSearch && !talk;
  const storedContent = talk ? { ...content, webSearch: false } : content;
  // The Anthropic relay answers its own web_search tool with canned text, so
  // those models search through the application tool instead.
  const searchAsTool = chatSearchAsTool(config.transport, webSearch);
  const requestTools = chatRequestTools(config.transport, {
    searchTool: searchAsTool,
    talk,
  });
  const systemPrompt = await getConversationSystemPrompt();
  const instructions = talk
    ? chatTalkInstructions(systemPrompt)
    : chatSystemInstructions(systemPrompt, webSearch, false, true, searchAsTool);
  const runtimeTime = chatTimeInstruction();
  const effort =
    talk && config.efforts.includes(TALK_REASONING_EFFORT)
      ? TALK_REASONING_EFFORT
      : (input.reasoningEffort ?? config.efforts[0] ?? null);
  let contextRevision: number | null = null;
  let tokenRequestLimits:
    | { maxInputTokens: number; maxOutputTokens: number; maxRequests: number }
    | undefined;
  if (tokenPricing) {
    const buildRequest = (messages: UpstreamChatMessage[]) =>
      config.transport === "responses_sse"
        ? responsesRequestBody(
            geminiUpstreamModel(config.model, effort as ReasoningEffort),
            messages,
            instructions,
            effort as ReasoningEffort,
            {
              webSearch,
              maxOutputTokens: tokenPricing.maxOutputTokens,
              tools: requestTools,
            },
          )
        : config.transport === "anthropic_messages_sse"
          ? anthropicMessagesRequestBody(
              config.model,
              messages,
              instructions,
              effort as ReasoningEffort,
              {
                // Same as the worker: search runs as the search_web tool.
                webSearch: false,
                maxOutputTokens: tokenPricing.maxOutputTokens,
                tools: requestTools,
              },
            )
          : chatCompletionsRequestBody(config.model, messages, instructions, {
              effort: effort as ReasoningEffort,
              maxOutputTokens: tokenPricing.maxOutputTokens,
              includeUsage: true,
              tools: requestTools,
            });
    const contextInput = {
      userId,
      conversationId: input.conversationId,
      modelId: input.modelId,
      latestMessage: {
        role: "user" as const,
        content: `${input.content}${latestMessageSuffix({ modeInstruction, runtimeTime })}`,
      },
      references,
      instructions,
      buildRequest,
      budgetTokens: contextBudgetTokens,
    };
    // Compaction runs before the turn is created so the 85% threshold really
    // compacts. A failed summary must not block a turn that still fits.
    const prepared = await prepareChatContext(contextInput).catch(
      async (error: unknown) => {
        if (
          !(error instanceof ChatContextError) ||
          !COMPACTION_FALLBACK_CODES.has(error.code)
        )
          throw error;
        return prepareChatContext({ ...contextInput, skipCompaction: true });
      },
    );
    const bound = chatInputTokenUpperBound(buildRequest(prepared.messages));
    if (bound > tokenPricing.maxInputTokens)
      throw new ChatTurnError(
        "CHAT_CONTEXT_TOO_LARGE",
        "请求超出计费输入上限，请压缩上下文后重试",
        413,
      );
    tokenRequestLimits = {
      maxInputTokens: tokenPricing.maxInputTokens,
      maxOutputTokens: isShortConversationMode(conversationMode.mode)
        ? Math.min(tokenPricing.maxOutputTokens, SHORT_MODE_MAX_OUTPUT_TOKENS)
        : tokenPricing.maxOutputTokens,
      maxRequests: CHAT_TOOL_MAX_REQUESTS,
    };
    // Up to CHAT_TOOL_MAX_REQUESTS requests (tool rounds plus the final
    // reply), but the reserve only covers three request-equivalents of input
    // and two full outputs. The first request is `bound`; each continuation
    // may add tool results (a read_url page is ~6000 characters), so two
    // allowances of bound + 32k cover two or three follow-ups of a normal
    // context. The worker spends against this budget per request: it caps
    // each request's max_tokens by the remaining output and drops every tool
    // from the request that has no room for another round, which forces a
    // final answer instead of exceeding the reserve.
    const continuationInput = Math.min(
      tokenPricing.maxInputTokens,
      bound + 32_768,
    );
    tokenPricing.maxInputTokens = bound + 2 * continuationInput;
    tokenPricing.maxOutputTokens *= 2;
    contextRevision = prepared.manifest.revision;
  }
  const reserveCredits = tokenPricing
    ? chatTokenReserve(tokenPricing)
    : config.credits;
  try {
    const turnId = await db.$transaction(
      async (tx) => {
        // Serialize both same-key submissions and competing turns in this conversation.
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "Conversation" WHERE "id" = ${input.conversationId} AND "userId" = ${userId} FOR UPDATE`,
        );
        const owned = await tx.conversation.findFirst({
          where: {
            id: input.conversationId,
            archivedAt: null,
            ...conversationAccessWhere(userId, deviceId),
          },
          select: { id: true, contextRevision: true },
        });
        if (!owned) throw new ChatTurnError("NOT_FOUND", "对话不存在", 404);
        const replay = await tx.chatRequestReceipt.findUnique({
          where: {
            userId_scope_clientRequestId: {
              userId,
              scope: "create",
              clientRequestId,
            },
          },
        });
        if (replay) {
          if (replay.inputHash !== inputHash)
            throw new ChatTurnError(
              "IDEMPOTENCY_CONFLICT",
              "同一请求标识不能用于不同消息",
              409,
            );
          if (replay.contentClearedAt)
            throw new ChatTurnError(
              "CONTENT_CLEARED",
              "这次请求的聊天内容已清空，不会再次执行",
              410,
            );
          return replay.turnId;
        }
        if (
          contextRevision !== null &&
          owned.contextRevision !== contextRevision
        )
          throw new ChatTurnError(
            "CHAT_CONTEXT_CHANGED",
            "历史消息已变化，请重新发送",
            409,
          );
        if (
          await tx.chatTurn.findUnique({
            where: { activeConversationId: input.conversationId },
          })
        )
          throw new ChatTurnError(
            "CHAT_TURN_BUSY",
            "此对话仍有任务运行，请等待完成或停止",
            409,
          );
        const admission = await assertChatRuntimeAdmission(
          userId,
          input.modelId,
          tx,
        );
        const [clock] = await tx.$queryRaw<
          Array<{ now: Date }>
        >`SELECT CURRENT_TIMESTAMP AS "now"`;
        if (!(await debitChatCredits(tx, userId, reserveCredits)).count)
          throw new ChatTurnError(
            "INSUFFICIENT_CREDITS",
            `可用余额不足，需要预留 ${reserveCredits} 积分`,
            402,
          );
        await assertChatConcurrency(tx, userId);
        const attemptId = randomUUID();
        const turn = await tx.chatTurn.create({
          data: {
            userId,
            conversationId: input.conversationId,
            clientRequestId,
            inputHash,
            input: json(storedContent),
            configSnapshot: json({
              model: config.model,
              baseUrl: config.baseUrl,
              transport: config.transport,
              ...(tokenPricing ? { tokenPricing } : {}),
              ...(tokenRequestLimits ? { tokenRequestLimits } : {}),
              contextBudgetTokens,
              instructions,
              runtimeTime,
              ...(modeInstruction
                ? { conversationMode: conversationMode.mode, modeInstruction }
                : {}),
              // The worker offers the same short tool list.
              ...(talk ? { talk: true } : {}),
              effort,
              profileVersion: operationHash({
                model: config.model,
                baseUrl: config.baseUrl,
                transport: config.transport,
                instructions,
                efforts: config.efforts,
                vision: config.vision,
                webSearch: config.webSearch,
                ...(tokenPricing ? { tokenPricing } : {}),
              }),
            }),
            modelId: input.modelId,
            priceCredits: reserveCredits,
            activeConversationId: input.conversationId,
            activeAttemptId: attemptId,
          },
        });
        await tx.chatAttempt.create({
          data: {
            id: attemptId,
            turnId: turn.id,
            ordinal: 1,
            heldCredits: reserveCredits,
            protocolVersion: CHAT_TASK_PROTOCOL_VERSION,
            queueDeadline: admission.queueTimeoutMs
              ? new Date(clock.now.getTime() + admission.queueTimeoutMs)
              : null,
            mode:
              config.transport === "responses_sse"
                ? "native_responses"
                : config.transport === "anthropic_messages_sse"
                  ? "native_anthropic"
                  : "chat_completions",
          },
        });
        await recordChatReserve(tx, {
          userId,
          turnId: turn.id,
          attemptId,
          amount: reserveCredits,
        });
        await tx.chatRequestReceipt.create({
          data: {
            userId,
            scope: "create",
            clientRequestId,
            inputHash,
            conversationId: input.conversationId,
            turnId: turn.id,
            attemptId,
          },
        });
        const now = new Date();
        await tx.conversationMessage.createMany({
          data: [
            {
              conversationId: input.conversationId,
              role: "USER",
              content: input.content,
              chatTurnId: turn.id,
              chatStatus: "completed",
              chatReferences: json(references),
              createdAt: now,
            },
            {
              conversationId: input.conversationId,
              role: "ASSISTANT",
              content: "",
              chatTurnId: turn.id,
              chatAttemptId: attemptId,
              chatStatus: "queued",
              createdAt: new Date(now.getTime() + 1),
            },
          ],
        });
        await tx.conversation.update({
          where: { id: input.conversationId },
          data: { lastMessageAt: now, contextRevision: { increment: 1 } },
        });
        await appendChatEvent(tx, turn.id, attemptId, "attempt.started", {
          status: "queued",
          mode:
            config.transport === "responses_sse"
              ? "native_responses"
              : config.transport === "anthropic_messages_sse"
                ? "native_anthropic"
                : "chat_completions",
          reservedCredits: reserveCredits,
        });
        return turn.id;
      },
      { timeout: 15_000 },
    );
    return getChatTurn(userId, turnId);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const replay = await receiptTurn(
        userId,
        "create",
        clientRequestId,
        inputHash,
      );
      if (replay) return replay;
      throw new ChatTurnError(
        "CHAT_TURN_BUSY",
        "已有对话请求，请刷新状态后重试",
        409,
      );
    }
    throw error;
  }
}

export async function finishChatAttempt(input: {
  turnId: string;
  attemptId: string;
  status: ChatTerminalStatus;
  executionToken?: string;
  text?: string;
  parts?: unknown;
  sources?: unknown;
  usage?: unknown;
  error?: unknown;
  expectedStatus?: string;
  staleBefore?: Date;
  queueExpiredBefore?: Date;
}) {
  return db.$transaction(
    async (tx) => {
      await lockTurn(tx, input.turnId);
      await lockAttempt(tx, input.attemptId);
      const turn = await tx.chatTurn.findUnique({
        where: { id: input.turnId },
      });
      const attempt = await tx.chatAttempt.findUnique({
        where: { id: input.attemptId },
      });
      if (
        !turn ||
        !attempt ||
        attempt.turnId !== turn.id ||
        turn.activeAttemptId !== attempt.id ||
        chatIsTerminal(attempt.status)
      )
        return false;
      if (
        input.executionToken &&
        attempt.executionToken !== input.executionToken
      )
        return false;
      if (input.expectedStatus && attempt.status !== input.expectedStatus)
        return false;
      if (
        input.queueExpiredBefore &&
        (attempt.status !== "queued" ||
          !attempt.queueDeadline ||
          attempt.queueDeadline > input.queueExpiredBefore)
      )
        return false;
      if (
        input.staleBefore &&
        (attempt.heartbeatAt ?? attempt.startedAt ?? attempt.createdAt) >=
          input.staleBefore
      )
        return false;
      let status = input.status;
      const text = input.text ?? attempt.rawText;
      if (status === "completed" && !text.trim()) status = "incomplete";
      const success = status === "completed";
      const tokenPricing = readChatTokenPricingSnapshot(
        object(turn.configSnapshot).tokenPricing,
      );
      if (isTokenPricedChatModel(turn.modelId) && !tokenPricing)
        throw new Error("MISSING_CHAT_TOKEN_PRICING_SNAPSHOT");
      const rawUsage = input.usage !== undefined ? input.usage : attempt.usage;
      const normalized = tokenPricing
        ? normalizeChatTokenUsage(rawUsage)
        : null;
      const usageUnknown = success && normalized?.availability === "unknown";
      const actualUsageCredits =
        tokenPricing && normalized?.availability === "reported"
          ? chatTokenCost(normalized.tokens, tokenPricing.pricing)
          : null;
      const usageInvalid =
        success &&
        tokenPricing &&
        normalized?.availability === "reported" &&
        (normalized.tokens.inputTokens > tokenPricing.maxInputTokens ||
          normalized.tokens.outputTokens > tokenPricing.maxOutputTokens ||
          actualUsageCredits! > attempt.heldCredits);
      const chargedCredits =
        !success || usageUnknown || usageInvalid
          ? 0
          : tokenPricing && normalized?.availability === "reported"
            ? chatTokenCost(normalized.tokens, tokenPricing.pricing)
            : attempt.heldCredits;
      const billingState = usageUnknown
        ? "usage_unknown"
        : usageInvalid
          ? "usage_invalid"
          : success
            ? "charged"
            : "released";
      const billing = {
        state: billingState,
        chargedCredits,
        ...(tokenPricing
          ? {
              tokenPricing,
              usageAvailability: normalized!.availability,
              ...(normalized?.availability === "reported"
                ? { tokens: normalized.tokens, actualUsageCredits }
                : { reason: normalized!.reason }),
              ...(usageInvalid
                ? { reason: "usage_exceeds_reserved_bounds" }
                : {}),
            }
          : {}),
      };
      const usage = { ...object(rawUsage), billing };
      const error =
        input.error ??
        (status === "incomplete"
          ? {
              code: "EMPTY_OR_INCOMPLETE_RESPONSE",
              publicMessage: "文字回复未完成，文字回复未收费",
            }
          : undefined);
      // The initial debit is a hold against available balance, not a second charge.
      // Only this locked success transaction writes the unique settlement ledger.
      if (attempt.billingState === "reserved") {
        await closeChatReserve(tx, {
          userId: turn.userId,
          turnId: turn.id,
          attemptId: attempt.id,
          amount: attempt.heldCredits,
          success: success && !usageUnknown && !usageInvalid,
          actualCredits: chargedCredits,
          ...(billing ? { result: json(billing) } : {}),
        });
        if (success)
          await tx.usageLog.create({
            data: {
              id: `chat_settle_${turn.id}`,
              userId: turn.userId,
              modelId: String(object(turn.configSnapshot).model),
              action: "conversation.chat",
              creditsDelta: chargedCredits ? -chargedCredits : 0,
              metadata: json({
                turnId: turn.id,
                attemptId: attempt.id,
                chargedCredits,
                usage: usage ?? null,
              }),
            },
          });
      }
      const data = {
        status,
        rawText: text,
        billingState,
        finishedAt: new Date(),
        ...(input.parts !== undefined ? { parts: json(input.parts) } : {}),
        ...(input.sources !== undefined
          ? { sources: json(input.sources) }
          : {}),
        ...(input.usage !== undefined || tokenPricing
          ? { usage: usage == null ? Prisma.DbNull : json(usage) }
          : {}),
        ...(error !== undefined ? { error: json(error) } : {}),
      };
      await tx.chatAttempt.update({ where: { id: attempt.id }, data });
      await tx.conversationMessage.updateMany({
        where: { chatAttemptId: attempt.id },
        data: {
          content: text,
          chatStatus: status,
          chatSources:
            input.sources !== undefined
              ? json(input.sources)
              : (attempt.sources ?? Prisma.DbNull),
          chatUsage: usage == null ? Prisma.DbNull : json(usage),
          chatActivityHistory:
            input.parts === undefined
              ? undefined
              : json(readActivityHistory(input.parts)),
          chatError: error ? json(error) : Prisma.DbNull,
        },
      });
      await tx.chatTurn.update({
        where: { id: turn.id },
        data: {
          status,
          activeConversationId: null,
          chargedCredits: success ? chargedCredits : turn.chargedCredits,
        },
      });
      const account = await tx.user.findUniqueOrThrow({
        where: { id: turn.userId },
        select: { credits: true },
      });
      await appendChatEvent(tx, turn.id, attempt.id, "attempt.terminal", {
        status,
        partial: !success && Boolean(text),
        text,
        sources: input.sources ?? attempt.sources ?? [],
        usage: usage ?? null,
        usageAvailability:
          normalized?.availability ?? (rawUsage ? "reported" : "unknown"),
        error: error
          ? {
              message:
                object(error).publicMessage ??
                "本次回复未完成，已保存收到的部分内容",
              code: object(error).code,
            }
          : null,
        billing: {
          state: billingState,
          chargedCredits,
          balance: account.credits,
        },
      });
      return true;
    },
    { timeout: 15_000 },
  );
}

export async function cancelChatTurn(
  userId: string,
  id: string,
  expectedAttemptId?: string,
  deviceId?: string | null,
) {
  const view = await getChatTurn(userId, id, true, deviceId);
  if (expectedAttemptId && view.attemptId !== expectedAttemptId)
    throw new ChatTurnError(
      "ATTEMPT_CHANGED",
      "回复已开始新一轮尝试，请刷新后再操作",
      409,
    );
  await finishChatAttempt({
    turnId: id,
    attemptId: view.attemptId,
    status: "cancelled",
    error: {
      code: "USER_CANCEL",
      publicMessage: "文字回复已停止，收到的内容已保存，文字回复未收费",
    },
  });
  return getChatTurn(userId, id, true, deviceId);
}

export async function retryChatTurn(
  userId: string,
  id: string,
  clientRequestId: string,
  expectedPreviousAttemptId?: string,
  deviceId?: string | null,
) {
  const hash = operationHash({
    id,
    expectedPreviousAttemptId: expectedPreviousAttemptId ?? null,
  });
  const replay = await receiptTurn(
    userId,
    "retry",
    clientRequestId,
    hash,
    deviceId,
  );
  if (replay) return replay;
  const initial = await getChatTurn(userId, id, true, deviceId);
  await assertChatRuntimeAdmission(userId, initial.modelId);
  await db.$transaction(async (tx) => {
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "Conversation" WHERE "id" = ${initial.conversationId} FOR UPDATE`,
    );
    if (
      !(await tx.conversation.findFirst({
        where: {
          id: initial.conversationId,
          archivedAt: null,
          ...conversationAccessWhere(userId, deviceId),
        },
        select: { id: true },
      }))
    )
      throw new ChatTurnError("NOT_FOUND", "对话不存在", 404);
    await lockTurn(tx, id);
    const turn = await tx.chatTurn.findUniqueOrThrow({ where: { id } });
    const duplicate = await tx.chatRequestReceipt.findUnique({
      where: {
        userId_scope_clientRequestId: {
          userId,
          scope: "retry",
          clientRequestId,
        },
      },
    });
    if (duplicate) {
      if (duplicate.turnId !== id || duplicate.inputHash !== hash)
        throw new ChatTurnError(
          "IDEMPOTENCY_CONFLICT",
          "重试标识已用于其他任务",
          409,
        );
      if (duplicate.contentClearedAt)
        throw new ChatTurnError(
          "CONTENT_CLEARED",
          "这次请求的聊天内容已清空，不会再次执行",
          410,
        );
      return;
    }
    const latest = await tx.chatAttempt.findFirstOrThrow({
      where: { turnId: id },
      orderBy: { ordinal: "desc" },
    });
    if (expectedPreviousAttemptId && latest.id !== expectedPreviousAttemptId)
      throw new ChatTurnError(
        "ATTEMPT_CHANGED",
        "回复状态已变化，请刷新后再试",
        409,
      );
    if (!chatIsTerminal(latest.status) || latest.status === "completed")
      throw new ChatTurnError(
        "CHAT_TURN_BUSY",
        "任务运行中或已经完成，不能重复重试",
        409,
      );
    if (latest.ordinal >= 3)
      throw new ChatTurnError(
        "RETRY_LIMIT",
        "此轮已达到重试次数，请重新编辑后发送",
        429,
      );
    const newest = await tx.chatTurn.findFirst({
      where: { conversationId: turn.conversationId },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (newest?.id !== id)
      throw new ChatTurnError(
        "CONVERSATION_CHANGED",
        "后面已有新消息，请重新编辑后发送",
        409,
      );
    if (
      await tx.conversationMessage.findFirst({
        where: {
          conversationId: turn.conversationId,
          role: "USER",
          createdAt: { gt: turn.createdAt },
          OR: [{ chatTurnId: null }, { chatTurnId: { not: turn.id } }],
        },
        select: { id: true },
      })
    )
      throw new ChatTurnError(
        "CONVERSATION_CHANGED",
        "后面已有新消息，请重新编辑后发送",
        409,
      );
    const admission = await assertChatRuntimeAdmission(
      userId,
      turn.modelId,
      tx,
    );
    const [clock] = await tx.$queryRaw<
      Array<{ now: Date }>
    >`SELECT CURRENT_TIMESTAMP AS "now"`;
    if (!(await debitChatCredits(tx, userId, turn.priceCredits)).count)
      throw new ChatTurnError("INSUFFICIENT_CREDITS", "可用积分不足", 402);
    await assertChatConcurrency(tx, userId);
    const imageReply = await tx.conversationMessage.findFirst({
      where: { chatTurnId: id, role: "ASSISTANT", generationId: { not: null } },
      orderBy: { createdAt: "desc" },
      select: {
        generation: {
          select: { id: true, status: true, modelId: true, prompt: true },
        },
      },
    });
    const image = imageReply?.generation;
    const attempt = await tx.chatAttempt.create({
      data: {
        turnId: id,
        ordinal: latest.ordinal + 1,
        retryRequestId: `${userId}:${clientRequestId}`,
        heldCredits: turn.priceCredits,
        ...(image
          ? {
              parts: json({
                imageContinuation: {
                  generationId: image.id,
                  status: image.status,
                  modelId: image.modelId,
                  prompt: image.prompt,
                },
              }),
            }
          : {}),
        mode: latest.mode,
        protocolVersion: CHAT_TASK_PROTOCOL_VERSION,
        queueDeadline: admission.queueTimeoutMs
          ? new Date(clock.now.getTime() + admission.queueTimeoutMs)
          : null,
      },
    });
    await recordChatReserve(tx, {
      userId,
      turnId: id,
      attemptId: attempt.id,
      amount: turn.priceCredits,
    });
    await tx.chatRequestReceipt.create({
      data: {
        userId,
        scope: "retry",
        clientRequestId,
        inputHash: hash,
        conversationId: turn.conversationId,
        turnId: id,
        attemptId: attempt.id,
      },
    });
    await tx.chatTurn.update({
      where: { id },
      data: {
        status: "queued",
        activeAttemptId: attempt.id,
        activeConversationId: turn.conversationId,
      },
    });
    await tx.conversationMessage.create({
      data: {
        conversationId: turn.conversationId,
        role: "ASSISTANT",
        content: "",
        chatTurnId: id,
        chatAttemptId: attempt.id,
        chatStatus: "queued",
      },
    });
    await appendChatEvent(tx, id, attempt.id, "attempt.started", {
      status: "queued",
      reservedCredits: turn.priceCredits,
      mode: attempt.mode,
    });
  });
  return getChatTurn(userId, id);
}
