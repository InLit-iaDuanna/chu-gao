import { createHash } from "node:crypto";
import { z } from "zod";
import type { ResearchBriefInput, ResearchPlan } from "./types";
import { assessCandidate } from "./quality";
import {
  acquisitionSchema,
  decisionGapSchema,
  decisionCardSchema,
  evidenceDecisionRouteSchema,
  type DecisionGap,
  type DecisionCard,
} from "./decision-evidence";
import type { EvidenceDecisionRoute } from "./quality";

// Versioned application contracts, not claims about an upstream model's abilities.
export const RESEARCH_QUALITY_VERSION = "design-evidence-v3";
export const VERIFICATION_PLANNER_VERSION = "decision-gaps-v3";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
export function researchVersion(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

/** Total cumulative call ceiling at this stage. Reservation occurs under the task lock. */
export function stageCallCeiling(
  plan: ResearchPlan,
  stage: string,
  kind: "llm" | "search" | "crawl",
) {
  const limit = plan.limits[kind];
  const index = plan.stages.findIndex((item) => item.kind === stage);
  if (index < 0 || limit <= 0) return limit;
  const later = new Set(plan.stages.slice(index + 1).map((item) => item.kind));
  let reserved = 0;
  if (kind === "crawl") {
    if (later.has("verify")) reserved += Math.min(8, Math.ceil(limit * 0.25));
    if (later.has("capture")) reserved += Math.min(4, Math.ceil(limit * 0.12));
  } else if (kind === "search" && later.has("verify")) {
    reserved += Math.min(3, Math.ceil(limit * 0.2));
  } else if (kind === "llm") {
    if (later.has("verify")) reserved += 2;
    // Draft, editorial report, and final-report metadata share the existing
    // task quota. Earlier stages must leave all three calls available.
    if (later.has("synthesize")) reserved += 3;
    if (later.has("produce")) reserved += 3;
  }
  // Tiny plans still get one opportunity to work. This is an application allocation,
  // not a promise of sufficient research; unused capacity is available to later stages.
  return Math.max(1, limit - reserved);
}

const evidenceIds = z.array(z.string().min(1).max(100)).max(30);
export const verificationQuestionSchema = z
  .object({
    id: z.string().min(1).max(80),
    decision: z.string().min(2).max(400),
    query: z.string().trim().min(2).max(180),
    reason: z.string().min(2).max(600),
    evidenceIds,
  })
  .strict();
export const verificationPlanSchemaV2 = z
  .object({
    questions: z.array(verificationQuestionSchema).max(3),
  })
  .strict();
export const verificationCheckpointSchemaV2 = verificationPlanSchemaV2.extend({
  checkpoint: z.enum(["verification-v2", "verification-v3"]),
  briefHash: z.string(),
  researchHash: z.string(),
  plannerVersion: z.literal(VERIFICATION_PLANNER_VERSION),
  questionsVersion: z.string(),
  searched: z.array(z.string()).max(3),
  unresolved: z.array(z.string()).max(3),
  sourceIdsByQuestion: z.record(z.string(), z.array(z.string()).max(20)),
  acquisition: z.record(z.string(), acquisitionSchema).optional(),
  searchOutcomes: z
    .record(z.string(), z.enum(["reserved", "completed", "failed"]))
    .optional(),
  searchAttemptIds: z.record(z.string(), z.string().min(1).max(100)).optional(),
  decisionGaps: z.array(decisionGapSchema).max(3).optional(),
  decisionRoutes: z
    .array(
      evidenceDecisionRouteSchema.extend({
        contentHash: z.string().nullable().optional(),
      }),
    )
    .max(24)
    .optional(),
  reviewInputHash: z.string().optional(),
});
export function verificationIdentity(
  brief: ResearchBriefInput,
  research: Array<{ id: string; text: string }>,
) {
  return {
    briefHash: researchVersion(brief),
    researchHash: researchVersion(research),
    plannerVersion: VERIFICATION_PLANNER_VERSION,
  } as const;
}
export function restoreVerificationPlan(
  value: unknown,
  identity: ReturnType<typeof verificationIdentity>,
) {
  const parsed = verificationCheckpointSchemaV2.safeParse(value);
  if (!parsed.success) return null;
  const saved = parsed.data;
  if (
    saved.briefHash !== identity.briefHash ||
    saved.researchHash !== identity.researchHash ||
    saved.plannerVersion !== identity.plannerVersion ||
    saved.questionsVersion !== researchVersion(saved.questions)
  )
    return null;
  const ids = new Set(saved.questions.map((question) => question.id));
  if (
    ids.size !== saved.questions.length ||
    [
      ...saved.searched,
      ...saved.unresolved,
      ...Object.keys(saved.acquisition ?? {}),
      ...Object.keys(saved.sourceIdsByQuestion),
    ].some((id) => !ids.has(id)) ||
    [
      ...Object.keys(saved.searchOutcomes ?? {}),
      ...Object.keys(saved.searchAttemptIds ?? {}),
    ].some((key) => {
      const separator = key.lastIndexOf("/");
      return (
        !ids.has(key.slice(0, separator)) ||
        !["primary", "fallback"].includes(key.slice(separator + 1))
      );
    }) ||
    saved.decisionGaps?.some((gap) => !ids.has(gap.id)) ||
    (saved.decisionGaps &&
      new Set(saved.decisionGaps.map((gap) => gap.id)).size !==
        saved.decisionGaps.length) ||
    saved.decisionRoutes?.some((route) =>
      route.decisionIds.some((id) => !ids.has(id)),
    ) ||
    (saved.decisionRoutes &&
      new Set(saved.decisionRoutes.map((route) => route.evidenceId)).size !==
        saved.decisionRoutes.length)
  )
    return null;
  return saved;
}

export function verificationQuestionRelevant(
  question: z.infer<typeof verificationQuestionSchema>,
  brief: ResearchBriefInput,
  evidence: Array<{ id: string; title: string; content?: string }>,
) {
  const query = assessCandidate(
    {
      url: "https://verification.invalid/query",
      title: question.query,
      excerpt: "",
    },
    brief,
  );
  const decision = assessCandidate(
    {
      url: "https://verification.invalid/decision",
      title: question.decision,
      excerpt: "",
    },
    brief,
  );
  // 'review' with no matching words is deliberately insufficient to authorize a
  // paid verification query. A precise SKU already present in supplied evidence
  // is an alternate anchor even when its name differs from the product category.
  const identifiers =
    question.query.match(/\b[A-Za-z][A-Za-z0-9_-]*\d[A-Za-z0-9_-]*\b/g) ?? [];
  const knownSku = identifiers.some((identifier) =>
    evidence.some(
      (source) =>
        question.evidenceIds.includes(source.id) &&
        `${source.title} ${source.content ?? ""}`
          .toLowerCase()
          .split(/[^a-z0-9_-]+/)
          .includes(identifier.toLowerCase()),
    ),
  );
  return (
    decision.matchedTerms.length > 0 &&
    (query.matchedTerms.length > 0 || knownSku)
  );
}

export const finalBriefSchema = z
  .object({
    goal: z.string().min(2).max(2000),
    // Filled by the application from actual user answers, never by the model.
    confirmedRequirements: z.array(z.string().max(8000)).max(40),
    scope: z.string().max(3000),
    alternatives: z
      .array(
        z
          .object({
            name: z.string().max(300),
            benefit: z.string().max(1000),
            tradeoff: z.string().max(1000),
            evidenceIds,
            status: z.enum(["supported", "hypothesis", "unknown"]),
          })
          .strict(),
      )
      .max(8),
    acceptanceCriteria: z.array(z.string().max(1000)).max(20),
    openQuestions: z.array(z.string().max(1000)).max(20),
  })
  .strict();
export const hypothesisSchema = z
  .object({
    id: z.string().min(1).max(100),
    text: z.string().min(1).max(120),
    basis: z.string().min(1).max(160),
    status: z.enum(["unverified", "supported", "rejected"]),
    evidenceIds,
  })
  .strict();
export const researchDeliverablesSchemaV2 = z
  .object({
    finalBrief: finalBriefSchema.omit({ confirmedRequirements: true }),
    hypotheses: z.array(hypothesisSchema).max(30),
    caveats: z.array(z.string().min(1).max(500)).max(12),
    competitors: z
      .array(
        z
          .object({
            name: z.string().min(1).max(300),
            kind: z.enum(["sku", "category", "alternative"]),
            positioning: z.string().max(1500),
            price: z.string().max(500),
            market: z.string().max(300),
            observedAt: z.string().max(100),
            observations: z.string().max(2000),
            evidenceIds,
            status: z.enum(["observed", "unverified"]),
          })
          .strict(),
      )
      .max(24),
  })
  .strict();
export type ResearchDeliverablesV2 = z.infer<
  typeof researchDeliverablesSchemaV2
>;
export const researchDeliverablesSchemaV3 = researchDeliverablesSchemaV2.extend(
  {
    decisionCards: z.array(decisionCardSchema).max(6),
  },
);

export function validateDeliverableEvidence(
  metadata: ResearchDeliverablesV2,
  includedIds: Iterable<string>,
  capturedIds: Iterable<string> = [],
) {
  const allowed = new Set(includedIds);
  const captured = new Set(capturedIds);
  const errors: string[] = [];
  for (const item of [
    ...metadata.competitors,
    ...metadata.hypotheses,
    ...metadata.finalBrief.alternatives,
  ]) {
    for (const id of item.evidenceIds)
      if (!allowed.has(id)) errors.push(`未知或本轮未读的证据 ID: ${id}`);
    if (
      ["observed", "supported"].includes(item.status) &&
      !item.evidenceIds.length
    )
      errors.push("观察/有支持的项目缺少结构化证据 ID");
    if (
      ["observed", "supported"].includes(item.status) &&
      item.evidenceIds.some((id) => !captured.has(id))
    )
      errors.push(
        "观察/有支持的项目只能引用本轮实际纳入的留档原文，不能把搜索摘要当原文",
      );
  }
  const hypothesisIds = metadata.hypotheses.map((row) => row.id);
  if (new Set(hypothesisIds).size !== hypothesisIds.length)
    errors.push("假设 ID 重复");
  return [...new Set(errors)];
}

export function finalBriefMarkdown(
  brief: z.infer<typeof finalBriefSchema>,
  hypotheses: ResearchDeliverablesV2["hypotheses"],
  caveats: string[],
) {
  const list = (items: string[]) =>
    items.length ? items.map((item) => `- ${item}`).join("\n") : "- 尚未确定";
  return `# 设计 brief\n\n## 目标\n\n${brief.goal}\n\n## 用户已表达的需求（原文）\n\n${list(brief.confirmedRequirements)}\n\n## 当前研究范围\n\n${brief.scope}\n\n## 候选方向与取舍\n\n${list(brief.alternatives.map((item) => `**${item.name}**（${item.status}）：${item.benefit}；代价：${item.tradeoff} ${item.evidenceIds.map((id) => `[${id}]`).join(" ")}`))}\n\n## 验收标准\n\n${list(brief.acceptanceCriteria)}\n\n## 待验证假设\n\n${list(hypotheses.map((item) => `[${item.id}] ${item.text}；依据：${item.basis}；状态：${item.status}`))}\n\n## 尚未回答\n\n${list(brief.openQuestions)}\n\n## 使用限制\n\n${list(caveats)}\n`;
}

/** Refresh reorganizes the same evidence. It has no authority to silently
 * close an old design question or an unresolved verification question.
 */
export function mergeOpenResearchQuestions(
  inherited: readonly string[],
  unresolved: readonly string[],
  generated: readonly string[],
) {
  return [
    ...new Set(
      [...inherited, ...unresolved, ...generated]
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
}

export function createFinalResearchPackage(input: {
  taskId: string;
  briefId: string;
  stageId: string;
  attemptId: string;
  report: string;
  metadata: ResearchDeliverablesV2;
  confirmedRequirements: string[];
  quality: Record<string, unknown>;
  evidenceManifest: unknown;
  evidence: unknown[];
  generatedAt: string;
  decisionGaps?: DecisionGap[];
  decisionRoutes?: EvidenceDecisionRoute[];
  decisionCards?: DecisionCard[];
}) {
  const content = {
    schemaVersion: 2 as const,
    policyVersion: RESEARCH_QUALITY_VERSION,
    taskId: input.taskId,
    briefId: input.briefId,
    report: {
      text: input.report,
      stageId: input.stageId,
      attemptId: input.attemptId,
      hash: researchVersion(input.report),
    },
    finalBrief: {
      ...input.metadata.finalBrief,
      confirmedRequirements: input.confirmedRequirements,
    },
    hypotheses: input.metadata.hypotheses,
    competitors: input.metadata.competitors,
    caveats: input.metadata.caveats,
    quality: input.quality,
    evidenceManifest: input.evidenceManifest,
    evidence: input.evidence,
    ...(input.decisionGaps ? { decisionGaps: input.decisionGaps } : {}),
    ...(input.decisionRoutes ? { decisionRoutes: input.decisionRoutes } : {}),
    ...(input.decisionCards ? { decisionCards: input.decisionCards } : {}),
  };
  return {
    ...content,
    version: researchVersion(content),
    generatedAt: input.generatedAt,
  };
}

export function readFinalResearchPackage(
  value: unknown,
): ReturnType<typeof createFinalResearchPackage> | null {
  if (!value || typeof value !== "object") return null;
  const parsed = z
    .object({
      schemaVersion: z.literal(2),
      policyVersion: z.enum(["design-evidence-v2", RESEARCH_QUALITY_VERSION]),
      taskId: z.string().min(1),
      briefId: z.string().min(1),
      version: z.string().regex(/^[a-f0-9]{64}$/),
      generatedAt: z.iso.datetime(),
      report: z
        .object({
          text: z.string().min(1),
          stageId: z.string().min(1),
          attemptId: z.string().min(1),
          hash: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict(),
      finalBrief: finalBriefSchema,
      hypotheses: z.array(hypothesisSchema).max(30),
      competitors: researchDeliverablesSchemaV2.shape.competitors,
      caveats: z.array(z.string().min(1).max(500)).max(32),
      decisionGaps: z.array(decisionGapSchema).max(40).optional(),
      decisionRoutes: z
        .array(
          evidenceDecisionRouteSchema.extend({
            contentHash: z.string().nullable().optional(),
          }),
        )
        .max(40)
        .optional(),
      decisionCards: z.array(decisionCardSchema).max(6).optional(),
      quality: z
        .object({
          schemaVersion: z.literal(1),
          status: z.enum(["draft", "insufficient", "supported"]),
          issues: z.array(
            z.object({
              code: z.string(),
              severity: z.enum(["warning", "error"]),
              message: z.string(),
            }),
          ),
        })
        .passthrough(),
      evidenceManifest: z
        .object({
          schemaVersion: z.literal(1),
          sources: z.array(
            z
              .object({
                evidenceId: z.string(),
                capturedChars: z.number().nullable(),
                includedChars: z.number().nonnegative(),
                omittedReason: z.string().nullable(),
              })
              .passthrough(),
          ),
        })
        .passthrough(),
      evidence: z.array(
        z
          .object({
            id: z.string().min(1),
            url: z.string(),
            status: z.string(),
            content: z.string(),
            contentKind: z.enum([
              "captured_text",
              "user_provided_text",
              "search_excerpt",
            ]),
            sourceAvailability: z.string(),
          })
          .passthrough(),
      ),
    })
    .strict()
    .safeParse(value);
  if (!parsed.success) return null;
  const candidate = value as ReturnType<typeof createFinalResearchPackage>;
  if (candidate.report.hash !== researchVersion(candidate.report.text))
    return null;
  const { version, generatedAt: _generatedAt, ...content } = candidate;
  void _generatedAt;
  return researchVersion(content) === version ? candidate : null;
}

