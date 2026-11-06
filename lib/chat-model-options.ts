export const LUNA_MODEL_ID = "gpt-5.6-luna";
export const SOL_MODEL_ID = "gpt-6.1-sol";
export const REASONING_EFFORTS = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export interface ChatModelOption {
  id: string;
  displayName: string;
  reasoningEfforts: ReasoningEffort[];
  defaultReasoningEffort?: ReasoningEffort;
  credits: number;
  supportsVision: boolean;
  maxReferenceImages: number;
  supportsWebSearch?: boolean;
  supportsDurableTurns?: boolean;
}

export interface LunaStatus {
  enabled: boolean;
  baseUrl: string;
  model: string;
  hasKey: boolean;
  credits: number;
}

export interface LunaConfigUpdate {
  enabled?: boolean;
  baseUrl?: string;
  apiKey?: string;
  credits?: number;
}
