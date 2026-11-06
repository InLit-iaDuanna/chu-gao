import { describe, expect, it } from "vitest";
import { researchPlanInputSchema, type ResearchTaskView } from "./types";
import {
  applyResearchEvent,
  parseResearchEvent,
  researchActivityMessage,
  researchArtifactLabel,
  researchContextLabel,
  researchContextManifest,
  researchDecisionGapLabel,
  researchDecisionLabel,
  researchDecisions,
  researchElapsed,
  researchExecutionLabel,
  researchQuality,
  researchQualityLabel,
  researchSynthesisPhaseLabel,
  type ResearchStreamEvent,
} from "./presentation";

const recordedDecisionCard = {
  id: "whole-task",
  title: "按完整午餐流程比较两个方向",
  finding: "一个受邀众测样例记录三段各三分钟的制作步骤，总计约九分钟。",
  interpretation: "单段加热时间不足以代表从准备到可进食的总流程。",
  action: "用相同食材比较现场制作与预制复热的总时间和主动操作时间。",
  tradeoff: "预制复热可能节省现场准备，但把工作移到前一天。",
  nextTest: "记录准备、等待、转移、清洁和收纳，先验证这两个候选方向。",
  changeCondition: "若现场准备与清洁很少，重新比较现做方案的体验收益。",
  status: "evidence_informed",
  evidenceIds: ["source-1"],
};

function decisionTask(packet: Record<string, unknown>): ResearchTaskView {
  const result = task({
    status: "completed",
    evidence: [{ id: "source-1" } as ResearchTaskView["evidence"][number]],
  });
  result.stages = [
    {
      ...result.stages[0],
      kind: "synthesize",
      status: "completed",
      result: { finalResearchPackage: { schemaVersion: 2, ...packet } },
    },
  ];
  return result;
}

function task(overrides: Partial<ResearchTaskView> = {}): ResearchTaskView {
  const input = researchPlanInputSchema.parse({
    brief: { question: "办公午餐设备比较" },
  });
  return {
    id: "task-1",
    projectId: "project-1",
    briefId: "brief-1",
    sourceTaskId: null,
    status: "running",
    preset: "research",
    scope: "standard",
    modelId: "model",
    reasoningEffort: "medium",
    brief: input.brief,
    plan: {
      preset: "research",
      reason: "test",
      stages: [{ kind: "research", engine: "gpt-researcher" }],
      limits: { llm: 30, search: 20, crawl: 30, minutes: 25 },
      products: ["report"],
    },
    nextSeq: 10,
    llmCalls: 1,
    searchCalls: 1,
    crawlCalls: 1,
    stages: [
      {
        id: "stage-1",
        kind: "research",
        engine: "gpt-researcher",
        status: "running",
        text: "已保存正文",
        result: null,
        activeAttemptId: "attempt-1",
        attempts: [
          { id: "attempt-1", ordinal: 1, status: "running", error: null },
        ],
      },
    ],
    evidence: [],
    artifacts: [],
    costUsd: null,
    unknownCostCalls: 1,
    error: null,
    createdAt: "2026-10-18T16:00:00.000Z",
    finishedAt: null,
    expiresAt: null,
    ...overrides,
  };
}

function event(
  seq: number,
  payload: Record<string, unknown>,
  type = "stage.text",
): ResearchStreamEvent {
  return {
    seq,
    type,
    payload: { stageId: "stage-1", attemptId: "attempt-1", ...payload },
  };
}

