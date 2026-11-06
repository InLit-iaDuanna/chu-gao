// 视图类型：与后端 API 契约一一对应（序列化后的 JSON 形状）。
// 唯一事实来源是 app/api/* 路由，不依赖任何旧前端代码。

import type { ChatModelOption } from "@/lib/chat-model-options";

export type GenerationStatus =
  | "PENDING"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELED";

export interface GenerationImage {
  id: string;
  url: string;
  src: string;
  downloadUrl: string;
  thumbnailUrl: string;
  width: number | null;
  height: number | null;
  mimeType: string;
  createdAt: string;
}

export interface Generation {
  id: string;
  source?: "agent" | "web";
  conversationId: string | null;
  modelId: string;
  prompt: string;
  negativePrompt: string | null;
  aspectRatio: string | null;
  resolution: string | null;
  size?: string | null;
  seed?: number | null;
  n: number;
  outputFormat: string | null;
  referenceImageKeys: string[];
  status: GenerationStatus;
  provider: string | null;
  providerChannelId: string | null;
  providerChannelName: string | null;
  providerAccountName: string | null;
  progress: number;
  errorCode: string | null;
  errorMessage: string | null;
  credits: number;
  costCredits: number;
  attempts: number;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  images: GenerationImage[];
}

export interface GenerationListPage {
  items: Generation[];
  nextCursor: string | null;
}

export interface CreateGenerationInput {
  creative?: import("@/lib/creative-brief").CreativeConfirmation;
  modelId: string;
  prompt: string;
  negativePrompt?: string;
  size?: string;
  quality?: string;
  n: number;
  outputFormat?: string;
  background?: string;
  seed?: number;
  image2Mode?: "standard" | "high";
  referenceImageKeys?: string[];
  sourceImageIds?: string[];
  providerChannelId?: string;
  conversationId?: string;
  userMessage?: string;
  assistantMessage?: string;
}

export interface CreateGenerationResult {
  generationId: string;
  status: GenerationStatus;
  estimatedCredits: number;
  providerChannelId: string | null;
  queuePosition: number;
  workerOnline: boolean;
  queueWaiting: number;
}

export interface CreativeReferenceInsight {
  subject: string;
  composition: string;
  style: string;
  constraints: string[];
  risks: string[];
  confidence: "high" | "medium" | "low";
  summary: string;
  referenceSummary: string;
}

export interface CreativeQualityCheck {
  generationId: string;
  imageId: string;
  status: "pass" | "review" | "fail";
  score: number;
  summary: string;
  findings: string[];
}

export interface Me {
  id: string;
  email: string;
  name: string | null;
  role: "USER" | "ADMIN";
  status: "ACTIVE" | "BANNED";
  credits: number;
  dailyGenLimit: number;
  concurrentLimit: number;
  dailyUsed: number;
  dailyLimit: number;
  authenticated: true;
}

export interface UsageLogEntry {
  id: string;
  source?: "agent" | "web";
  action: string;
  creditsDelta: number;
  modelId: string | null;
  generationId: string | null;
  reason: string | null;
  createdAt: string;
}

export interface UsageLogPage {
  items: UsageLogEntry[];
  nextCursor: string | null;
}

export interface ProviderChannelInfo {
  id: string;
  displayName: string;
  accountCount: number;
  availableAccountCount: number;
}

export interface ModelPricingRule {
  id: string;
  modelId: string;
  providerChannelId: string | null;
  image2Mode: "standard" | "high" | null;
  resolution: string | null;
  aspectRatio: string | null;
  outputFormat: string | null;
  background: string | null;
  usesReference: boolean | null;
  credits: number;
  priority: number;
}

export interface ModelInfo {
  id: string;
  displayName: string;
  vendor: string;
  protocol: string;
  tagline?: string;
  capabilities: {
    sizes: string[];
    qualities?: string[];
    responseFormats: string[];
    resolutions: string[];
    image2Modes?: ("standard" | "high")[];
    supportsReferenceImage: boolean;
    maxReferenceImages: number;
    supportsNegativePrompt: boolean;
    supportsSeed: boolean;
    maxN: number;
    outputFormats: string[];
    backgrounds: string[];
    supportsOutputCompression: boolean;
  };
  defaults: {
    size: string;
    quality?: string;
    responseFormat: string;
    image2Mode?: "standard" | "high";
    outputFormat: string;
    background: string;
    outputCompression?: number;
  };
  pricingRules?: ModelPricingRule[];
  available: boolean;
  providerChannels?: ProviderChannelInfo[];
}

