import { createHash } from "node:crypto";
import { z } from "zod";
import { researchSourceText } from "./source-text";
import {
  validateEvidenceDecisionRoutes,
  validateEvidenceIds,
  type EvidenceDecisionRoute,
} from "./quality";

// Application evidence judgments, never claims of external/human verification.
export const DECISION_REVIEW_VERSION = "decision-review-v3";
export const acquisitionSchema = z.enum([
  "not_searched",
  "searched",
  "read",
  "unavailable",
]);
export const decisionStatusSchema = z.enum([
  "supported",
  "contradicted",
  "insufficient",
  "conflicting",
]);
export const evidenceDecisionRouteSchema = z
  .object({
    evidenceId: z.string().min(1).max(100),
    role: z.enum([
      "product_identity",
      "task_observation",
      "constraint",
      "alternative",
      "background",
      "design_reference",
      "irrelevant",
    ]),
    decisionIds: z.array(z.string().min(1).max(80)).max(3),
    reason: z.string().min(2).max(600),
  })
  .strict();
const citationInput = z
  .object({
    evidenceId: z.string().min(1).max(100),
    quote: z.string().min(8).max(800),
  })
  .strict();
export const verificationAssessmentSchema = z
  .object({
    sourceRoutes: z.array(evidenceDecisionRouteSchema).max(24),
    answers: z
      .array(
        z
          .object({
            questionId: z.string().min(1).max(80),
            status: decisionStatusSchema,
            coverage: z.enum(["complete", "partial", "none"]),
            finding: z.string().min(2).max(1200),
            implication: z.string().max(1000),
            nextCheck: z.string().max(1000),
            changeCondition: z.string().max(1000),
            citations: z.array(citationInput).max(6),
          })
          .strict(),
      )
      .max(3),
  })
  .strict();
export const decisionGapSchema = z
  .object({
    id: z.string().min(1).max(100),
    decision: z.string().min(1).max(1000),
    acquisitionStatus: acquisitionSchema,
    status: decisionStatusSchema,
    finding: z.string().max(2000),
    implication: z.string().max(1000),
    nextCheck: z.string().max(1000),
    changeCondition: z.string().max(1000),
    reviewedBy: z.enum(["model_assessed", "legacy_unassessed", "not_assessed"]),
    citations: z
      .array(
        z
          .object({
            evidenceId: z.string().min(1).max(100),
            contentHash: z.string().min(1).max(128),
            quote: z.string().min(8).max(800),
            start: z.number().int().nonnegative(),
            end: z.number().int().positive(),
            coordinateSystem: z.literal("retained_text_utf16"),
          })
          .strict(),
      )
      .max(6),
    validationIssues: z.array(z.string().max(400)).max(20),
  })
  .strict();
export type DecisionGap = z.infer<typeof decisionGapSchema>;
export type VerificationAssessment = z.infer<
  typeof verificationAssessmentSchema
