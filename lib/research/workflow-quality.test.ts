import { describe, expect, it } from "vitest";
import { researchPlanInputSchema, type ResearchPlan } from "./types";
import {
  createFinalResearchPackage,
  readFinalResearchPackage,
  researchDeliverablesSchemaV2,
  researchVersion,
  restoreVerificationPlan,
  stageCallCeiling,
  validateDeliverableEvidence,
  verificationIdentity,
  verificationQuestionRelevant,
  VERIFICATION_PLANNER_VERSION,
} from "./workflow-quality";

const brief = researchPlanInputSchema.parse({
  brief: {
    question: "比较办公室午餐加热设备的清洁与使用限制",
    audience: "健身与控卡人群",
    constraints: "低油、分量明确，地区与价格尚未确定",
  },
}).brief;
const draft = [
  { id: "research-stage", text: "已有原稿，具体型号与清洁体验仍需原文。" },
];

function metadata() {
  return researchDeliverablesSchemaV2.parse({
    finalBrief: {
      goal: "比较两条办公午餐路径",
      scope: "当前仅形成可核查的研究草稿",
      alternatives: [
        {
          name: "自带加热盒",
          benefit: "流程独立",
          tradeoff: "清洁负担待测",
          status: "hypothesis",
          evidenceIds: [],
        },
        {
          name: "共用微波炉",
          benefit: "利用既有设施",
          tradeoff: "排队问题待调研",
          status: "hypothesis",
          evidenceIds: [],
        },
      ],
      acceptanceCriteria: ["比较清洁步骤与共享空间占用"],
      openQuestions: ["具体型号与原始说明书尚待确认"],
    },
    hypotheses: [
      {
        id: "hyp-portion",
        text: "分量指示可能有帮助",
        basis: "来自用户控卡目标，尚未验证",
        status: "unverified",
        evidenceIds: [],
      },
    ],
    caveats: ["并非已经完成的市场事实核验"],
    competitors: [
      {
        name: "候选加热盒",
        kind: "category",
        positioning: "便携加热",
        price: "未找到",
        market: "",
        observedAt: "",
        observations: "等待具体型号原文",
        status: "unverified",
        evidenceIds: [],
      },
    ],
  });
}

function packageInput() {
  return {
    taskId: "task-final",
    briefId: "brief-final",
    stageId: "synthesis-final",
    attemptId: "attempt-final",
    report: "当前终稿：仅保留分量指示假设，没有确定售价。",
    metadata: metadata(),
    confirmedRequirements: ["办公室快速午餐", "低油、营养可控、分量明确"],
    quality: { schemaVersion: 1, status: "draft", issues: [] },
    evidenceManifest: {
      schemaVersion: 1,
      sources: [
        {
          evidenceId: "ev_manual",
          capturedChars: 4800,
          includedChars: 1200,
          truncated: true,
          omittedReason: null,
        },
      ],
    },
    evidence: [
      {
        id: "ev_manual",
        url: "https://example.com/manual",
        status: "captured",
        sourceAvailability: "captured",
        contentKind: "captured_text",
        content: "真实说明书片段",
        contentHash: "body-version-1",
      },
    ],
    generatedAt: "2026-10-18T16:00:00.000Z",
  };
}

function checkpoint() {
  const questions = [
    {
      id: "cleaning",
      decision: "清洁步骤是否适合办公室午餐",
      query: "办公室 午餐 加热盒 清洁 说明书",
      reason: "用户需要办公午餐方案，清洁会影响使用路径",
      evidenceIds: ["ev_manual"],
    },
    {
      id: "portion",
      decision: "设备分量是否对应用户控卡目标",
      query: "午餐 加热盒 分量 参数",
      reason: "保留用户分量明确的要求",
      evidenceIds: [],
    },
  ];
  return {
    checkpoint: "verification-v2" as const,
    ...verificationIdentity(brief, draft),
    questions,
    questionsVersion: researchVersion(questions),
    searched: ["cleaning"],
    unresolved: ["portion"],
    sourceIdsByQuestion: { cleaning: ["ev_manual"] },
  };
}

