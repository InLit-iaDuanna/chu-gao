import type { ChatSearchSource } from "@/lib/chat-search";
import type { ReasoningEffort } from "@/lib/chat-model-options";

export const CHAT_TERMINAL_STATUSES = [
  "completed",
  "failed",
  "incomplete",
  "cancelled",
  "interrupted",
] as const;
export type ChatTerminalStatus = (typeof CHAT_TERMINAL_STATUSES)[number];
export const chatIsTerminal = (status: string): status is ChatTerminalStatus =>
  (CHAT_TERMINAL_STATUSES as readonly string[]).includes(status);

export interface ChatTurnInput {
  conversationId: string;
  clientRequestId: string;
  content: string;
  modelId: string;
  contextBudgetTokens?: number;
  reasoningEffort?: ReasoningEffort;
  webSearch?: boolean;
  referenceImageKeys: string[];
  sourceImageIds: string[];
  imageModelId?: string;
  imageSize?: string;
  imageQuality?: string;
  imageOutputFormat?: string;
  imageN?: number;
  references?: Array<
    | { kind: "upload"; key: string; label?: string }
    | { kind: "generated"; id: string; label?: string }
  >;
}

export interface ChatTurnEvent {
  v: 1;
  turnId: string;
  attemptId: string;
  seq: number;
  type: string;
  payload: Record<string, unknown>;
}

export interface ChatTurnView {
  id: string;
  conversationId: string;
  modelId: string;
  status: string;
  attemptId: string;
  attemptNumber: number;
  text: string;
  sources: ChatSearchSource[];
  usage: Record<string, unknown> | null;
  error: { message: string; code?: string } | null;
  priceCredits: number;
  chargedCredits: number;
  billingState: string;
  billing?: import("@/lib/turn-credit-types").CreditSettlement;
  lastSeq: number;
  activity?: string;
  activityHistory?: string[];
  parts?: unknown;
  timings?: unknown;
  createdAt?: string;
  startedAt?: string | null;
  protocolVersion?: number;
  generationId?: string;
}