>;
export interface DecisionQuestion {
  id: string;
  decision: string;
  query?: string;
}
export interface ReviewSource {
  id: string;
  title?: string;
  content: string;
  contentKind: string;
  contentHash?: string | null;
  contentRanges?: Array<{ start: number; end: number }>;
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
const directRoles = new Set([
  "product_identity",
  "task_observation",
  "constraint",
  "alternative",
]);
export function unresolvedDecisionGaps(gaps: DecisionGap[]) {
  return gaps.filter((gap) =>
    ["insufficient", "conflicting"].includes(gap.status),
  );
}
export function unassessedDecisionGap(
  question: DecisionQuestion,
  acquisitionStatus: DecisionGap["acquisitionStatus"] = "not_searched",
): DecisionGap {
  return {
    id: question.id,
    decision: question.decision,
    acquisitionStatus,
    status: "insufficient",
    reviewedBy: "not_assessed",
    citations: [],
    finding: "尚未取得能回答这个设计问题的已核对材料。",
    implication: "保留方案选择，不将采集成功作为结论。",
    nextCheck: question.query ?? "补充该问题对应的原始资料或情境观察。",
    changeCondition: "新材料能够直接支持或反驳问题中的完整命题。",
    validationIssues: [],
  };
}

/** Validate exact quoted spans, current body versions and the question scope.
 * This is an evidence-link gate, not an automatic truth or semantic oracle.
 */
export function assessDecisionAnswers(input: {
  assessment: VerificationAssessment;
  questions: DecisionQuestion[];
  sources: ReviewSource[];
  retained: Array<{
    id: string;
    content?: string | null;
    contentHash?: string | null;
  }>;
  acquisition: Record<string, DecisionGap["acquisitionStatus"]>;
}) {
  const questions = new Map(input.questions.map((q) => [q.id, q]));
  const sources = new Map(input.sources.map((s) => [s.id, s]));
  const retained = new Map(input.retained.map((s) => [s.id, s]));
  const routeCounts = new Map<string, number>();
  for (const route of input.assessment.sourceRoutes)
    routeCounts.set(
      route.evidenceId,
      (routeCounts.get(route.evidenceId) ?? 0) + 1,
    );
  const routes: EvidenceDecisionRoute[] = [];
  const issues: string[] = [];
  for (const route of input.assessment.sourceRoutes) {
    const source = sources.get(route.evidenceId);
    if (
      !source ||
      routeCounts.get(route.evidenceId) !== 1 ||
      route.decisionIds.some((id) => !questions.has(id))
    ) {
      issues.push("来源分流包含未知、重复来源或未知问题，未采用该分类。");
      continue;
    }
    const raw = retained.get(source.id);
    try {
      routes.push(
        ...validateEvidenceDecisionRoutes(
          [
            {
              ...route,
              contentHash:
                source.contentHash ??
                raw?.contentHash ??
                digest(source.content),
            },
          ],
          sources.keys(),
          questions.keys(),
        ),
      );
    } catch {
      issues.push(
        "来源分流缺少唯一问题或有效正文版本，保持待核对，不用于后续核心材料判断。",
      );
    }
  }
  const routeMap = new Map(routes.map((route) => [route.evidenceId, route]));
  const gaps = input.questions.map((question): DecisionGap => {
    const matches = input.assessment.answers.filter(
      (a) => a.questionId === question.id,
    );
    const initial = unassessedDecisionGap(
      question,
      input.acquisition[question.id],
    );
    if (matches.length !== 1)
      return {
        ...initial,
        validationIssues: ["该问题缺少唯一核验结果，保持未解决。"],
      };
    const answer = matches[0];
    const validationIssues: string[] = [];
    const citations: DecisionGap["citations"] = [];
    // An explicit SKU in the decision is a hard entity anchor. Reading another
    // product cannot settle this SKU's capabilities even if both are appliances.
    const identifiers =
      question.decision.match(/\b[A-Za-z][A-Za-z0-9_-]*\d[A-Za-z0-9_-]*\b/g) ??
      [];
    for (const quote of answer.citations) {
      const source = sources.get(quote.evidenceId);
      const raw = retained.get(quote.evidenceId);
      const route = routeMap.get(quote.evidenceId);
      if (
        !source ||
        !["captured_text", "user_provided_text"].includes(source.contentKind) ||
        !raw?.content
      ) {
        validationIssues.push("引用未指向本次实际读取的原始正文。");
        continue;
      }
      if (
        !route ||
        !directRoles.has(route.role) ||
        !route.decisionIds.includes(question.id)
      ) {
        validationIssues.push("引用没有被明确分流到该设计问题的直接证据。");
        continue;
      }
      if (
        source.contentHash &&
        raw.contentHash &&
        source.contentHash !== raw.contentHash
      ) {
        validationIssues.push("引用正文版本已变化，需要重新核验。");
        continue;
      }
      const body = researchSourceText(raw.content);
      const subjectText = ((source.title ?? "") + " " + body).toLowerCase();
      if (identifiers.some((id) => !subjectText.includes(id.toLowerCase()))) {
        validationIssues.push("引用对应的产品与问题中的具体型号不一致。");
        continue;
      }
      let start = -1;
      for (const range of source.contentRanges ?? [
        { start: 0, end: body.length },
      ]) {
        const local = body.slice(range.start, range.end).indexOf(quote.quote);
        if (local >= 0 && source.content.includes(quote.quote)) {
          start = range.start + local;
          break;
        }
      }
      if (start < 0) {
        validationIssues.push(
          "引文未逐字出现在本次已读正文区间，或跨越省略区间。",
        );
        continue;
      }
      const citation = {
        evidenceId: source.id,
        contentHash: source.contentHash ?? raw.contentHash ?? digest(body),
        quote: quote.quote,
        start,
        end: start + quote.quote.length,
        coordinateSystem: "retained_text_utf16" as const,
      };
      if (
        !citations.some(
          (item) =>
            item.evidenceId === citation.evidenceId &&
            item.start === citation.start,
        )
      )
        citations.push(citation);
    }
    let status = answer.status;
    if (
      answer.coverage !== "complete" ||
      !citations.length ||
      validationIssues.length
    )
      status = "insufficient";
    if (
      status === "conflicting" &&
      new Set(citations.map((c) => c.contentHash)).size < 2
    ) {
      status = "insufficient";
      validationIssues.push("冲突判断缺少两个不同正文版本的可核对材料。");
    }
    return {
      ...initial,
      status,
      finding: answer.finding,
      implication: answer.implication,
      nextCheck: answer.nextCheck,
      changeCondition: answer.changeCondition,
      reviewedBy: "model_assessed",
      citations,
      validationIssues: [...new Set(validationIssues)],
    };
  });
  if (
    input.assessment.answers.some((answer) => !questions.has(answer.questionId))
  )
    issues.push("核验结果包含未知问题，已忽略。");
  return { gaps, routes, issues: [...new Set(issues)] };
}

export function decisionReviewMarkdown(gaps: DecisionGap[]) {
  const labels: Record<DecisionGap["status"], string> = {
    supported: "材料支持（模型判断）",
    contradicted: "材料反驳（模型判断）",
    insufficient: "证据不足",
    conflicting: "材料存在冲突",
  };
  const sections = gaps.map((gap) =>
    [
      "## " + gap.decision,
      "**当前判断：" + labels[gap.status] + "**",
      gap.finding,
      gap.citations
        .map((c) => "- [" + c.evidenceId + "] “" + c.quote + "”")
        .join("\n"),
      gap.implication ? "**设计含义：**" + gap.implication : "",
      gap.nextCheck ? "**下一步：**" + gap.nextCheck : "",
      gap.changeCondition ? "**会改变选择的条件：**" + gap.changeCondition : "",
      gap.validationIssues.length
        ? "**引用检查：**" + gap.validationIssues.join("；")
        : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
  );
  return (
    "# 关键设计问题与证据\n\n" +
    sections.join("\n\n") +
    "\n\n> 结论为对当前材料的模型判断；引文与版本检查不等于人工或实物验证。\n"
  );
}

/** Old packages contain counts/strings, not answers. Carry them as unknowns;
 * never let missing fields silently turn unresolved questions into zero.
 */
export function inheritDecisionState(values: unknown[]) {
  const gaps = new Map<string, DecisionGap>();
  const routes = new Map<string, EvidenceDecisionRoute>();
  for (const value of values) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const result = value as Record<string, unknown>;
    const candidate = result.finalResearchPackage;
    const packet =
      candidate && typeof candidate === "object" && !Array.isArray(candidate)
        ? (candidate as Record<string, unknown>)
        : result;
    const parsed = z
      .array(decisionGapSchema)
      .max(40)
      .safeParse(packet.decisionGaps ?? result.decisionGaps);
    if (parsed.success) {
      for (const gap of parsed.data) gaps.set(gap.id, gap);
    } else {
      const unresolved = Array.isArray(result.unresolved)
        ? result.unresolved.filter(
            (x): x is string => typeof x === "string" && !!x.trim(),
          )
        : [];
      const quality = packet.quality as
        | { metrics?: { unresolvedQuestions?: unknown } }
        | undefined;
      const count = quality?.metrics?.unresolvedQuestions;
      const total =
        typeof count === "number" && Number.isSafeInteger(count)
          ? Math.min(20, Math.max(0, count))
          : 0;
      const decisions = [...new Set(unresolved)];
      // A preceding verify stage may already identify the questions represented
      // by the legacy package's count. Do not add a second set of placeholders.
      while (
        new Set([...gaps.values()].map((g) => g.decision).concat(decisions))
          .size < total
      )
        decisions.push("旧版本未定位的核验缺口 " + (decisions.length + 1));
      for (const decision of decisions.slice(0, 40)) {
        const id = "legacy-" + digest(decision).slice(0, 16);
        gaps.set(id, {
          ...unassessedDecisionGap({ id, decision }, "unavailable"),
          reviewedBy: "legacy_unassessed",
          finding:
            "继承旧版本的未解决事项；旧记录未包含可复核的结论与引文，不能因重新整理而清零。",
        });
      }
    }
    const savedRoutes = packet.decisionRoutes ?? result.decisionRoutes;
    if (Array.isArray(savedRoutes))
      for (const row of savedRoutes) {
        const p = evidenceDecisionRouteSchema
          .extend({ contentHash: z.string().nullable().optional() })
          .safeParse(row);
        if (p.success) {
          try {
            const [route] = validateEvidenceDecisionRoutes(
              [p.data],
              [p.data.evidenceId],
            );
            routes.set(route.evidenceId, route);
          } catch {
            /* A legacy malformed route remains unreviewed, never a late packing exception. */
          }
        }
      }
  }
  return { gaps: [...gaps.values()], routes: [...routes.values()] };
}

/** Reformatting cannot upgrade evidence, and a purged/changed original cannot
 * silently keep an earlier supported judgment current. Preserve its old quotes
 * for audit, but mark the current decision unresolved until it is reviewed again.
 */
export function reconcileDecisionState(
  gaps: DecisionGap[],
  retained: Array<{
    id: string;
    content?: string | null;
    contentHash?: string | null;
  }>,
) {
  const byId = new Map(retained.map((row) => [row.id, row]));
  return gaps.map((gap): DecisionGap => {
    if (!["supported", "contradicted", "conflicting"].includes(gap.status))
      return gap;
    const current =
      gap.citations.length > 0 &&
      gap.citations.every((citation) => {
        const row = byId.get(citation.evidenceId);
        if (!row?.content) return false;
        const body = researchSourceText(row.content);
        return (
          (row.contentHash ?? digest(body)) === citation.contentHash &&
          body.slice(citation.start, citation.end) === citation.quote
        );
      });
    return current
      ? gap
      : {
          ...gap,
          status: "insufficient",
          acquisitionStatus: "unavailable",
          validationIssues: [
            ...new Set([
              ...gap.validationIssues,
              "上次判断所依赖的原文已变化或当前不可读，保留历史引句，需要重新核验。",
            ]),
          ].slice(0, 20),
        };
  });
}

/** A query reformulation is a separate, budgeted search and never a network retry. */
export function verificationFallbackQuery(query: string) {
  const parts = query.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 2) return null;
  const identifiers = parts.filter((part) => /[A-Za-z].*\d/.test(part));
  const remaining = parts.filter((part) => !identifiers.includes(part));
  const selected = identifiers.length
    ? [...identifiers.slice(0, 1), ...remaining.slice(0, 1)]
    : parts.slice(0, 2);
  const simplified = selected.join(" ");
  return simplified.length >= 2 && simplified !== query.trim()
    ? simplified
    : null;
}