describe("research quality presentation", () => {
  it("does not promote successful legacy execution to research quality", () => {
    const completed = task({
      status: "completed",
      stages: [{ ...task().stages[0], status: "completed" }],
    });
    expect(researchExecutionLabel(completed.status)).toBe("执行完成");
    expect(researchQuality(completed)).toBeNull();
    expect(researchQualityLabel(null)).toBe("质量未评估");
  });

  it("uses the final synthesis quality and keeps supported distinct from verified truth", () => {
    const value = task({
      stages: [
        {
          ...task().stages[0],
          kind: "verify",
          status: "completed",
          result: { quality: { schemaVersion: 1, status: "supported" } },
        },
        {
          ...task().stages[0],
          id: "final",
          kind: "synthesize",
          status: "completed",
          result: {
            quality: {
              schemaVersion: 1,
              status: "insufficient",
              issues: [
                {
                  code: "NO_PRIMARY",
                  severity: "warning",
                  message: "缺少对应型号的一手资料",
                },
                null,
              ],
            },
          },
        },
      ],
    });
    expect(researchQuality(value)).toMatchObject({
      status: "insufficient",
      issues: [{ message: "缺少对应型号的一手资料" }],
    });
    expect(researchQuality(value)?.issues).toHaveLength(1);
    expect(researchQualityLabel("supported")).toContain("结论仍需核验");
  });

  it("ignores unknown versions and a previous verdict on a restarted stage", () => {
    for (const result of [
      null,
      [],
      { quality: { schemaVersion: 2, status: "supported" } },
      { quality: { schemaVersion: 1, status: "perfect" } },
    ]) {
      expect(
        researchQuality(
          task({
            stages: [
              {
                ...task().stages[0],
                kind: "synthesize",
                status: "completed",
                result,
              },
            ],
          }),
        ),
      ).toBeNull();
    }
    expect(
      researchQuality(
        task({
          stages: [
            {
              ...task().stages[0],
              kind: "synthesize",
              result: { quality: { schemaVersion: 1, status: "supported" } },
            },
          ],
        }),
      ),
    ).toBeNull();
  });

  it("shows archived but omitted source text separately from unknown source length", () => {
    const value = task({
      stages: [
        {
          ...task().stages[0],
          kind: "synthesize",
          result: {
            contextManifest: {
              schemaVersion: 1,
              sources: [
                {
                  evidenceId: "ochama",
                  capturedChars: 99701,
                  includedChars: 0,
                  truncated: false,
                  omittedReason: "budget",
                  availability: "captured",
                },
                {
                  evidenceId: "link",
                  capturedChars: null,
                  includedChars: 0,
                  truncated: false,
                  omittedReason: "not_fetched",
                  availability: "not_fetched",
                },
                { evidenceId: "bad", capturedChars: -1, includedChars: 100 },
              ],
            },
          },
        },
      ],
    });
    const manifest = researchContextManifest(value)!;
    expect(manifest.stageKind).toBe("synthesize");
    expect(manifest.sources.size).toBe(2);
    expect(researchContextLabel(manifest.sources.get("ochama")!)).toContain(
      "留档正文 99,701 字符 · 本阶段未纳入正文（上下文预算不足）",
    );
    expect(researchContextLabel(manifest.sources.get("link")!)).toContain(
      "原文长度未知",
    );
    expect(researchContextLabel(manifest.sources.get("link")!)).not.toContain(
      "正文为空",
    );
  });

  it("labels the uncurated screenshot archive without promising visual analysis", () => {
    expect(researchArtifactLabel({ kind: "board", title: "视觉参考板" })).toBe(
      "网页留档 / 视觉资料",
    );
    expect(researchArtifactLabel({ kind: "html", title: "提案网页" })).toBe(
      "提案网页",
    );
  });
});

