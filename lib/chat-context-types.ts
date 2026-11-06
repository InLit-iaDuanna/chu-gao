import type { ChatReference } from "@/lib/chat-references-types";
import type { ChatSearchSource } from "@/lib/chat-search";
import { SOL_MODEL_ID } from "@/lib/chat-model-options";

export const CHAT_CONTEXT_BUDGET_TOKENS = 24_000;
export const CHAT_SOL_CONTEXT_BUDGET_TOKENS = 96_000;
export const CHAT_CONTEXT_ESTIMATOR_VERSION = "chat-budget-v2";

/** Application sending budgets, not verified upstream context-window sizes. */
export function chatContextBudget(modelId?: string) {
  return modelId === SOL_MODEL_ID
    ? CHAT_SOL_CONTEXT_BUDGET_TOKENS
    : CHAT_CONTEXT_BUDGET_TOKENS;
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
  messageCount: number;
  compactedMessages: number;
  summary: string | null;
  canCompact: boolean;
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