const plan: ResearchPlan = {
  preset: "proposal",
  reason: "测试完整调研与提案路线",
  products: ["report", "pptx"],
  limits: { llm: 30, search: 20, crawl: 30, minutes: 25 },
  stages: [
    { kind: "research", engine: "gpt-researcher" },
    { kind: "capture", engine: "chugao" },
    { kind: "verify", engine: "chugao" },
    { kind: "synthesize", engine: "chugao" },
    { kind: "produce", engine: "deerflow" },
  ],
};

function reseal(value: Record<string, unknown>) {
  const content = { ...value };
  delete content.version;
  delete content.generatedAt;
  return {
    ...content,
    generatedAt: value.generatedAt,
    version: researchVersion(content),
  };
}

describe("final research package identity", () => {
  it("keeps object-key order irrelevant while preserving array and textual meaning", () => {
    expect(researchVersion({ b: [1, { y: 2, x: 3 }], a: "中文" })).toBe(
      researchVersion({ a: "中文", b: [1, { x: 3, y: 2 }] }),
    );
    expect(researchVersion(["先前假设", "终稿结论"])).not.toBe(
      researchVersion(["终稿结论", "先前假设"]),
    );
    expect(researchVersion("99,701 字符原文")).not.toBe(
      researchVersion("原文为空"),
    );
  });

  it("creates one final version and does not revive hypotheses absent from that version", () => {
    const packed = createFinalResearchPackage(packageInput());
    expect(
      readFinalResearchPackage(JSON.parse(JSON.stringify(packed))),
    ).toEqual(packed);
    expect(packed.report.text).toBe(packageInput().report);
    expect(packed.finalBrief.confirmedRequirements).toEqual(
      packageInput().confirmedRequirements,
    );
    expect(packed.hypotheses.map((row) => row.id)).toEqual(["hyp-portion"]);
    expect(JSON.stringify(packed)).not.toContain("299–399");
    expect(packed.report.hash).toBe(researchVersion(packed.report.text));
  });

  it("does not create a new content version for a regenerated timestamp", () => {
    const first = createFinalResearchPackage(packageInput());
    const second = createFinalResearchPackage({
      ...packageInput(),
      generatedAt: "2026-10-19T08:00:00.000Z",
    });
    expect(first.generatedAt).not.toBe(second.generatedAt);
    expect(first.version).toBe(second.version);
  });

  it.each([
    "report",
    "hypothesis",
    "requirement",
    "evidence",
    "manifest",
    "quality",
  ])("rejects a changed %s behind the old content version", (field) => {
    const packed = createFinalResearchPackage(packageInput());
    if (field === "report") packed.report.text = "修改过的报告";
    if (field === "hypothesis")
      packed.hypotheses[0].text = "旧价格假设被重新加入";
    if (field === "requirement")
      packed.finalBrief.confirmedRequirements.push("用户从未要求的价格");
    if (field === "evidence")
      (packed.evidence[0] as Record<string, unknown>).content = "被替换的材料";
    if (field === "manifest")
      (
        packed.evidenceManifest as { sources: Array<{ includedChars: number }> }
      ).sources[0].includedChars = 0;
    if (field === "quality") packed.quality.status = "supported";
    expect(readFinalResearchPackage(packed)).toBeNull();
  });

  it("rejects an unsupported version and missing report even when shaped like a package", () => {
    expect(
      readFinalResearchPackage({
        ...createFinalResearchPackage(packageInput()),
        schemaVersion: 999,
      }),
    ).toBeNull();
    expect(
      readFinalResearchPackage({
        ...createFinalResearchPackage(packageInput()),
        report: null,
      }),
    ).toBeNull();
    expect(readFinalResearchPackage(null)).toBeNull();
  });

  it("rejects malformed package shapes even after a migration recomputes the outer content hash", () => {
    const packed = createFinalResearchPackage(packageInput());
    for (const patch of [
      { policyVersion: "obsolete-policy" },
      { finalBrief: {} },
      { quality: { schemaVersion: 1, status: "perfect", issues: [] } },
      {
        evidenceManifest: {
          schemaVersion: 1,
          sources: [
            {
              evidenceId: "ev_manual",
              capturedChars: null,
              includedChars: -1,
              omittedReason: null,
            },
          ],
        },
      },
      {
        evidence: [
          {
            id: "ev_manual",
            url: "https://example.com/manual",
            status: "captured",
            content: 100,
          },
        ],
      },
    ]) {
      expect(
        readFinalResearchPackage(reseal({ ...packed, ...patch })),
      ).toBeNull();
    }
  });

  it("checks the report's own content hash as well as the enclosing package version", () => {
    const packed = createFinalResearchPackage(packageInput());
    const modified = reseal({
      ...packed,
      report: { ...packed.report, text: "新版报告文字但仍保留旧报告 hash" },
    });
    expect(readFinalResearchPackage(modified)).toBeNull();
  });
});