describe("persisted design decisions in the browser", () => {
  it("presents complete frozen cards and leaves a read-but-unanswered question open", () => {
    const result = researchDecisions(
      decisionTask({
        version: "a".repeat(64),
        decisionCards: [recordedDecisionCard],
        decisionGaps: [
          {
            id: "cleanup",
            decision: "可拆盘是否降低完整清洁工作量？",
            status: "insufficient",
            acquisitionStatus: "read",
            finding: "读到了拆盘结构，尚无全过程观察。",
            nextCheck: "记录冲洗、擦机身、晾干与收纳。",
            citations: [{ evidenceId: "source-1", quote: "上下烤盘都可拆卸" }],
          },
          {
            id: "identity",
            decision: "两渠道是否为同一个型号？",
            status: "supported",
            acquisitionStatus: "read",
          },
        ],
      }),
    );
    expect(result.cards).toEqual([recordedDecisionCard]);
    expect(result.version).toBe("a".repeat(64));
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0].evidenceIds).toEqual(["source-1"]);
    expect(researchDecisionGapLabel(result.gaps[0])).toBe(
      "证据不足 · 已读材料",
    );
    expect(researchDecisionLabel(result.cards[0].status)).toBe(
      "材料启发的方向",
    );
  });

  it("does not manufacture cards or inherit an older gap over a completed legacy packet", () => {
    const legacy = decisionTask({ policyVersion: "design-evidence-v2" });
    legacy.stages.unshift({
      ...legacy.stages[0],
      id: "old-review",
      kind: "verify",
      result: {
        decisionGaps: [
          { id: "old", decision: "前一轮问题", status: "insufficient" },
        ],
        decisionCards: [recordedDecisionCard],
      },
    });
    expect(researchDecisions(legacy)).toEqual({
      cards: [],
      gaps: [],
      version: null,
    });
  });

  it("ignores a previous packet on a running synthesis while preserving a completed review's gap", () => {
    const pending = decisionTask({ decisionCards: [recordedDecisionCard] });
    pending.stages[0].status = "running";
    pending.stages.unshift({
      ...pending.stages[0],
      id: "review",
      kind: "verify",
      status: "completed",
      result: {
        decisionGaps: [
          {
            id: "question",
            decision: "现场准备是否可接受？",
            status: "conflicting",
            acquisitionStatus: "read",
          },
        ],
      },
    });
    expect(researchDecisions(pending).cards).toEqual([]);
    expect(researchDecisions(pending).gaps[0].status).toBe("conflicting");
  });

  it("keeps unavailable-source text inspectable without claiming an available evidence basis", () => {
    const packet = decisionTask({
      decisionCards: [
        { ...recordedDecisionCard, evidenceIds: ["missing-source"] },
      ],
    });
    expect(researchDecisions(packet).cards[0]).toMatchObject({
      status: "unknown",
      evidenceIds: ["missing-source"],
      action: recordedDecisionCard.action,
    });
    expect(researchDecisionLabel("hypothesis")).toBe("设计假设");
  });

  it("ignores malformed or duplicate cards and unknown frozen schemas without breaking older reports", () => {
    const malformed = decisionTask({
      decisionCards: [
        null,
        { ...recordedDecisionCard, action: " " },
        recordedDecisionCard,
        { ...recordedDecisionCard, title: "重复标识" },
        { ...recordedDecisionCard, id: "bad", status: "verified" },
      ],
      decisionGaps: [
        null,
        { id: "bad", decision: "无效状态", status: "resolved" },
      ],
    });
    expect(researchDecisions(malformed).cards).toEqual([recordedDecisionCard]);
    expect(researchDecisions(malformed).gaps).toEqual([]);
    expect(
      researchDecisions(
        decisionTask({
          schemaVersion: 99,
          decisionCards: [recordedDecisionCard],
        }),
      ).cards,
    ).toEqual([]);
    expect(researchDecisions(task())).toEqual({
      cards: [],
      gaps: [],
      version: null,
    });
  });

  it("explains pending semantic routing separately from a failed read", () => {
    expect(
      researchContextLabel({
        evidenceId: "unreviewed",
        capturedChars: 900,
        includedChars: 0,
        truncated: false,
        omittedReason: "pending_decision_route",
        availability: "captured",
      }),
    ).toBe("留档正文 900 字符 · 本阶段未纳入正文（尚未确认对应的设计问题）");
  });
});

