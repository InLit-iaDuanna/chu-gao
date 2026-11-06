import { z } from "zod";

export const RESEARCH_PRESETS = [
  "auto",
  "explore",
  "research",
  "proposal",
] as const;
export const RESEARCH_SCOPES = ["exploratory", "standard", "deep"] as const;
export const RESEARCH_PRODUCTS = [
  "report",
  "competitors",
  "board",
  "brief",
  "pptx",
  "docx",
  "html",
] as const;
export const PRESET_LABELS = {
  auto: "自动推荐",
  explore: "资料探索",
  research: "深度调研",
  proposal: "调研并制作提案",
};
export const SCOPE_LABELS = {
  exploratory: "探索",
  standard: "标准",
  deep: "深入",
};
export const PRODUCT_LABELS = {
  report: "研究报告",
  competitors: "竞品表",
  board: "网页留档 / 视觉资料",
  brief: "设计 brief",
  pptx: "演示稿",
  docx: "提案文档",
  html: "网页",
};
export const STAGE_LABELS: Record<string, string> = {
  intake: "需求澄清",
  explore: "资料探索",
  research: "系统调研",
  capture: "证据留档",
  verify: "关键结论核验",
  synthesize: "报告与设计 brief",
  produce: "提案制作",
};
export const STATUS_LABELS: Record<string, string> = {
  pending: "待执行",
  queued: "排队中",
  running: "进行中",
  completed: "已完成",
  failed: "失败",
  interrupted: "已中断",
  cancelled: "已取消",
  budget_exhausted: "达到预算",
  expired: "已过期",
};
export const researchTerminal = (status: string) =>
  [
    "completed",
    "failed",
    "interrupted",
    "cancelled",
    "budget_exhausted",
  ].includes(status);

export const researchBriefSchema = z.object({
  question: z.string().trim().min(2).max(16000),
  market: z.string().max(500).default(""),
  audience: z.string().max(1000).default(""),
  timeRange: z.string().max(300).default(""),
  constraints: z.string().max(4000).default(""),
  competitors: z.array(z.string().max(300)).max(30).default([]),
  links: z.array(z.url().max(2048)).max(30).default([]),
  attachmentKeys: z.array(z.string().max(500)).max(16).default([]),
  sourceImageIds: z.array(z.string().max(100)).max(16).default([]),
  selectedMessageIds: z.array(z.string().max(100)).max(30).default([]),
  selectedContext: z.string().max(24000).default(""),
});
export const researchPlanInputSchema = z.object({
  brief: researchBriefSchema,
  preset: z.enum(RESEARCH_PRESETS).default("auto"),
  scope: z.enum(RESEARCH_SCOPES).default("standard"),
  products: z
    .array(z.enum(RESEARCH_PRODUCTS))
    .min(1)
    .max(7)
    .default(["report", "competitors", "brief"]),
  collectVisuals: z.boolean().default(true),
  verify: z.boolean().default(true),
  modelId: z.string().max(100).default("gpt-6.1-sol"),
  reasoningEffort: z
    .enum(["low", "medium", "high", "xhigh", "max"])
    .default("high"),
  sourceTaskId: z.string().max(100).optional(),
  sourceMode: z.enum(["produce", "refresh"]).optional(),
});
export const researchTaskInputSchema = researchPlanInputSchema.extend({
  projectId: z.string().max(100),
  clientRequestId: z.uuid(),
  intakeTaskId: z.string().min(1).max(100).optional(),
});
export const researchIntakeInputSchema = researchPlanInputSchema
  .partial()
  .extend({
    brief: researchBriefSchema
      .extend({ question: z.string().trim().max(16000) })
      .optional(),
    // Omitted settings are inherited by the service, not treated as a new choice.
    preset: researchPlanInputSchema.shape.preset.unwrap().optional(),
    scope: researchPlanInputSchema.shape.scope.unwrap().optional(),
    products: researchPlanInputSchema.shape.products.unwrap().optional(),
    collectVisuals: researchPlanInputSchema.shape.collectVisuals
      .unwrap()
      .optional(),
    verify: researchPlanInputSchema.shape.verify.unwrap().optional(),
    modelId: researchPlanInputSchema.shape.modelId.unwrap().optional(),
    reasoningEffort: researchPlanInputSchema.shape.reasoningEffort
      .unwrap()
      .optional(),
    projectId: z.string().max(100),
    clientRequestId: z.uuid(),
    previousTaskId: z.string().max(100).nullable().default(null),
    answer: z.string().trim().min(1).max(8000),
    intent: z.enum(["continue", "prepare_research"]).default("continue"),
  });