describe("verification checkpoint recovery", () => {
  it("preserves dispatch intent separately from read and answer states", () => {
    const saved = {
      ...checkpoint(),
      checkpoint: "verification-v3",
      acquisition: { cleaning: "read" },
      searchOutcomes: { "cleaning/primary": "reserved" },
      searchAttemptIds: { "cleaning/primary": "attempt-original" },
    };
    expect(
      restoreVerificationPlan(saved, verificationIdentity(brief, draft)),
    ).toMatchObject({
      acquisition: { cleaning: "read" },
      unresolved: ["portion"],
      searchOutcomes: { "cleaning/primary": "reserved" },
      searchAttemptIds: { "cleaning/primary": "attempt-original" },
    });
    expect(
      restoreVerificationPlan(
        { ...saved, acquisition: { unknown: "read" } },
        verificationIdentity(brief, draft),
      ),
    ).toBeNull();
    expect(
      restoreVerificationPlan(
        { ...saved, searchOutcomes: { "unknown/primary": "completed" } },
        verificationIdentity(brief, draft),
      ),
    ).toBeNull();
  });
  it("reuses an unchanged plan without forgetting which sources still need reading", () => {
    const saved = checkpoint();
    const restored = restoreVerificationPlan(
      saved,
      verificationIdentity(brief, draft),
    );
    expect(restored).toMatchObject({
      searched: ["cleaning"],
      unresolved: ["portion"],
      sourceIdsByQuestion: { cleaning: ["ev_manual"] },
    });
    expect(restored?.questionsVersion).toBe(saved.questionsVersion);
  });

  it("requires planning again when the actual brief or research draft changes", () => {
    const saved = checkpoint();
    expect(
      restoreVerificationPlan(
        saved,
        verificationIdentity({ ...brief, constraints: "改为家庭使用" }, draft),
      ),
    ).toBeNull();
    expect(
      restoreVerificationPlan(
        saved,
        verificationIdentity(brief, [
          { ...draft[0], text: "新的原稿与不同证据缺口" },
        ]),
      ),
    ).toBeNull();
  });

  it("invalidates old or mismatched planners instead of silently reusing unrelated questions", () => {
    const saved = checkpoint();
    expect(
      restoreVerificationPlan(
        { ...saved, checkpoint: "verification-v1" },
        verificationIdentity(brief, draft),
      ),
    ).toBeNull();
    expect(
      restoreVerificationPlan(
        { ...saved, plannerVersion: "old-planner" },
        verificationIdentity(brief, draft),
      ),
    ).toBeNull();
    expect(saved.plannerVersion).toBe(VERIFICATION_PLANNER_VERSION);
  });

  it("rejects tampered questions even if their brief and research hashes still match", () => {
    const saved = checkpoint();
    saved.questions[0].query = "宠物食品进口同比 120%";
    expect(
      restoreVerificationPlan(saved, verificationIdentity(brief, draft)),
    ).toBeNull();
  });

  it("rejects duplicate question identities and progress entries from a different question set", () => {
    const duplicate = checkpoint();
    duplicate.questions[1].id = duplicate.questions[0].id;
    duplicate.questionsVersion = researchVersion(duplicate.questions);
    expect(
      restoreVerificationPlan(duplicate, verificationIdentity(brief, draft)),
    ).toBeNull();
    expect(
      restoreVerificationPlan(
        { ...checkpoint(), searched: ["stale-question"] },
        verificationIdentity(brief, draft),
      ),
    ).toBeNull();
    expect(
      restoreVerificationPlan(
        { ...checkpoint(), unresolved: ["stale-question"] },
        verificationIdentity(brief, draft),
      ),
    ).toBeNull();
  });
});

