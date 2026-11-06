import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  assessDecisionAnswers,
  verificationAssessmentSchema,
} from "./decision-evidence";
import { packEvidenceContext } from "./quality";
import { mergeOpenResearchQuestions } from "./workflow-quality";
import actualPackage from "../../services/research-runtime/tests/fixtures/office_lunch_actual_package.json";

// This exercises the real handoff between the semantic review contract and the
// formal packer. All input is synthetic; no model/network/database is involved.
describe("semantic review to formal evidence integration", () => {
  it.each([{ decisionIds: [] }, { decisionIds: ["q1", "q1"] }])(
    "does not persist a direct role with invalid decision identifiers $decisionIds",
    ({ decisionIds }) => {
      const content =
        "三明治机样例：准备食材三分钟，馅料制作三分钟，组合三分钟。";
      const contentHash = createHash("sha256").update(content).digest("hex");
      const row = {
        id: "e1",
        originalUrl: "https://example.com/sandwich-review",
        title: "三明治机使用体验",
        excerpt: "记录制作步骤。",
        content,
        contentHash,
        status: "captured",
      };
      const assessment = verificationAssessmentSchema.parse({
        sourceRoutes: [
          {
            evidenceId: row.id,
            role: "task_observation",
            decisionIds,
            reason: "此页属于完整操作过程的候选记录。",
          },
        ],
        answers: [
          {
            questionId: "q1",
            status: "insufficient",
            coverage: "none",
            finding: "尚无能完整回答问题的引用。",
            implication: "保持待判断。",
            nextCheck: "继续核对完整任务。",
            changeCondition: "取得完整流程证据。",
            citations: [],
          },
        ],
      });
      const review = assessDecisionAnswers({
        assessment,
        questions: [{ id: "q1", decision: "午餐的完整操作过程包括哪些准备？" }],
        sources: [
          {
            ...row,
            contentKind: "captured_text",
            contentRanges: [{ start: 0, end: content.length }],
          },
        ],
        retained: [row],
        acquisition: { q1: "read" },
      });
      expect(review.routes).toEqual([]);
      expect(review.issues.length).toBeGreaterThan(0);
      expect(review.gaps[0].status).toBe("insufficient");
      expect(() =>
        packEvidenceContext(
          [row],
          { question: "三明治机办公室午餐" },
          { decisionRoutes: review.routes, requireDecisionRoutes: true },
        ),
      ).not.toThrow();
    },
  );
});

describe("refresh preserves known unanswered design questions", () => {
  it("retains the actual frozen package's eight questions when regenerated metadata proposes none", () => {
    const existing = actualPackage.finalBrief.openQuestions;
    expect(existing).toHaveLength(8);
    expect(mergeOpenResearchQuestions(existing, [], [])).toEqual(existing);
  });

  it("deduplicates exact questions and keeps the established questions before generated additions", () => {
    expect(
      mergeOpenResearchQuestions(
        ["  现场是否允许制作午餐？ ", "如何清洗容器？"],
        ["现场是否允许制作午餐？", "现有复热设备是否可用？"],
        [" 如何清洗容器？", "如何解释份量提示？", " "],
      ),
    ).toEqual([
      "现场是否允许制作午餐？",
      "如何清洗容器？",
      "现有复热设备是否可用？",
      "如何解释份量提示？",
    ]);
  });

  it("carries unresolved decisions and leaves over-limit unions visible to the publication gate", () => {
    const existing = Array.from(
      { length: 20 },
      (_, index) => `仍待核对的旧问题 ${index + 1}`,
    );
    const merged = mergeOpenResearchQuestions(
      existing,
      ["完整流程是否遗漏准备和清洁？"],
      [],
    );
    expect(merged).toHaveLength(21);
    expect(merged.slice(0, 20)).toEqual(existing);
    expect(merged).toContain("完整流程是否遗漏准备和清洁？");
  });
});