/** A new attempt exists only through the task's explicit retry operation.
 * Completed work is never repeated; uncertain work is not resent within the
 * same attempt or when its owner is unknown in a legacy checkpoint.
 */
export function shouldRunVerificationSearch(
  outcome: "reserved" | "completed" | "failed" | undefined,
  ownerAttemptId: string | undefined,
  currentAttemptId: string,
) {
  return (
    !outcome ||
    (outcome !== "completed" &&
      Boolean(ownerAttemptId) &&
      ownerAttemptId !== currentAttemptId)
  );
}

export const decisionCardSchema = z
  .object({
    id: z.string().min(1).max(80),
    title: z.string().min(2).max(120),
    finding: z.string().min(2).max(900),
    interpretation: z.string().min(2).max(900),
    action: z.string().min(2).max(900),
    tradeoff: z.string().min(2).max(900),
    nextTest: z.string().min(2).max(900),
    changeCondition: z.string().min(2).max(900),
    status: z.enum(["evidence_informed", "hypothesis", "unknown"]),
    evidenceIds: z.array(z.string().min(1).max(100)).max(12),
  })
  .strict();
export type DecisionCard = z.infer<typeof decisionCardSchema>;

export function validateDecisionCards(
  cards: DecisionCard[],
  sources: ReviewSource[],
  options: {
    decisionRoutes?: readonly EvidenceDecisionRoute[];
    requireDecisionRoutes?: boolean;
    reportText?: string;
  } = {},
) {
  const allowed = new Set(sources.map((s) => s.id));
  const read = new Set(
    sources
      .filter(
        (s) =>
          ["captured_text", "user_provided_text"].includes(s.contentKind) &&
          s.content.trim(),
      )
      .map((s) => s.id),
  );
  const errors: string[] = [];
  const direct = new Set(
    (options.decisionRoutes ?? [])
      .filter((route) => {
        const source = sources.find((row) => row.id === route.evidenceId);
        return (
          read.has(route.evidenceId) &&
          directRoles.has(route.role) &&
          route.decisionIds.length > 0 &&
          !!route.contentHash &&
          route.contentHash === source?.contentHash
        );
      })
      .map((route) => route.evidenceId),
  );
  const cited =
    options.reportText === undefined
      ? null
      : new Set(validateEvidenceIds(options.reportText, allowed).referencedIds);
  if (new Set(cards.map((card) => card.id)).size !== cards.length)
    errors.push("设计决策卡 ID 重复");
  for (const card of cards) {
    if (card.evidenceIds.some((id) => !allowed.has(id)))
      errors.push("设计决策卡引用了本轮未提供的证据");
    if (
      card.status === "evidence_informed" &&
      (!card.evidenceIds.length || card.evidenceIds.some((id) => !read.has(id)))
    )
      errors.push("有材料依据的设计决策卡必须关联本次已读的原始正文");
    if (
      card.status === "evidence_informed" &&
      options.requireDecisionRoutes &&
      !card.evidenceIds.some((id) => direct.has(id))
    )
      errors.push(
        "有材料依据的设计决策卡需要当前版本、与问题直接相关的核验材料；背景页不能单独支持该标签",
      );
    if (
      card.status === "evidence_informed" &&
      cited &&
      !card.evidenceIds.some(
        (id) =>
          cited.has(id) && (!options.requireDecisionRoutes || direct.has(id)),
      )
    )
      errors.push(
        "设计决策卡的材料依据必须已在终稿中引用，不能在元数据阶段补入新事实",
      );
  }
  return [...new Set(errors)];
}

