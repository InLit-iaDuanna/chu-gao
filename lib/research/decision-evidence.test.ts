import { describe, expect, it } from "vitest";
import {
  assessDecisionAnswers,
  decisionReviewMarkdown,
  inheritDecisionState,
  reconcileDecisionState,
  unresolvedDecisionGaps,
  validateDecisionCards,
  verificationFallbackQuery,
  verificationAssessmentSchema,
  shouldRunVerificationSearch,
  type DecisionCard,
  type VerificationAssessment,
} from "./decision-evidence";

const body =
  "样例 MR9086。\n🟢 第一步准备三分钟，第二步加热三分钟，第三步组合三分钟，完整流程约九分钟。\n此产品为受邀评测样品。";
const quote =
  "第一步准备三分钟，第二步加热三分钟，第三步组合三分钟，完整流程约九分钟。";
function fixture() {
  return {
    questions: [
      { id: "q1", decision: "MR9086 的完整操作流程是否包含准备和组合？" },
    ],
    sources: [
      {
        id: "e1",
        title: "MR9086 个案",
        content: body,
        contentKind: "captured_text",
        contentHash: "1".repeat(64),
        contentRanges: [{ start: 0, end: body.length }],
      },
    ],
    retained: [{ id: "e1", content: body, contentHash: "1".repeat(64) }],
    acquisition: { q1: "read" as const },
    assessment: {
      sourceRoutes: [
        {
          evidenceId: "e1",
          role: "task_observation",
          decisionIds: ["q1"],
          reason: "可读到同型号的三步操作，但只是受邀个案。",
        },
      ],
      answers: [
        {
          questionId: "q1",
          status: "supported",
          coverage: "complete",
          finding: "原文描述三个步骤。",
          implication: "计时应覆盖完整过程。",
          nextCheck: "按同一食材实测准备到清洁。",
          changeCondition: "若清洁成为主要耗时，应优先调整拆洗方案。",
          citations: [{ evidenceId: "e1", quote }],
        },
      ],
    } satisfies VerificationAssessment,
  };
}

describe("decision evidence rather than acquisition success", () => {
  it("retains exact UTF-16 source coordinates and the source version for a supported answer", () => {
    const input = fixture();
    const result = assessDecisionAnswers(input);
    const gap = result.gaps[0];
    expect(gap.status).toBe("supported");
    expect(gap.reviewedBy).toBe("model_assessed");
    expect(gap.citations[0]).toMatchObject({
      start: body.indexOf(quote),
      contentHash: "1".repeat(64),
      coordinateSystem: "retained_text_utf16",
    });
    expect(body.slice(gap.citations[0].start, gap.citations[0].end)).toBe(
      quote,
    );
    expect(unresolvedDecisionGaps(result.gaps)).toHaveLength(0);
    expect(decisionReviewMarkdown(result.gaps)).toContain("模型判断");
  });
  it("never closes a question merely because its page was read", () => {
    const input = fixture();
    input.assessment.answers[0].citations = [];
    const [gap] = assessDecisionAnswers(input).gaps;
    expect(gap.acquisitionStatus).toBe("read");
    expect(gap.status).toBe("insufficient");
  });
  it("retains partial support as unresolved even with an exact source quotation", () => {
    const input = fixture();
    const assessment: VerificationAssessment = {
      ...input.assessment,
      answers: [{ ...input.assessment.answers[0], coverage: "partial" }],
    };
    expect(assessDecisionAnswers({ ...input, assessment }).gaps[0].status).toBe(
      "insufficient",
    );
  });
  it("rejects a quote from a different specific SKU", () => {
    const input = fixture();
    input.questions[0].decision = "AB123 的完整操作流程是否包含准备和组合？";
    const [gap] = assessDecisionAnswers(input).gaps;
    expect(gap.status).toBe("insufficient");
    expect(gap.validationIssues.join("")).toContain("型号");
  });
  it.each([
    "unknown",
    "unread-range",
    "changed-version",
    "search-snippet",
    "wrong-question-route",
    "altered-quote",
  ])("does not accept %s as original-text support", (failure) => {
    const input = fixture();
    if (failure === "unknown")
      input.assessment.answers[0].citations[0].evidenceId = "not-provided";
    if (failure === "unread-range")
      input.sources[0].contentRanges = [{ start: 0, end: 12 }];
    if (failure === "changed-version")
      input.retained[0].contentHash = "2".repeat(64);
    if (failure === "search-snippet")
      input.sources[0].contentKind = "search_excerpt";
    if (failure === "wrong-question-route")
      input.assessment.sourceRoutes[0].decisionIds = [];
    if (failure === "altered-quote")
      input.assessment.answers[0].citations[0].quote =
        "完整流程只需要三分钟，营养还会自动计算。";
    const [gap] = assessDecisionAnswers(input).gaps;
    expect(gap.status).toBe("insufficient");
    expect(gap.citations).toHaveLength(0);
    expect(gap.validationIssues.length).toBeGreaterThan(0);
  });
  it("requires a unique answer and unique source route", () => {
    const input = fixture();
    input.assessment.answers.push({ ...input.assessment.answers[0] });
    expect(assessDecisionAnswers(input).gaps[0].status).toBe("insufficient");
    input.assessment.answers.pop();
    input.assessment.sourceRoutes.push({ ...input.assessment.sourceRoutes[0] });
    const result = assessDecisionAnswers(input);
    expect(result.routes).toHaveLength(0);
    expect(result.gaps[0].status).toBe("insufficient");
  });
  it("a contradicted proposition can be answered without being shown as supported", () => {
    const input = fixture();
    const assessment: VerificationAssessment = {
      ...input.assessment,
      answers: [{ ...input.assessment.answers[0], status: "contradicted" }],
    };
    const result = assessDecisionAnswers({ ...input, assessment });
    expect(result.gaps[0].status).toBe("contradicted");
    expect(unresolvedDecisionGaps(result.gaps)).toHaveLength(0);
    expect(decisionReviewMarkdown(result.gaps)).toContain("材料反驳");
  });
  it("does not infer a conflict from one body version", () => {
    const input = fixture();
    const assessment: VerificationAssessment = {
      ...input.assessment,
      answers: [{ ...input.assessment.answers[0], status: "conflicting" }],
    };
    expect(assessDecisionAnswers({ ...input, assessment }).gaps[0].status).toBe(
      "insufficient",
    );
  });
  it("rejects malformed structured review instead of filling invented fields", () => {
    expect(
      verificationAssessmentSchema.safeParse({
        answers: [],
        sourceRoutes: [],
        imaginarySuccess: true,
      }).success,
    ).toBe(false);
  });
});