describe("research snapshot and stream convergence", () => {
  it("increments reserved call counters immediately and ignores replayed events", () => {
    const initial = task();
    const started = event(11, { kind: "llm" }, "call.started");
    const next = applyResearchEvent(initial, started);
    expect(next.view.llmCalls).toBe(initial.llmCalls + 1);
    expect(next.needsSnapshot).toBe(false);
    expect(applyResearchEvent(next.view, started).view.llmCalls).toBe(
      next.view.llmCalls,
    );
  });
  it("rejects malformed envelopes before they can move a replay cursor", () => {
    for (const value of [
      null,
      { seq: 1.5, type: "stage.text", payload: {} },
      { seq: 1, type: "stage.text", payload: null },
      { seq: "2", type: "stage.text", payload: {} },
    ])
      expect(parseResearchEvent(value)).toBeNull();
    expect(parseResearchEvent(event(11, { delta: "新内容" }))).toEqual(
      event(11, { delta: "新内容" }),
    );
  });

  it("appends real deltas once and replaces them with a corrected final body", () => {
    const partial = applyResearchEvent(
      task(),
      event(11, { delta: "，增量" }),
    ).view;
    expect(partial.stages[0].text).toBe("已保存正文，增量");
    expect(
      applyResearchEvent(partial, event(11, { delta: "，增量" })).view,
    ).toBe(partial);
    const final = applyResearchEvent(
      partial,
      event(12, { text: "最终校正正文" }),
    ).view;
    expect(final.stages[0].text).toBe("最终校正正文");
    const completed = applyResearchEvent(
      final,
      event(13, {}, "stage.completed"),
    ).view;
    expect(completed.stages[0]).toMatchObject({
      status: "completed",
      text: "最终校正正文",
    });
    expect(task().stages[0].text).toBe("已保存正文");
  });

  it("clears old attempt text at a retry boundary and rejects a late old-attempt delta", () => {
    const queued = applyResearchEvent(
      task(),
      event(11, { attemptId: "attempt-2" }, "stage.retry_queued"),
    ).view;
    expect(queued.stages[0]).toMatchObject({
      text: "",
      status: "pending",
      activeAttemptId: "attempt-2",
    });
    const started = applyResearchEvent(
      queued,
      event(12, { attemptId: "attempt-2" }, "stage.started"),
    ).view;
    const stale = applyResearchEvent(
      started,
      event(13, { delta: "旧回复泄漏" }),
    );
    expect(stale.applied).toBe(false);
    expect(stale.view.stages[0].text).toBe("");
    const current = applyResearchEvent(
      stale.view,
      event(14, { attemptId: "attempt-2", delta: "新尝试正文" }),
    ).view;
    expect(current.stages[0].text).toBe("新尝试正文");
  });

  it("does not skip a sequence gap and converges after an authoritative snapshot", () => {
    const original = task();
    const gap = applyResearchEvent(original, event(13, { delta: "第三片段" }));
    expect(gap).toMatchObject({
      view: original,
      applied: false,
      needsSnapshot: true,
    });
    expect(gap.view.nextSeq).toBe(10);
    const snapshot = task({
      nextSeq: 13,
      stages: [{ ...original.stages[0], text: "完整到第三片段" }],
    });
    const result = applyResearchEvent(
      snapshot,
      event(14, { delta: "第四片段" }),
    ).view;
    expect(result.stages[0].text).toBe("完整到第三片段第四片段");
    expect(
      applyResearchEvent(result, event(13, { delta: "第三片段" })).view,
    ).toBe(result);
  });

  it("recovers legacy unscoped deltas through a snapshot without corrupting the next delta", () => {
    const legacy = {
      seq: 11,
      type: "stage.text",
      payload: { stageId: "stage-1", delta: "旧协议" },
    };
    const update = applyResearchEvent(task(), legacy);
    expect(update.view.nextSeq).toBe(10);
    expect(update.view.stages[0].text).toBe("已保存正文");
    const next = applyResearchEvent(
      update.view,
      event(12, { delta: "新协议" }),
    );
    expect(next.needsSnapshot).toBe(true);
    expect(next.applied).toBe(false);
    expect(next.view.stages[0].text).toBe("已保存正文");
  });

  it("never appends into a terminal stage after reopening its saved snapshot", () => {
    const completed = task({
      status: "completed",
      stages: [{ ...task().stages[0], status: "completed" }],
    });
    const update = applyResearchEvent(
      completed,
      event(11, { delta: "尾部迟到" }),
    );
    expect(update.applied).toBe(false);
    expect(update.view.stages[0].text).toBe("已保存正文");
  });
});