export type ConversationRole = "user" | "assistant";

export interface ConversationMessage {
  id: string;
  role: ConversationRole;
  content: string;
  generationId?: string;
  chatTurnId?: string;
  chatAttemptId?: string;
  chatStatus?: string;
  chatError?: string | null;
  chatSources?: import("@/lib/chat-search").ChatSearchSource[];
  chatUsage?: Record<string, unknown> | null;
  chatActivity?: string;
  chatSearched?: boolean;
  chatStartedAt?: string;
  chatLastSeq?: number;
  chatAttemptNumber?: number;
  createdAt: string;
  imageId?: string;
  imageUrl?: string;
  thumbnailUrl?: string;
  images?: GenerationImage[];
  generationPrompt?: string;
  generationModelId?: string;
  generationSize?: string | null;
  generationCount?: number;
  generationErrorCode?: string | null;
  generationErrorMessage?: string | null;
  generationStatus?: GenerationStatus;
  generationProgress?: number;
  generationProvider?: string | null;
  generationProviderChannelName?: string | null;
  generationStartedAt?: string | null;
  generationFinishedAt?: string | null;
}

export interface Conversation {
  id: string;
  title: string;
  lastMessageAt: string;
  createdAt: string;
  messages: ConversationMessage[];
}

export interface ConversationSummary {
  id: string;
  title: string;
  lastMessageAt: string;
  createdAt: string;
  latestMessage: string | null;
  thumbnailUrl: string | null;
  generationCount: number;
}

export interface ChatMessageInput {
  role: ConversationRole;
  content: string;
  generationId?: string;
}

export interface CompiledConversationPrompt {
  prompt: string;
  assistantMessage: string;
  shouldGenerate: boolean;
  compiler: string;
  fallbackReason?: string;
}

export interface ConversationPricing {
  standardCredits: number;
  reasoningCredits: number;
  models: ChatModelOption[];
  defaultModelId: string;
}

export interface UploadResult {
  key: string;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
}

export interface BookmarkedReferenceItem {
  id: string;
  postId: string;
  postTitle: string;
  previewUrl: string;
  width: number;
  height: number;
  mimeType: string;
  isCover: boolean;
  collectionIds: string[];
  bookmarkedAt: string;
}

export interface MaterializedReference {
  mediaId: string;
  postId: string;
  key: string;
  previewUrl: string;
  mimeType: string;
  width: number;
  height: number;
}

export type PptSlideStatus =
  | "pending"
  | "enhancing"
  | "generating"
  | "completed"
  | "failed";

export interface PptSlide {
  id: string;
  index: number;
  title?: string;
  variablePrompt: string;
  finalPrompt: string;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  imageId?: string;
  status: PptSlideStatus;
  error?: string;
  generationId?: string;
  seed?: number;
}

export type PptStatus =
  | "preparing"
  | "enhancing"
  | "generating"
  | "completed"
  | "failed";

export interface PptGeneration {
  id: string;
  userId: string;
  conversationId?: string;
  title?: string;
  fixedPrompt: string;
  referenceImageKeys: string[];
  status: PptStatus;
  progress: number;
  createdAt: string;
  updatedAt: string;
  slides: PptSlide[];
}

export interface CreatePptInput {
  modelId: string;
  fixedPrompt: string;
  title?: string;
  referenceImageKeys?: string[];
  slides: { variablePrompt: string; title?: string }[];
}

export const TERMINAL_STATUSES: ReadonlySet<GenerationStatus> = new Set([
  "SUCCEEDED",
  "FAILED",
  "CANCELED",
]);

export function isTerminalStatus(status: GenerationStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function isActiveStatus(status: GenerationStatus): boolean {
  return status === "PENDING" || status === "RUNNING";
}