describe("cumulative stage budgets", () => {
  it("reserves later crawl and search capacity rather than granting a fresh quota per stage", () => {
    expect(stageCallCeiling(plan, "research", "crawl")).toBe(18);
    expect(stageCallCeiling(plan, "capture", "crawl")).toBe(22);
    expect(stageCallCeiling(plan, "verify", "crawl")).toBe(30);
    // If research used 17 calls, capture can add five, not 22 or a renewed 30.
    expect(stageCallCeiling(plan, "capture", "crawl") - 17).toBe(5);
    expect(stageCallCeiling(plan, "research", "search")).toBe(17);
    expect(stageCallCeiling(plan, "verify", "search")).toBe(20);
  });

  it("leaves a minimum read/create/final model loop for production", () => {
    expect(stageCallCeiling(plan, "research", "llm")).toBe(22);
    expect(stageCallCeiling(plan, "verify", "llm")).toBe(24);
    expect(stageCallCeiling(plan, "synthesize", "llm")).toBe(27);
    expect(stageCallCeiling(plan, "produce", "llm")).toBe(30);
    expect(plan.limits.llm - stageCallCeiling(plan, "synthesize", "llm")).toBe(
      3,
    );
  });

  it("keeps three synthesis calls within the existing total when no production stage follows", () => {
    const researchOnly = {
      ...plan,
      stages: plan.stages.filter((stage) => stage.kind !== "produce"),
    };
    const originalLimits = { ...researchOnly.limits };
    expect(stageCallCeiling(researchOnly, "research", "llm")).toBe(25);
    expect(stageCallCeiling(researchOnly, "verify", "llm")).toBe(27);
    expect(stageCallCeiling(researchOnly, "synthesize", "llm")).toBe(30);
    expect(
      stageCallCeiling(researchOnly, "synthesize", "llm") -
        stageCallCeiling(researchOnly, "verify", "llm"),
    ).toBe(3);
    expect(researchOnly.limits).toEqual(originalLimits);
  });

  it("reserves only stages included in the plan, and exposes full capacity to production-only tasks", () => {
    const noVerify = {
      ...plan,
      stages: plan.stages.filter((stage) => stage.kind !== "verify"),
    };
    expect(stageCallCeiling(noVerify, "research", "search")).toBe(
      plan.limits.search,
    );
    expect(stageCallCeiling(noVerify, "capture", "crawl")).toBe(
      plan.limits.crawl,
    );
    const productionOnly = {
      ...plan,
      stages: [{ kind: "produce", engine: "deerflow" }],
    };
    expect(stageCallCeiling(productionOnly, "produce", "llm")).toBe(30);
  });

  it("does not create negative allocations or exceed a small configured total", () => {
    for (const limit of [0, 1, 2, 3, 4, 10]) {
      const small = { ...plan, limits: { ...plan.limits, llm: limit } };
      const ceilings = plan.stages.map((stage) =>
        stageCallCeiling(small, stage.kind, "llm"),
      );
      expect(
        ceilings.every((ceiling) => ceiling >= 0 && ceiling <= limit),
      ).toBe(true);
      expect(ceilings).toEqual(
        [...ceilings].sort((left, right) => left - right),
      );
    }
  });
});

