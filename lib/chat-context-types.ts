import type { ChatReference } from "@/lib/chat-references-types";
import type { ChatSearchSource } from "@/lib/chat-search";
import { OPUS_MODEL_ID, SOL_MODEL_ID } from "@/lib/chat-model-options";

export const CHAT_CONTEXT_BUDGET_TOKENS = 24_000;
export const CHAT_CONTEXT_AUTO_COMPACT_RATIO = 0.85;
export const OPUS_CONTEXT_BUDGET_MIN = 100_000;
export const OPUS_CONTEXT_BUDGET_MAX = 1_000_000;
export const OPUS_CONTEXT_BUDGET_STEP = 100_000;
export const OPUS_CONTEXT_BUDGET_OPTIONS = Array.from(
  { length: OPUS_CONTEXT_BUDGET_MAX / OPUS_CONTEXT_BUDGET_STEP },
  (_, index) => (index + 1) * OPUS_CONTEXT_BUDGET_STEP,
);
export const SOL_CONTEXT_BUDGET_MIN = 100_000;
export const SOL_CONTEXT_BUDGET_MAX = 500_000;
export const SOL_CONTEXT_BUDGET_STEP = 100_000;
export const SOL_CONTEXT_BUDGET_OPTIONS = Array.from(
  { length: SOL_CONTEXT_BUDGET_MAX / SOL_CONTEXT_BUDGET_STEP },
  (_, index) => (index + 1) * SOL_CONTEXT_BUDGET_STEP,
);
export const CHAT_CONTEXT_ESTIMATOR_VERSION = "chat-budget-v2";

export function contextBudgetOptionsForModel(modelId?: string) {
  if (modelId === OPUS_MODEL_ID) return OPUS_CONTEXT_BUDGET_OPTIONS;
  if (modelId === SOL_MODEL_ID) return SOL_CONTEXT_BUDGET_OPTIONS;
  return [];
}

export function supportsAdjustableChatContext(modelId?: string) {
  return contextBudgetOptionsForModel(modelId).length > 0;
}

export interface ChatContextAsset {
  messageId: string | null;
  turnId: string | null;
  index: number;
  reference: ChatReference;
  compacted: boolean;
}

export interface ChatContextTool {
  type: string;
  itemId?: string;
  callId?: string;
  name?: string;
  status?: string;
  query?: string;
  text?: string;
  truncated?: boolean;
  sources?: ChatSearchSource[];
}

export interface ChatContextToolResult {
  messageId: string;
  turnId: string | null;
  attemptId: string | null;
  sources: ChatSearchSource[];
  tools: ChatContextTool[];
}

export type Immutable<T> = T extends object
  ? { readonly [K in keyof T]: Immutable<T[K]> }
  : T;

export interface ChatContextManifestData {
  version: 1;
  snapshotId: string | null;
  revision: number;
  sourceHash: string;
  contextHash: string;
  messageIds: string[];
  summaryMessageIds: string[];
  recentMessageIds: string[];
  currentMessageId: string | null;
  excludedMessageIds: string[];
  turnIds: string[];
  assets: ChatContextAsset[];
  toolResultManifest: ChatContextToolResult[];
  unattributedImageCount: number;
  estimatedTokens: number;
  budgetTokens: number;
  estimatorVersion: string;
  profileVersion: string;
  summarizerProfileVersion: string | null;
  /** SHA-256 of the exact JSON request body; null until the body is supplied. */
  requestHash: string | null;
}

export type ChatContextManifest = Immutable<ChatContextManifestData>;

/** Application-side estimates, not the selected model's actual context limit. */
export interface ChatContextStatus {
  estimatedTokens: number;
  budgetTokens: number;
  autoCompactTokens?: number;
  autoCompactRatio?: number;
  messageCount: number;
  compactedMessages: number;
  summary: string | null;
  canCompact: boolean;
}

export function normalizeChatContextBudget(
  modelId: string,
  requested?: number,
) {
  const options = contextBudgetOptionsForModel(modelId);
  if (!options.length) return CHAT_CONTEXT_BUDGET_TOKENS;
  const budget = requested ?? options[0];
  if (!Number.isSafeInteger(budget) || !options.includes(budget))
    throw new ChatContextError(
      "VALIDATION_ERROR",
      modelId === SOL_MODEL_ID
        ? "GPT-6.1 Sol 上下文档位必须是 100k 到 500k 的整档"
        : "Opus 上下文档位必须是 100k 到 1m 的整档",
      400,
    );
  return budget;
}

export class ChatContextError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number,
    readonly contextStatus?: ChatContextStatus,
  ) {
    super(message);
    this.name = "ChatContextError";
  }
}
