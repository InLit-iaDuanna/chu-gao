// Offline UI fixtures, shared by component tests and the real-browser QA harness.
// These are explicit examples, not freshly generated research or market findings.
import {
  researchPlanInputSchema,
  type ResearchTaskView,
} from "@/lib/research/types";

export function task(): ResearchTaskView {
  const input = researchPlanInputSchema.parse({
    brief: { question: "办公午餐设备比较" },
  });
  return {
    id: "task-1",
    projectId: "project-1",
    briefId: "brief-1",
    sourceTaskId: null,
    status: "completed",
    preset: "research",
    scope: "standard",
    modelId: "model",
    reasoningEffort: "medium",
    brief: input.brief,
    plan: {
      preset: "research",
      reason: "test",
      stages: [{ kind: "synthesize", engine: "chugao" }],
      limits: { llm: 30, search: 20, crawl: 30, minutes: 25 },
      products: ["report", "board"],
    },
    nextSeq: 10,
    llmCalls: 1,
    searchCalls: 1,
    crawlCalls: 1,
    stages: [
      {
        id: "stage-1",
        kind: "synthesize",
        engine: "chugao",
        status: "completed",
        text: "待补证的研究草稿。",
        result: {
          quality: {
            schemaVersion: 1,
            status: "insufficient",
            issues: [
              {
                code: "NO_PRIMARY",
                severity: "warning",
                message: "缺少相应型号的一手资料",
              },
            ],
          },
          contextManifest: {
            schemaVersion: 1,
            sources: [
              {
                evidenceId: "source-1",
                capturedChars: 99701,
                includedChars: 0,
                truncated: false,
                omittedReason: "budget",
                availability: "captured",
              },
            ],
          },
        },
        activeAttemptId: "attempt-1",
        attempts: [
          { id: "attempt-1", ordinal: 1, status: "completed", error: null },
        ],
      },
    ],
    evidence: [
      {
        id: "source-1",
        taskId: "task-1",
        title: "历史促销归档",
        originalUrl: "https://example.com/product",
        canonicalUrl: "https://example.com/product",
        excerpt: "有正文，但未纳入整理上下文。",
        status: "captured",
        screenshotKey: null,
        contentKey: "source.md",
        claims: null,
        originUrl: null,
        fetchedAt: null,
        purgedAt: null,
        expired: false,
      },
    ],
    artifacts: [
      {
        id: "file-1",
        kind: "board",
        title: "视觉参考板",
        filename: "board.html",
        mimeType: "text/html",
        sizeBytes: 1024,
        basisTaskId: "task-1",
        expiresAt: null,
        purgedAt: null,
        expired: false,
      },
    ],
    costUsd: null,
    unknownCostCalls: 1,
    error: null,
    createdAt: "2026-10-18T16:00:00.000Z",
    finishedAt: "2026-10-18T16:05:00.000Z",
    expiresAt: null,
  };
}

export function decisionTask() {
  const snapshot = task();
  snapshot.stages[0].text = "# 原始报告全文\n\n完整流程仍需比较。[source-1]";
  snapshot.evidence[0].title = "单个受邀众测样例";
  snapshot.evidence[0].excerpt =
    "样例记录三段制作步骤，总计约九分钟。上下烤盘都可拆卸。";
  snapshot.stages[0].result = {
    ...(snapshot.stages[0].result as Record<string, unknown>),
    contextManifest: {
      schemaVersion: 1,
      sources: [
        {
          evidenceId: "source-1",
          capturedChars: snapshot.evidence[0].excerpt.length,
          includedChars: snapshot.evidence[0].excerpt.length,
          truncated: false,
          availability: "captured",
        },
      ],
    },
    finalResearchPackage: {
      schemaVersion: 2,
      policyVersion: "design-evidence-v3",
      version: "b".repeat(64),
      decisionCards: [
        {
          id: "whole-task",
          title: "把比较单位改成一顿午餐的完整流程",
          finding: "单个受邀样例将三段步骤写为各三分钟，总计约九分钟。",
          interpretation: "需要区分单段加热时间、全过程与主动操作时间。",
          action: "先用同样食材比较现场制作与预制复热。",
          tradeoff: "预制方向把部分准备工作移到前一天。",
          nextTest: "同时记录准备、等待、清洁与收纳。",
          changeCondition: "如果现场现做的主动操作很少，再重新比较体验收益。",
          status: "evidence_informed",
          evidenceIds: ["source-1"],
        },
      ],
      decisionGaps: [
        {
          id: "cleanup",
          decision: "可拆盘是否减少整顿午餐的清洁负担？",
          status: "insufficient",
          acquisitionStatus: "read",
          finding: "当前只有可拆结构的描述，没有完整清洁过程。",
          implication: "暂不把可拆盘直接写成低清洁负担。",
          nextCheck: "观察拆盘、擦机身、晾干及收纳。",
          changeCondition: "在同样污渍和清洁终点下记录了总步骤与时间。",
          citations: [{ evidenceId: "source-1", quote: "上下烤盘都可拆卸" }],
        },
      ],
    },
  };
  return snapshot;
}