describe("honest activity feedback", () => {
  it("preserves a valid synthesis phase across call events and does not replace checkpoint data", () => {
    const initial = task();
    initial.stages[0] = {
      ...initial.stages[0],
      kind: "synthesize",
      result: {
        synthesisCheckpoint: { opaqueServerValue: "preserve" },
        contextManifest: { sources: [] },
      },
    };
    const report = event(11, { phase: "report" }, "stage.activity");
    const editing = applyResearchEvent(initial, report);
    expect(editing.applied).toBe(true);
    expect(editing.needsSnapshot).toBe(false);
    expect(editing.view.stages[0].result).toEqual({
      synthesisCheckpoint: { opaqueServerValue: "preserve" },
      contextManifest: { sources: [] },
      synthesisPhase: "report",
    });
    expect(researchSynthesisPhaseLabel(editing.view.stages[0])).toBe(
      "研究材料已整理，正在编写完整报告",
    );
    const started = applyResearchEvent(
      editing.view,
      event(12, { kind: "llm" }, "call.started"),
    );
    expect(started.view.llmCalls).toBe(initial.llmCalls + 1);
    expect(researchSynthesisPhaseLabel(started.view.stages[0])).toBe(
      "研究材料已整理，正在编写完整报告",
    );
    const duplicate = applyResearchEvent(
      started.view,
      event(11, { phase: "draft" }, "stage.activity"),
    );
    expect(duplicate.applied).toBe(false);
    expect(duplicate.view).toBe(started.view);
    const metadata = applyResearchEvent(
      started.view,
      event(13, { phase: "metadata" }, "stage.activity"),
    );
    expect(researchSynthesisPhaseLabel(metadata.view.stages[0])).toBe(
      "报告已成文，正在整理摘要与交付内容",
    );
    expect(initial.stages[0].result).not.toHaveProperty("synthesisPhase");
  });

  it("rejects late, missing, non-running and noncontiguous activity identities", () => {
    const initial = task();
    initial.stages[0] = {
      ...initial.stages[0],
      kind: "synthesize",
      result: { synthesisPhase: "report" },
    };
    for (const candidate of [
      event(11, { attemptId: "old-attempt", phase: "draft" }, "stage.activity"),
      event(11, { attemptId: undefined, phase: "draft" }, "stage.activity"),
      event(12, { phase: "draft" }, "stage.activity"),
    ]) {
      const update = applyResearchEvent(initial, candidate);
      expect(update.applied).toBe(false);
      expect(update.needsSnapshot).toBe(true);
      expect(update.view.stages[0].result).toEqual({
        synthesisPhase: "report",
      });
    }
    const completed = {
      ...initial,
      stages: [{ ...initial.stages[0], status: "completed" }],
    };
    expect(
      applyResearchEvent(
        completed,
        event(11, { phase: "draft" }, "stage.activity"),
      ).applied,
    ).toBe(false);
    expect(researchSynthesisPhaseLabel(completed.stages[0])).toBeNull();
  });

  it("clears an old synthesis phase on retry while retaining the opaque saved checkpoint", () => {
    const initial = task();
    initial.stages[0] = {
      ...initial.stages[0],
      kind: "synthesize",
      result: {
        synthesisPhase: "metadata",
        synthesisCheckpoint: { opaqueServerValue: "preserve" },
      },
    };
    const queued = applyResearchEvent(
      initial,
      event(11, { attemptId: "attempt-2" }, "stage.retry_queued"),
    );
    const started = applyResearchEvent(
      queued.view,
      event(12, { attemptId: "attempt-2" }, "stage.started"),
    );
    expect(started.view.stages[0].result).toEqual({
      synthesisCheckpoint: { opaqueServerValue: "preserve" },
    });
    expect(researchSynthesisPhaseLabel(started.view.stages[0])).toBeNull();
  });

  it("uses only the phase allowlist from synthesis snapshots", () => {
    const stage = {
      kind: "synthesize",
      status: "running",
      result: null as unknown,
    };
    for (const [phase, label] of [
      ["draft", "正在整理研究发现与依据"],
      ["report", "研究材料已整理，正在编写完整报告"],
      ["metadata", "报告已成文，正在整理摘要与交付内容"],
    ])
      expect(
        researchSynthesisPhaseLabel({
          ...stage,
          result: { synthesisPhase: phase },
        }),
      ).toBe(label);
    for (const phase of ["done", "constructor", "__proto__", {}, [], null]) {
      const initial = task({
        stages: [{ ...task().stages[0], kind: "synthesize", result: null }],
      });
      const update = applyResearchEvent(
        initial,
        event(11, { phase }, "stage.activity"),
      );
      expect(update.applied).toBe(false);
      expect(update.view.stages[0].result).toBeNull();
      expect(
        researchSynthesisPhaseLabel({
          ...stage,
          result: { synthesisPhase: phase },
        }),
      ).toBeNull();
    }
    expect(researchSynthesisPhaseLabel(undefined)).toBeNull();
    expect(
      researchSynthesisPhaseLabel({
        ...stage,
        kind: "research",
        result: { synthesisPhase: "report" },
      }),
    ).toBeNull();
  });

  it("shows elapsed time and candidate search results without inventing writing progress", () => {
    expect(
      researchElapsed(
        "2026-10-18T16:00:00Z",
        Date.parse("2026-10-18T16:00:30Z"),
      ),
    ).toBe("30 秒");
    expect(
      researchElapsed(
        "2026-10-18T16:00:00Z",
        Date.parse("2026-10-18T16:01:01Z"),
      ),
    ).toBe("1 分 1 秒");
    expect(researchElapsed("invalid", Date.now())).toBe("—");
    expect(
      researchActivityMessage({
        seq: 1,
        type: "search.completed",
        payload: { count: 10 },
      }),
    ).toBe("搜索完成，找到 10 个候选来源");
    expect(
      researchActivityMessage({ seq: 2, type: "task.completed", payload: {} }),
    ).toContain("任务执行完成");
    expect(
      researchActivityMessage({
        seq: 3,
        type: "stage.text",
        payload: { delta: "真实片段" },
      }),
    ).toBeNull();
    expect(
      researchActivityMessage({
        seq: 4,
        type: "call.started",
        payload: { kind: "crawl" },
      }),
    ).toBe("正在读取网页资料");
    expect(
      researchActivityMessage({
        seq: 5,
        type: "call.started",
        payload: { kind: "llm" },
      }),
    ).toContain("模型请求");
  });
});

