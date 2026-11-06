// 管理端 API 契约类型（与 app/api/admin 序列化一一对应）。

export type AdminRole = "USER" | "ADMIN";
export type AdminUserStatus = "ACTIVE" | "BANNED";
export type Health = "HEALTHY" | "DEGRADED" | "DOWN";
export type GenerationStatusView =
  | "PENDING"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELED";

// ---------- 仪表盘 ----------

export interface AdminStats {
  todayGenerations: number;
  onlineUsers: number;
  userCredits: number;
  healthyProviders: number;
  queueDepth: number;
  running: number;
  failedToday: number;
  succeededToday: number;
  successRate: number;
  creditsToday: number;
  accountSlots: number;
  accountInFlight: number;
  queueWaiting: number;
  queueActive: number;
  queueDelayed: number;
  queueFailed: number;
  queueCompleted: number;
  workerOnline: boolean;
  workerHeartbeatAt: string | null;
  stuckGenerations: number;
  dailySeries: {
    date: string;
    total: number;
    succeeded: number;
    failed: number;
    credits: number;
  }[];
  hourlySeries: {
    hour: string;
    total: number;
    succeeded: number;
    failed: number;
  }[];
  topUsers: {
    userId: string;
    email: string;
    name: string | null;
    generations: number;
    credits: number;
  }[];
  providerStats: {
    providerId: string | null;
    providerName: string;
    providerChannelId: string | null;
    total: number;
    succeeded: number;
    failed: number;
    successRate: number;
    credits: number;
    avgRunMs: number | null;
  }[];
  errorBreakdown: {
    code: string;
    count: number;
  }[];
  modelUsage: {
    modelId: string;
    generations: number;
    credits: number;
  }[];
}

// ---------- 用户 ----------

export interface AdminUserSummary {
  id: string;
  email: string;
  name: string | null;
  role: AdminRole;
  status: AdminUserStatus;
  credits: number;
  dailyGenLimit: number | null;
  materialInboxBeta?: boolean;
  createdAt: string;
}

export interface AdminUserDetail extends AdminUserSummary {
  sessionVersion: number;
  concurrentLimit: number | null;
  bannedAt: string | null;
  bannedReason: string | null;
  updatedAt: string;
  _count: { generations: number };
}

export interface AdminUserPatch {
  email?: string;
  name?: string | null;
  role?: AdminRole;
  status?: AdminUserStatus;
  dailyGenLimit?: number;
  concurrentLimit?: number;
  materialInboxBeta?: boolean;
  bannedReason?: string | null;
}

// ---------- 生成记录 ----------

export interface AdminGenerationImage {
  id: string;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
  mimeType: string | null;
  createdAt: string;
  thumbnailUrl: string;
  originalUrl: string;
}

export interface AdminGenerationItem {
  id: string;
  userId: string;
  user: { id: string; email: string; name: string | null } | null;
  modelId: string;
  prompt: string;
  status: GenerationStatusView;
  progress: number;
  provider: { id: string; name: string } | null;
  providerId: string | null;
  providerAccount: {
    id: string;
    name: string | null;
    baseUrl: string;
    health: Health;
  } | null;
  providerAccountId: string | null;
  jobId: string | null;
  costCredits: number;
  attempts: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  queueMs: number | null;
  runMs: number | null;
  totalMs: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  aspectRatio: string;
  resolution: string | null;
  n: number;
  outputFormat: string;
  imageCount: number;
  images: AdminGenerationImage[];
  isStuck: boolean;
}

export interface AdminGenerationListResult {
  items: AdminGenerationItem[];
  statuses: GenerationStatusView[];
}

// ---------- 渠道 ----------

export interface AdminProvider {
  id: string;
  name: string;
  protocol: string;
  baseUrl: string;
  priority: number;
  modelsSupported: string[];
  costMultiplier: number;
  isActive: boolean;
  health: Health;
  consecutiveErrors: number;
  lastHealthyAt: string | null;
  lastErrorAt: string | null;
  lastErrorMsg: string | null;
  note: string | null;
  createdAt: string;
  accountCount: number;
  activeAccountCount: number;
  healthyAccountCount: number;
  totalMaxConcurrency: number;
  inFlight: number;
  hasApiKey: boolean;
  apiKey: string;
}

export interface AdminProviderInput {
  name: string;
  protocol: "OPENAI_IMAGES" | "OPENAI_RESPONSES_IMAGE" | "GEMINI_IMAGE";
  baseUrl: string;
  apiKey: string;
  priority: number;
  modelsSupported: string[];
  costMultiplier: number;
  note?: string;
}