export const researchIntakeResultSchema = z.object({
  reply: z.string().min(1).max(2400),
  suggestions: z.array(z.string().trim().min(1).max(100)).max(4),
  ready: z.boolean(),
  summary: z.string().max(3000),
  products: z.array(z.enum(RESEARCH_PRODUCTS)).min(1).max(7),
  brief: researchBriefSchema.pick({
    question: true,
    market: true,
    audience: true,
    timeRange: true,
    constraints: true,
    competitors: true,
    links: true,
  }),
  // Optional only so previously persisted intake turns remain readable.
  contractVersion: z.literal("intake-dialogue-v1").optional(),
  nextQuestion: z.string().trim().min(1).max(600).nullable().optional(),
  unknowns: z.array(z.string().trim().min(1).max(500)).max(16).optional(),
  confirmedRequirements: z
    .array(z.string().trim().min(1).max(8000))
    .max(40)
    .optional(),
});
export type ResearchIntakeResult = z.infer<typeof researchIntakeResultSchema>;
export type ResearchIntakeInput = z.infer<typeof researchIntakeInputSchema>;
export interface ResearchIntakeSubmission {
  answer: string;
  previousTaskId: string | null;
  intent?: ResearchIntakeInput["intent"];
  requestHash?: string;
}
export interface ResearchIntakeView {
  task: ResearchTaskView | null;
  messages: Array<{ id: string; role: "user" | "assistant"; content: string }>;
  result: ResearchIntakeResult | null;
  resultTaskId: string | null;
  latestClientRequestId?: string | null;
  settings:
    | (Pick<
        ResearchPlanInput,
        | "preset"
        | "scope"
        | "modelId"
        | "reasoningEffort"
        | "collectVisuals"
        | "verify"
      > &
        Partial<Pick<ResearchPlanInput, "products">>)
    | null;
}
export type ResearchBriefInput = z.infer<typeof researchBriefSchema>;
export type ResearchPlanInput = z.infer<typeof researchPlanInputSchema>;
export type ResearchProduct = (typeof RESEARCH_PRODUCTS)[number];
export interface ResearchLimits {
  llm: number;
  search: number;
  crawl: number;
  minutes: number;
}
export interface ResearchPlan {
  preset: "explore" | "research" | "proposal";
  reason: string;
  stages: Array<{ kind: string; engine: string }>;
  limits: ResearchLimits;
  products: ResearchProduct[];
}
export interface ResearchEvidenceView {
  id: string;
  taskId: string;
  title: string;
  originalUrl: string;
  canonicalUrl: string;
  excerpt: string;
  status: string;
  screenshotKey: string | null;
  contentKey: string | null;
  claims: unknown;
  originUrl: string | null;
  fetchedAt: string | null;
  purgedAt: string | null;
  expired: boolean;
}
export interface ResearchArtifactView {
  id: string;
  kind: string;
  title: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  basisTaskId: string;
  expiresAt: string | null;
  purgedAt: string | null;
  expired: boolean;
}
export interface ResearchTaskView {
  id: string;
  projectId: string;
  briefId: string;
  sourceTaskId: string | null;
  status: string;
  preset: string;
  scope: string;
  modelId: string;
  reasoningEffort: string;
  plan: ResearchPlan;
  brief: ResearchBriefInput;
  nextSeq: number;
  llmCalls: number;
  searchCalls: number;
  crawlCalls: number;
  stages: Array<{
    id: string;
    kind: string;
    engine: string;
    status: string;
    text: string;
    result: unknown;
    activeAttemptId: string | null;
    // Server-validated completion chain; the browser does not inspect hashes.
    savedSynthesisComplete?: boolean;
    attempts: Array<{
      id: string;
      ordinal: number;
      status: string;
      error: unknown;
    }>;
  }>;
  evidence: ResearchEvidenceView[];
  artifacts: ResearchArtifactView[];
  costUsd: string | null;
  unknownCostCalls: number;
  error: { message?: string; code?: string } | null;
  createdAt: string;
  finishedAt: string | null;
  expiresAt: string | null;
}
export interface ResearchProjectView {
  id: string;
  title: string;
  conversationId: string | null;
  updatedAt: string;
  tasks: Array<{
    id: string;
    status: string;
    preset: string;
    createdAt: string;
  }>;
}