describe("decision state across report refreshes", () => {
  it("keeps legacy unresolved counts visible when the old synthesis has no string list", () => {
    const result = inheritDecisionState([
      {
        finalResearchPackage: {
          quality: { metrics: { unresolvedQuestions: 2 } },
        },
      },
    ]);
    expect(result.gaps).toHaveLength(2);
    expect(
      result.gaps.every(
        (gap) =>
          gap.status === "insufficient" &&
          gap.reviewedBy === "legacy_unassessed",
      ),
    ).toBe(true);
  });
  it("uses the original questions from verify without adding duplicate count placeholders", () => {
    const result = inheritDecisionState([
      { unresolved: ["低油能力是否有证据？", "营养计算是否有证据？"] },
      {
        finalResearchPackage: {
          quality: { metrics: { unresolvedQuestions: 2 } },
        },
      },
    ]);
    expect(result.gaps.map((gap) => gap.decision)).toEqual([
      "低油能力是否有证据？",
      "营养计算是否有证据？",
    ]);
  });
  it("preserves a structured gap through a frozen package and subsequent refresh", () => {
    const input = fixture();
    input.assessment.answers[0].citations = [];
    const gap = assessDecisionAnswers(input).gaps[0];
    const result = inheritDecisionState([
      { decisionGaps: [gap] },
      { finalResearchPackage: { decisionGaps: [gap] } },
    ]);
    expect(result.gaps).toEqual([gap]);
  });
  it("downgrades a historical judgment if its original has changed or been purged, keeping the old quote", () => {
    const input = fixture();
    const gaps = assessDecisionAnswers(input).gaps;
    expect(reconcileDecisionState(gaps, input.retained)).toEqual(gaps);
    for (const retained of [
      [],
      [{ ...input.retained[0], contentHash: "new-version" }],
    ]) {
      const [gap] = reconcileDecisionState(gaps, retained);
      expect(gap.status).toBe("insufficient");
      expect(gap.citations).toEqual(gaps[0].citations);
      expect(gap.validationIssues.join("")).toContain("原文已变化");
    }
  });
  it("a narrower fallback is a distinct query and never a repeat of a short query", () => {
    expect(verificationFallbackQuery("MR9086 说明书 全流程 清洁")).toBe(
      "MR9086 说明书",
    );
    expect(verificationFallbackQuery("MR9086 说明书")).toBeNull();
    expect(verificationFallbackQuery("早餐全流程")).toBeNull();
  });
  it("resends uncertain search work only in an explicit new attempt, and never repeats completed searches", () => {
    expect(shouldRunVerificationSearch(undefined, undefined, "a1")).toBe(true);
    expect(shouldRunVerificationSearch("reserved", "a1", "a1")).toBe(false);
    expect(shouldRunVerificationSearch("failed", "a1", "a1")).toBe(false);
    expect(shouldRunVerificationSearch("reserved", undefined, "a2")).toBe(
      false,
    );
    expect(shouldRunVerificationSearch("reserved", "a1", "a2")).toBe(true);
    expect(shouldRunVerificationSearch("failed", "a1", "a2")).toBe(true);
    expect(shouldRunVerificationSearch("completed", "a1", "a2")).toBe(false);
  });
  it("requires original-text provenance for an evidence-informed decision card", () => {
    const card: DecisionCard = {
      id: "d1",
      title: "完整流程",
      finding: "三个步骤",
      interpretation: "准备也计时",
      action: "画流程图",
      tradeoff: "增加测量",
      nextTest: "实测清洁",
      changeCondition: "清洁主导则调整拆洗",
      status: "evidence_informed",
      evidenceIds: ["e1"],
    };
    expect(validateDecisionCards([card], fixture().sources)).toEqual([]);
    expect(
      validateDecisionCards(
        [card],
        [{ ...fixture().sources[0], contentKind: "search_excerpt" }],
      ),
    ).not.toEqual([]);
    expect(
      validateDecisionCards([{ ...card, evidenceIds: [] }], fixture().sources),
    ).not.toEqual([]);
    expect(
      validateDecisionCards(
        [{ ...card, status: "hypothesis", evidenceIds: [] }],
        fixture().sources,
      ),
    ).toEqual([]);
  });
});