describe("decision-related verification planning", () => {
  it("does not authorize unrelated pet-food data even when the decision borrows project words", () => {
    const candidate = {
      ...checkpoint().questions[0],
      query: "2026 宠物食品进口同比 120%",
      decision: "核对办公室午餐行业市场规模",
    };
    expect(verificationQuestionRelevant(candidate, brief, [])).toBe(false);
  });

  it("requires a relationship in both the query and the decision", () => {
    expect(
      verificationQuestionRelevant(checkpoint().questions[0], brief, []),
    ).toBe(true);
    expect(
      verificationQuestionRelevant(
        { ...checkpoint().questions[0], decision: "验证宠物粮零售增长" },
        brief,
        [],
      ),
    ).toBe(false);
  });

  it("permits an exact product identifier grounded in the explicitly associated evidence", () => {
    const candidate = {
      ...checkpoint().questions[0],
      query: "LB-200 manual",
      evidenceIds: ["ev_product"],
      decision: "是否适合办公室午餐",
    };
    const evidence = [
      {
        id: "ev_product",
        title: "Aria LB-200 参数手册",
        content: "具体型号资料",
      },
    ];
    expect(verificationQuestionRelevant(candidate, brief, evidence)).toBe(true);
    expect(
      verificationQuestionRelevant(
        { ...candidate, evidenceIds: ["different-source"] },
        brief,
        evidence,
      ),
    ).toBe(false);
  });

  it("does not mistake a partial SKU prefix for the exact source identity", () => {
    const candidate = {
      ...checkpoint().questions[0],
      query: "LB-20 manual",
      evidenceIds: ["ev_product"],
      decision: "是否适合办公室午餐",
    };
    expect(
      verificationQuestionRelevant(candidate, brief, [
        { id: "ev_product", title: "Aria LB-200 参数手册" },
      ]),
    ).toBe(false);
  });
});

describe("structured factual evidence identities", () => {
  it("permits clearly unverified proposals without fabricating evidence", () => {
    expect(validateDeliverableEvidence(metadata(), [])).toEqual([]);
  });

  it("rejects an observed item that has no source or references a source not supplied this round", () => {
    const value = metadata();
    value.competitors[0].status = "observed";
    expect(validateDeliverableEvidence(value, ["ev_manual"])).toContain(
      "观察/有支持的项目缺少结构化证据 ID",
    );
    value.competitors[0].evidenceIds = ["ev_not_provided"];
    expect(
      validateDeliverableEvidence(value, ["ev_manual"]).join(" "),
    ).toContain("ev_not_provided");
  });

  it("applies the same evidence-identity gate to supported hypotheses and design alternatives", () => {
    const value = metadata();
    value.hypotheses[0].status = "supported";
    value.finalBrief.alternatives[0].status = "supported";
    expect(validateDeliverableEvidence(value, ["ev_manual"])).not.toEqual([]);
    value.hypotheses[0].evidenceIds = ["ev_manual"];
    value.finalBrief.alternatives[0].evidenceIds = ["ev_wrong"];
    expect(
      validateDeliverableEvidence(value, ["ev_manual"]).join(" "),
    ).toContain("ev_wrong");
  });

  it("rejects ambiguous duplicate retained-hypothesis IDs before handoff", () => {
    const value = metadata();
    value.hypotheses.push({ ...value.hypotheses[0], text: "同 ID 但不同含义" });
    expect(validateDeliverableEvidence(value, [])).toContain("假设 ID 重复");
  });

  it("requires original captured text for each source used to label an item observed", () => {
    const value = metadata();
    value.competitors[0].status = "observed";
    value.competitors[0].evidenceIds = ["ev_manual"];
    expect(validateDeliverableEvidence(value, ["ev_manual"], [])).not.toEqual(
      [],
    );
    expect(
      validateDeliverableEvidence(value, ["ev_manual"], ["ev_manual"]),
    ).toEqual([]);
    value.competitors[0].evidenceIds.push("ev_search_excerpt");
    expect(
      validateDeliverableEvidence(
        value,
        ["ev_manual", "ev_search_excerpt"],
        ["ev_manual"],
      ),
    ).not.toEqual([]);
  });
});