export type AdminProviderPatch = Partial<AdminProviderInput>;

export interface AdminProviderAccount {
  id: string;
  providerId: string;
  name: string | null;
  baseUrl: string;
  apiKeyFingerprintMasked: string;
  priority: number;
  weight: number;
  maxConcurrency: number;
  inFlight: number;
  health: Health;
  isActive: boolean;
  consecutiveErrors: number;
  lastLeaseAt: string | null;
  lastHealthyAt: string | null;
  lastErrorAt: string | null;
  lastErrorMsg: string | null;
  cooldownUntil: string | null;
  dailyLimit: number | null;
  dailyUsed: number;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  hasApiKey: boolean;
  isDefault: boolean;
}

export interface AdminProviderAccountInput {
  name?: string;
  baseUrl: string;
  apiKey: string;
  priority?: number;
  weight?: number;
  maxConcurrency?: number;
  dailyLimit?: number;
  note?: string;
}

export interface AdminProviderAccountPatch {
  name?: string | null;
  baseUrl?: string;
  apiKey?: string;
  priority?: number;
  weight?: number;
  maxConcurrency?: number;
  dailyLimit?: number | null;
  note?: string | null;
  isActive?: boolean;
  health?: Health;
  cooldownUntil?: string | null;
  consecutiveErrors?: number;
}

export interface AccountImportResult {
  created: number;
  skipped: number;
  failed: number;
  errors: { lineNumber: number; name?: string; reason: string }[];
}

export interface ChannelRequestConfig {
  sizes: string[];
  quality: string;
  responseFormat: string;
  bodyTemplate?: string;
}

// ---------- 定价 ----------

export interface PricingRule {
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
  note: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PricingRuleInput {
  modelId: string;
  providerChannelId?: string | null;
  image2Mode?: "standard" | "high" | null;
  resolution?: string | null;
  aspectRatio?: string | null;
  outputFormat?: string | null;
  background?: string | null;
  usesReference?: boolean | null;
  credits: number;
  priority?: number;
  note?: string | null;
  isActive?: boolean;
}

export interface ConversationPricing {
  standardCredits: number;
  reasoningCredits: number;
}

// ---------- 邀请码 / 兑换码 ----------

export interface AdminInvite {
  id: string;
  code: string;
  maxUses: number;
  usedCount: number;
  initialCredits: number;
  note: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface AdminRedemptionCode {
  id: string;
  code: string;
  credits: number;
  maxUses: number;
  usedCount: number;
  perUserLimit: number;
  note: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  _count?: { redemptions: number };
}

// ---------- 审计 ----------

export interface AuditEntry {
  id: string;
  actorId: string;
  action: string;
  target: string | null;
  diff: unknown;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

// ---------- AI 集成 ----------

export interface AiIntegrationStatus {
  enabled: boolean;
  baseUrl: string;
  model: string;
  hasKey: boolean;
}

export interface AdminIntegrations {
  deepseek: AiIntegrationStatus & { systemPrompt: string };
  pptSystemPrompt: string;
  conversation: AiIntegrationStatus & { reasoning: boolean };
  conversationSystemPrompt: string;
  conversationCompileSystemPrompt: string;
}

export interface AdminIntegrationsPatch {
  deepseek?: {
    enabled?: boolean;
    baseUrl?: string;
    model?: string;
    systemPrompt?: string;
    apiKey?: string;
  };
  conversation?: {
    enabled?: boolean;
    baseUrl?: string;
    model?: string;
    systemPrompt?: string;
    compileSystemPrompt?: string;
    reasoning?: boolean;
    apiKey?: string;
  };
  pptSystemPrompt?: string;
}

// ---------- 系统配置 ----------

export interface SystemConfigEntry {
  key: string;
  value: unknown;
}

// ---------- 公告 ----------

export type AnnouncementToneValue = "info" | "warning" | "success" | "danger";
export type AnnouncementDisplayModeValue = "banner" | "popup" | "both";

export interface AdminAnnouncement {
  id: string;
  title: string;
  body: string;
  tone: AnnouncementToneValue;
  displayMode: AnnouncementDisplayModeValue;
  linkLabel: string | null;
  linkUrl: string | null;
  enabled: boolean;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminAnnouncementInput {
  title: string;
  body: string;
  tone: AnnouncementToneValue;
  displayMode: AnnouncementDisplayModeValue;
  linkLabel?: string | null;
  linkUrl?: string | null;
  enabled: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
}
