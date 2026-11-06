// @vitest-environment node
import { createHash } from "node:crypto";
import type {
  ResearchAttempt,
  ResearchEvidence,
  ResearchStage,
  ResearchTask,
} from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResearchError, researchJson } from "./errors";
import { researchBriefSchema } from "./types";
import { readFinalResearchPackage, researchVersion } from "./workflow-quality";
import type {
  SynthesisCheckpoint,
  SynthesisMetadata,
} from "./synthesis-checkpoint";

const external = vi.hoisted(() => ({
  db: {
    $transaction: vi.fn(),
    researchBrief: { findUniqueOrThrow: vi.fn() },
    researchTask: {
      findUniqueOrThrow: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    researchStage: {
      findMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    researchAttempt: {
      findUnique: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    researchEvidence: { findMany: vi.fn(), updateMany: vi.fn() },
    researchArtifact: { updateMany: vi.fn() },
    researchAttachment: { updateMany: vi.fn() },
  },
  model: vi.fn(),
  appendEvent: vi.fn(),
  event: vi.fn(),
  readFile: vi.fn(),
  saveBundle: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: external.db }));
vi.mock("./gateway", () => ({ researchModelCall: external.model }));
vi.mock("./service", () => ({
  lockResearchTask: vi.fn(async () => {}),
  appendResearchEvent: external.appendEvent,
  researchEvent: external.event,
}));
vi.mock("./config", () => ({
  getResearchConfig: vi.fn(),
  researchToken: vi.fn(),
}));
vi.mock("./tools", () => ({ researchTool: vi.fn() }));
vi.mock("./inputs", () => ({
  prepareResearchInputs: vi.fn(async (_task, brief) => brief),
}));
vi.mock("./intake", () => ({ runResearchIntake: vi.fn() }));
vi.mock("./attachments", () => ({ readResearchAttachments: vi.fn() }));
vi.mock("./storage", () => ({
  readResearchFile: external.readFile,
  saveResearchSource: vi.fn(),
  writeResearchFile: vi.fn(),
  removeResearchFile: vi.fn(),
}));
vi.mock("./artifacts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./artifacts")>();
  return {
    ...actual,
    saveResearchArtifact: vi.fn(),
    saveResearchArtifactBatch: external.saveBundle,
  };
});

import { executeResearchTask } from "./worker";

const brief = researchBriefSchema.parse({
  question: "研究美国一体式轻食制作设备的功能、消费者需求及竞品。",
  market: "美国",
});
const sourceId = "cm_source_worker_001";
const body =
  "# 美国一体式轻食制作设备产品说明书\n\n样例设备可切碎食材及加热；食材仍需用户购买与放入。该说明书没有给出消费者满意度或市场规模。";
const bodyHash = createHash("sha256").update(body).digest("hex");
const draft = `# 已读材料\n\n样例说明书列明切碎食材及加热，用户仍需准备食材。[${sourceId}]\n\n该单一来源不足以推断市场规模与消费者偏好。`;
const report = `# 美国一体式轻食制作设备研究\n\n这份说明书呈现的是切碎食材与加热的组合，准备和放入食材仍由用户完成。[${sourceId}]\n\n因此，目前只能确认样例设备的功能边界。单一说明书不能说明美国消费者偏好，也不足以推断市场规模。`;
const metadata: SynthesisMetadata = {
  finalBrief: {
    goal: brief.question,
    scope: "美国；目前仅有一份受控说明书样例，结论保持为材料草稿。",
    alternatives: [],
    acceptanceCriteria: [],
    openQuestions: ["消费者对完整准备和清洁流程如何评价？"],
  },
  hypotheses: [],
  competitors: [],
  caveats: [],
  decisionCards: [],
};

function completedResponse(text: string, id: string) {
  return {
    id,
    status: "completed",
    output: [
      {
        type: "message",
        content: [{ type: "output_text", text }],
      },
    ],
  };
}

type StreamEventHandler = (event: {
  type: string;
  delta: string;
}) => void | Promise<void>;

async function streamCompletedResponse(
  text: string,
  id: string,
  onEvent: StreamEventHandler,
) {
  const boundary = Math.floor(text.length / 2);
  await onEvent({
    type: "response.output_text.delta",
    delta: text.slice(0, boundary),
  });
  await onEvent({
    type: "response.output_text.delta",
    delta: text.slice(boundary),
  });
  return completedResponse(text, id);
}

function draftResponse(id = "response-draft-a") {
  return async (
    _attemptId: unknown,
    _request: unknown,
    onEvent: StreamEventHandler,
  ) => streamCompletedResponse(draft, id, onEvent);
}

function assertEditorialInput(request: {
  messages: Array<{ role: string; content: string }>;
}) {
  const input = JSON.parse(request.messages[1].content);
  expect(input.draft).toBe(draft);
  expect(input.brief.question).toBe(brief.question);
  expect(input.taskSpec.market).toBe("美国");
  expect(input.preserveCitationIds).toEqual([sourceId]);
  expect(input.evidence).toEqual([
    expect.objectContaining({
      id: sourceId,
      contentHash: bodyHash,
      content: expect.stringContaining("食材仍需用户购买与放入"),
      routing: expect.objectContaining({ role: "product_identity" }),
    }),
  ]);
}

function assertSingleAttemptModelCalls() {
  for (const call of external.model.mock.calls) {
    expect(call[5]).toEqual({ maxAttempts: 1 });
  }
}

type StageWhere = {
  taskId: string;
  status?: string;
  kind?: { in: string[] };
};
type Update<T> = { where: { id: string }; data: Partial<T> };

/** Executes the actual worker, context packer, readiness/citation gates, final
 * package schema, and completion checkpoint. Persistence and the gateway are
 * deterministic memory boundaries. This is not a PostgreSQL race/retry-service
 * test, a new semantic review, or evidence of real provider output quality.
 */
function harness(role: "background" | "product_identity") {
  const now = new Date();
  const task: ResearchTask = {
    id: "task-worker-fixture",
    projectId: "project-fixture",
    briefId: "brief-fixture",
    userId: "user-fixture",
    clientRequestId: "client-fixture",
    inputHash: "fixture-request",
    sourceTaskId: null,
    preset: "research",
    scope: "standard",
    modelId: "fixture-model",
    reasoningEffort: "high",
    plan: researchJson({
      preset: "research",
      reason: "Controlled worker integration fixture",
      products: ["report", "brief", "competitors"],
      stages: [
        { kind: "verify", engine: "chugao" },
        { kind: "synthesize", engine: "chugao" },
      ],
      limits: { llm: 30, search: 20, crawl: 30, minutes: 25 },
    }),
    configSnapshot: { retentionDays: 30 },
    status: "running",
    nextSeq: 0,
    llmCalls: 0,
    searchCalls: 0,
    crawlCalls: 0,
    executionToken: "lease-a",
    heartbeatAt: now,
    deadlineAt: new Date(now.getTime() + 120000),
    startedAt: now,
    finishedAt: null,
    expiresAt: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  };
  const stages: ResearchStage[] = [
    {
      id: "stage-verify",
      taskId: task.id,
      kind: "verify",
      engine: "chugao",
      ordinal: 1,
      status: "completed",
      activeAttemptId: null,
      text: "受控合同测试分流；并非对真实附件作出新的模型核验。",
      result: {
        decisionGaps: [],
        decisionRoutes: [
          {
            evidenceId: sourceId,
            contentHash: bodyHash,
            role,
            decisionIds: role === "background" ? [] : ["q_function"],
            reason: "仅用于测试 worker 分支的人工设定分流。",
          },
        ],
      },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "stage-synthesize",
      taskId: task.id,
      kind: "synthesize",
      engine: "chugao",
      ordinal: 2,
      status: "pending",
      activeAttemptId: null,
      text: "",
      result: null,
      createdAt: now,
      updatedAt: now,
    },
  ];
  const attempts: ResearchAttempt[] = [];
  const evidence: ResearchEvidence[] = [
    {
      id: sourceId,
      projectId: task.projectId,
      taskId: task.id,
      sourceKey: "fixture-manual",
      canonicalUrl: "https://example.org/manual/fixture-device",
      originalUrl: "https://example.org/manual/fixture-device",
      title: "美国一体式轻食制作设备产品说明书",
      excerpt: "设备功能说明书；消费者体验与市场规模仍未知。",
      contentKey: "fixture-body.txt",
      screenshotKey: null,
      media: null,
      contentHash: bodyHash,
      originUrl: null,
      status: "captured",
      claims: null,
      fetchedAt: now,
      expiresAt: null,
      purgedAt: null,
      createdAt: now,
    },
  ];
  const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const bundles: Array<{
    files: Array<{ filename: string; kind: string; text: string }>;
    publishedWith: { task: string; stage: string; attempt: string };
  }> = [];
  let failNextCompletion = false;
  const db = external.db;
  const stageById = (id: string) => {
    const row = stages.find((stage) => stage.id === id);
    if (!row) throw Error(`Unknown fixture stage: ${id}`);
    return row;
  };
  const attemptById = (id: string) => {
    const row = attempts.find((attempt) => attempt.id === id);
    if (!row) throw Error(`Unknown fixture attempt: ${id}`);
    return row;
  };
  db.$transaction.mockImplementation(
    async (fn: (tx: typeof db) => Promise<unknown>) => {
      const saved = structuredClone({ task, stages, attempts });
      const eventCount = events.length;
      const bundleCount = bundles.length;
      try {
        return await fn(db);
      } catch (error) {
        Object.assign(task, saved.task);
        // Keep object identity for fixture.stage, as the test observes it.
        saved.stages.forEach((stage, index) =>
          Object.assign(stages[index], stage),
        );
        attempts.splice(0, attempts.length, ...saved.attempts);
        events.length = eventCount;
        bundles.length = bundleCount;
        throw error;
      }
    },
  );
  db.researchBrief.findUniqueOrThrow.mockResolvedValue({ content: brief });
  db.researchTask.findUniqueOrThrow.mockImplementation(async () =>
    structuredClone(task),
  );
  db.researchTask.findFirst.mockResolvedValue(null);
  db.researchTask.update.mockImplementation(
    async ({ data }: Update<ResearchTask>) => {
      Object.assign(task, structuredClone(data));
      return structuredClone(task);
    },
  );
  db.researchTask.updateMany.mockResolvedValue({ count: 1 });
  db.researchStage.findMany.mockImplementation(
    async ({ where }: { where: StageWhere }) =>
      structuredClone(
        stages.filter(
          (stage) =>
            stage.taskId === where.taskId &&
            (!where.status || stage.status === where.status) &&
            (!where.kind || where.kind.in.includes(stage.kind)),
        ),
      ),
  );
  db.researchStage.findUniqueOrThrow.mockImplementation(
    async ({ where }: { where: { id: string } }) =>
      structuredClone(stageById(where.id)),
  );
  db.researchStage.count.mockImplementation(
    async ({ where }: { where: { taskId: string; status: { not: string } } }) =>
      stages.filter(
        (stage) =>
          stage.taskId === where.taskId && stage.status !== where.status.not,
      ).length,
  );
  db.researchStage.update.mockImplementation(
    async ({ where, data }: Update<ResearchStage>) => {
      Object.assign(stageById(where.id), structuredClone(data));
      return structuredClone(stageById(where.id));
    },
  );
  db.researchStage.updateMany.mockImplementation(
    async ({
      where,
      data,
    }: Update<ResearchStage> & { where: { status: { not: string } } }) => {
      const row = stageById(where.id);
      if (row.status === where.status.not) return { count: 0 };
      Object.assign(row, structuredClone(data));
      return { count: 1 };
    },
  );
  db.researchAttempt.findUnique.mockImplementation(
    async ({ where }: { where: { id: string } }) =>
      structuredClone(
        attempts.find((attempt) => attempt.id === where.id) ?? null,
      ),
  );
  db.researchAttempt.count.mockImplementation(
    async ({ where }: { where: { stageId: string } }) =>
      attempts.filter((attempt) => attempt.stageId === where.stageId).length,
  );
  db.researchAttempt.create.mockImplementation(
    async ({
      data,
    }: {
      data: { stageId: string; ordinal: number; retryRequestId?: string };
    }) => {
      const row: ResearchAttempt = {
        id: `attempt-${data.ordinal}`,
        stageId: data.stageId,
        ordinal: data.ordinal,
        retryRequestId: data.retryRequestId ?? null,
        status: "queued",
        remoteRunId: null,
        remoteCursor: 0,
        text: "",
        error: null,
        startedAt: null,
        finishedAt: null,
        createdAt: new Date(),
      };
      attempts.push(row);
      return structuredClone(row);
    },
  );
  db.researchAttempt.update.mockImplementation(
    async ({ where, data }: Update<ResearchAttempt>) => {
      Object.assign(attemptById(where.id), structuredClone(data));
      return structuredClone(attemptById(where.id));
    },
  );
  db.researchAttempt.updateMany.mockImplementation(
    async ({
      where,
      data,
    }: Update<ResearchAttempt> & { where: { status: string } }) => {
      const row = attemptById(where.id);
      if (row.status !== where.status) return { count: 0 };
      Object.assign(row, structuredClone(data));
      return { count: 1 };
    },
  );
  db.researchEvidence.findMany.mockResolvedValue(evidence);
  db.researchEvidence.updateMany.mockResolvedValue({ count: evidence.length });
  db.researchArtifact.updateMany.mockResolvedValue({ count: 0 });
  db.researchAttachment.updateMany.mockResolvedValue({ count: 0 });
  external.readFile.mockImplementation(async (key: string) => {
    if (key !== evidence[0].contentKey) throw Error("Unexpected source read");
    return Buffer.from(body);
  });
  const recordEvent = async (
    _taskId: string,
    type: string,
    payload: Record<string, unknown>,
  ) => {
    if (type === "task.completed" && failNextCompletion) {
      failNextCompletion = false;
      throw new ResearchError(
        "SIMULATED_PUBLICATION_FAILURE",
        "Controlled failure inside the publication transaction",
        500,
      );
    }
    events.push({ type, payload: structuredClone(payload) });
  };
  external.appendEvent.mockImplementation(
    async (
      _tx,
      taskId: string,
      type: string,
      payload: Record<string, unknown>,
    ) => recordEvent(taskId, type, payload),
  );
  external.event.mockImplementation(recordEvent);
  external.saveBundle.mockImplementation(
    async (
      bundle: {
        files: Array<{ filename: string; kind: string; data: Buffer }>;
      },
      beforeCommit?: (tx: typeof db) => Promise<void>,
    ) => {
      await db.$transaction(async (tx: typeof db) => {
        await beforeCommit?.(tx);
        bundles.push({
          files: bundle.files.map((file) => ({
            filename: file.filename,
            kind: file.kind,
            text: file.data.toString("utf8"),
          })),
          publishedWith: {
            task: task.status,
            stage: stages[1].status,
            attempt: attemptById(stages[1].activeAttemptId!).status,
          },
        });
      });
    },
  );

  return {
    task,
    stage: stages[1],
    verifiedStage: stages[0],
    evidence,
    attempts,
    events,
    bundles,
    failNextCompletion() {
      failNextCompletion = true;
    },
    async run() {
      await executeResearchTask(structuredClone(task), new AbortController());
    },
    async explicitRetryAndClaim() {
      // Emulates only the persisted state promised by retryResearchStage and
      // worker claim. The actual HTTP service/DB lock is covered elsewhere.
      expect(task.status).toBe("failed");
      const queued = await db.researchAttempt.create({
        data: {
          stageId: stages[1].id,
          ordinal: attempts.length + 1,
          retryRequestId: "explicit-retry-fixture",
        },
      });
      stages[1].status = "pending";
      stages[1].activeAttemptId = queued.id;
      stages[1].text = "";
      task.status = "running";
      task.executionToken = "lease-b";
      task.finishedAt = null;
      task.expiresAt = null;
      task.error = null;
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw Error("Network is forbidden in this worker contract test");
    }),
  );
  external.model.mockRejectedValue(
    new ResearchError("UNEXPECTED_MODEL_CALL", "Unexpected model call", 500),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("real synthesis worker with simulated I/O boundaries", () => {
  it("background-only context creates a materials status document and never calls the model", async () => {
    const fixture = harness("background");
    await fixture.run();

    expect(fixture.task.status).toBe("completed");
    expect(fixture.stage.status).toBe("completed");
    expect(external.model).not.toHaveBeenCalled();
    expect(fixture.events).toContainEqual({
      type: "synthesis.materials_insufficient",
      payload: expect.objectContaining({
        eligibleDirectSources: 0,
        skippedModelCalls: [
          "research.synthesize",
          "research.synthesize_editorial",
          "research.synthesize_metadata",
        ],
      }),
    });
    const result = fixture.stage.result as {
      finalResearchPackage: unknown;
      synthesisCheckpoint?: unknown;
    };
    const finalPackage = readFinalResearchPackage(result.finalResearchPackage);
    expect(finalPackage).not.toBeNull();
    expect(finalPackage!.quality.status).toBe("insufficient");
    expect(finalPackage!.decisionCards).toEqual([]);
    expect(finalPackage!.report.text).toContain("# 研究材料不足");
    expect(finalPackage!.report.text).toContain("没有调用模型扩写报告");
    expect(result.synthesisCheckpoint).toBeUndefined();
    expect(fixture.bundles).toHaveLength(1);
    expect(fixture.bundles[0].publishedWith).toEqual({
      task: "completed",
      stage: "completed",
      attempt: "completed",
    });
    expect(
      fixture.events.filter((event) => event.type === "stage.completed"),
    ).toHaveLength(1);
    expect(
      fixture.events.filter((event) => event.type === "task.completed"),
    ).toHaveLength(1);
    expect(fixture.bundles[0].files.map((file) => file.kind)).toEqual([
      "report",
      "brief",
      "competitors",
      "research_package",
    ]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a fresh synthesis with only two calls remaining before spending any call and preserves its materials", async () => {
    const fixture = harness("product_identity");
    fixture.task.llmCalls = 28;
    const originalPlan = structuredClone(fixture.task.plan);
    const originalEvidence = structuredClone(fixture.evidence);
    const originalVerification = structuredClone(fixture.verifiedStage);
    await fixture.run();

    expect(fixture.task.status).toBe("budget_exhausted");
    expect(fixture.stage.status).toBe("failed");
    expect(fixture.task.error).toMatchObject({
      code: "BUDGET_EXHAUSTED",
      message: expect.stringContaining("至少需要 3 次模型调用，当前可用 2 次"),
    });
    expect(external.model).not.toHaveBeenCalled();
    expect(fixture.task.llmCalls).toBe(28);
    expect(fixture.task.plan).toEqual(originalPlan);
    expect(fixture.evidence).toEqual(originalEvidence);
    expect(fixture.verifiedStage).toEqual(originalVerification);
    expect(external.readFile).toHaveBeenCalledWith("fixture-body.txt");
    expect(fixture.stage.text).toBe("");
    expect(fixture.attempts).toHaveLength(1);
    expect(fixture.attempts[0].status).toBe("failed");
    expect(fixture.stage.result).toHaveProperty("contextManifest");
    expect(fixture.stage.result).not.toHaveProperty("synthesisCheckpoint");
    expect(fixture.bundles).toEqual([]);
    expect(
      fixture.events.filter((event) => event.type === "task.completed"),
    ).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("persists the completed draft through editorial failure and explicitly resumes editorial plus metadata only", async () => {
    const fixture = harness("product_identity");
    const partialReport = "# 尚未完成的编辑正文\n\n现有材料";
    external.model
      .mockImplementationOnce(draftResponse())
      .mockImplementationOnce(async (_attemptId, request, onEvent) => {
        assertEditorialInput(request);
        // The draft callback really streamed text. Entering the editor must
        // replace it before any editorial delta, rather than append another
        // document to the same client buffer.
        const textEvents = fixture.events.filter(
          (event) => event.type === "stage.text",
        );
        expect(textEvents.length).toBeGreaterThan(1);
        expect(textEvents.at(-1)?.payload).toMatchObject({
          attemptId: "attempt-1",
          text: "",
        });
        expect(fixture.stage.text).toBe("");
        expect(fixture.attempts[0].text).toBe("");
        const saved = fixture.stage.result as {
          synthesisCheckpoint: SynthesisCheckpoint;
        };
        expect(saved.synthesisCheckpoint.draft.text).toBe(draft);
        expect(saved.synthesisCheckpoint.report).toBeUndefined();
        await onEvent({
          type: "response.output_text.delta",
          delta: partialReport,
        });
        throw new ResearchError(
          "UPSTREAM_FAILED",
          "Simulated editorial stream failure",
          502,
        );
      });
    await fixture.run();

    expect(fixture.task.status).toBe("failed");
    expect(fixture.stage.status).toBe("failed");
    expect(fixture.attempts).toHaveLength(1);
    expect(fixture.attempts[0].status).toBe("failed");
    expect(fixture.attempts[0].text).toBe(partialReport);
    expect(fixture.stage.text).toBe(partialReport);
    const first = structuredClone(
      (fixture.stage.result as { synthesisCheckpoint: SynthesisCheckpoint })
        .synthesisCheckpoint,
    );
    expect(first.version).toBe("synthesis-resume-v2");
    expect(first.draft).toMatchObject({
      text: draft,
      hash: researchVersion(draft),
      attemptId: "attempt-1",
      responseId: "response-draft-a",
    });
    expect(first.report).toBeUndefined();
    expect(first.metadata).toBeUndefined();
    expect(fixture.bundles).toEqual([]);
    expect(external.model.mock.calls.map((call) => call[4].purpose)).toEqual([
      "research.synthesize",
      "research.synthesize_editorial",
    ]);

    await fixture.explicitRetryAndClaim();
    // Two remaining calls suffice for a real saved draft. Gateway reservation
    // is simulated by advancing the existing counter inside each mock call.
    fixture.task.llmCalls = 28;
    external.model
      .mockImplementationOnce(async (attemptId, request, onEvent) => {
        fixture.task.llmCalls += 1;
        expect(attemptId).toBe("attempt-2");
        assertEditorialInput(request);
        expect(fixture.stage.text).toBe("");
        return streamCompletedResponse(report, "response-report-b", onEvent);
      })
      .mockImplementationOnce(async (_attemptId, request) => {
        fixture.task.llmCalls += 1;
        expect(JSON.parse(request.messages[1].content).report).toBe(report);
        return completedResponse(
          JSON.stringify(metadata),
          "response-metadata-b",
        );
      });
    await fixture.run();

    expect(fixture.task.status).toBe("completed");
    expect(fixture.task.llmCalls).toBe(30);
    expect(fixture.stage.status).toBe("completed");
    expect(fixture.attempts.map((attempt) => attempt.status)).toEqual([
      "failed",
      "completed",
    ]);
    expect(external.model.mock.calls.map((call) => call[4].purpose)).toEqual([
      "research.synthesize",
      "research.synthesize_editorial",
      "research.synthesize_editorial",
      "research.synthesize_metadata",
    ]);
    assertSingleAttemptModelCalls();
    const result = fixture.stage.result as {
      synthesisCheckpoint: SynthesisCheckpoint;
      finalResearchPackage: unknown;
    };
    expect(result.synthesisCheckpoint.inputHash).toBe(first.inputHash);
    expect(result.synthesisCheckpoint.draft).toEqual(first.draft);
    expect(result.synthesisCheckpoint.report).toMatchObject({
      text: report,
      hash: researchVersion(report),
      draftHash: first.draft.hash,
      attemptId: "attempt-2",
      responseId: "response-report-b",
    });
    expect(result.synthesisCheckpoint.metadata).toMatchObject({
      reportHash: researchVersion(report),
      attemptId: "attempt-2",
      responseId: "response-metadata-b",
    });
    expect(result.synthesisCheckpoint.metadata!.value).toEqual(metadata);
    expect(fixture.attempts[0].text).toBe(partialReport);
    const finalPackage = readFinalResearchPackage(result.finalResearchPackage);
    expect(finalPackage).not.toBeNull();
    expect(finalPackage!.report.text.split(report)).toHaveLength(2);
    expect(finalPackage!.report.text).not.toContain(draft);
    expect(finalPackage!.report.text).not.toContain(partialReport);
    expect(finalPackage!.report.hash).toBe(
      researchVersion(finalPackage!.report.text),
    );
    expect(fixture.bundles).toHaveLength(1);
    expect(
      fixture.events.some(
        (event) =>
          event.type === "stage.activity" &&
          event.payload.originAttemptId === "attempt-1" &&
          event.payload.phase === "draft",
      ),
    ).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("persists draft and edited report through metadata failure, then an explicit attempt sends metadata only", async () => {
    const fixture = harness("product_identity");
    external.model
      .mockImplementationOnce(draftResponse())
      .mockImplementationOnce(async (_attemptId, request, onEvent) => {
        assertEditorialInput(request);
        expect(fixture.stage.text).toBe("");
        return streamCompletedResponse(report, "response-report-a", onEvent);
      })
      .mockImplementationOnce(async (_attemptId, request) => {
        expect(JSON.parse(request.messages[1].content).report).toBe(report);
        throw new ResearchError(
          "UPSTREAM_FAILED",
          "Simulated metadata stream failure",
          502,
        );
      });
    await fixture.run();

    expect(fixture.task.status).toBe("failed");
    expect(fixture.stage.status).toBe("failed");
    expect(fixture.attempts).toHaveLength(1);
    expect(fixture.attempts[0].status).toBe("failed");
    expect(fixture.attempts[0].text).toBe(report);
    expect(fixture.stage.text).toBe(report);
    const first = structuredClone(
      (fixture.stage.result as { synthesisCheckpoint: SynthesisCheckpoint })
        .synthesisCheckpoint,
    );
    expect(first.draft).toMatchObject({
      text: draft,
      hash: researchVersion(draft),
      attemptId: "attempt-1",
      responseId: "response-draft-a",
    });
    expect(first.report).toMatchObject({
      text: report,
      hash: researchVersion(report),
      draftHash: researchVersion(draft),
      attemptId: "attempt-1",
      responseId: "response-report-a",
    });
    expect(first.metadata).toBeUndefined();
    expect(fixture.bundles).toEqual([]);
    expect(external.model.mock.calls.map((call) => call[4].purpose)).toEqual([
      "research.synthesize",
      "research.synthesize_editorial",
      "research.synthesize_metadata",
    ]);

    await fixture.explicitRetryAndClaim();
    // The completed editorial report needs only the one metadata call left.
    fixture.task.llmCalls = 29;
    external.model.mockImplementationOnce(async () => {
      fixture.task.llmCalls += 1;
      return completedResponse(JSON.stringify(metadata), "response-metadata-b");
    });
    await fixture.run();

    expect(fixture.task.status).toBe("completed");
    expect(fixture.task.llmCalls).toBe(30);
    expect(fixture.stage.status).toBe("completed");
    expect(fixture.attempts.map((attempt) => attempt.status)).toEqual([
      "failed",
      "completed",
    ]);
    expect(external.model).toHaveBeenCalledTimes(4);
    const lastCall = external.model.mock.calls[3];
    expect(lastCall[0]).toBe("attempt-2");
    expect(lastCall[4].purpose).toBe("research.synthesize_metadata");
    expect(JSON.parse(lastCall[1].messages[1].content).report).toBe(report);
    assertSingleAttemptModelCalls();
    const result = fixture.stage.result as {
      synthesisCheckpoint: SynthesisCheckpoint;
      finalResearchPackage: unknown;
    };
    expect(result.synthesisCheckpoint.inputHash).toBe(first.inputHash);
    expect(result.synthesisCheckpoint.draft).toEqual(first.draft);
    expect(result.synthesisCheckpoint.report).toEqual(first.report);
    expect(result.synthesisCheckpoint.metadata).toMatchObject({
      reportHash: first.report!.hash,
      attemptId: "attempt-2",
      responseId: "response-metadata-b",
    });
    expect(result.synthesisCheckpoint.metadata!.value).toEqual(metadata);
    expect(fixture.attempts[0].text).toBe(report);
    const finalPackage = readFinalResearchPackage(result.finalResearchPackage);
    expect(finalPackage).not.toBeNull();
    expect(finalPackage!.report.text.split(report)).toHaveLength(2);
    expect(finalPackage!.report.text).not.toContain(draft);
    expect(finalPackage!.report.hash).toBe(
      researchVersion(finalPackage!.report.text),
    );
    expect(fixture.bundles).toHaveLength(1);
    expect(
      fixture.events
        .filter(
          (event) =>
            event.type === "stage.activity" &&
            event.payload.originAttemptId === "attempt-1",
        )
        .map((event) => event.payload.phase),
    ).toEqual(["draft", "report"]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a completed editorial response with an unknown citation before requesting metadata or publication", async () => {
    const fixture = harness("product_identity");
    const invalidReport = report.replace(sourceId, "cm_unread_source_999");
    external.model
      .mockImplementationOnce(draftResponse())
      .mockImplementationOnce(async (_attemptId, request, onEvent) => {
        assertEditorialInput(request);
        return streamCompletedResponse(
          invalidReport,
          "response-invalid-editorial",
          onEvent,
        );
      });
    await fixture.run();

    expect(fixture.task.status).toBe("failed");
    expect(fixture.stage.status).toBe("failed");
    expect(fixture.stage.text).toBe(invalidReport);
    expect(fixture.attempts[0].text).toBe(invalidReport);
    expect(external.model.mock.calls.map((call) => call[4].purpose)).toEqual([
      "research.synthesize",
      "research.synthesize_editorial",
    ]);
    assertSingleAttemptModelCalls();
    const saved = fixture.stage.result as {
      synthesisCheckpoint: SynthesisCheckpoint;
    };
    expect(saved.synthesisCheckpoint.draft.text).toBe(draft);
    expect(saved.synthesisCheckpoint.report).toBeUndefined();
    expect(saved.synthesisCheckpoint.metadata).toBeUndefined();
    expect(fixture.bundles).toEqual([]);
    expect(
      fixture.events.filter((event) => event.type === "task.completed"),
    ).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("a final callback failure publishes nothing and a new attempt reuses all three model completions", async () => {
    const fixture = harness("product_identity");
    fixture.failNextCompletion();
    external.model
      .mockImplementationOnce(draftResponse())
      .mockImplementationOnce(async (_attemptId, request, onEvent) => {
        assertEditorialInput(request);
        return streamCompletedResponse(report, "response-report-a", onEvent);
      })
      .mockResolvedValueOnce(
        completedResponse(JSON.stringify(metadata), "response-metadata-a"),
      );
    await fixture.run();

    expect(fixture.task.status).toBe("failed");
    expect(fixture.stage.status).toBe("failed");
    expect(fixture.attempts[0].status).toBe("failed");
    expect(fixture.task.error).toMatchObject({
      code: "SIMULATED_PUBLICATION_FAILURE",
    });
    expect(fixture.bundles).toEqual([]);
    expect(
      fixture.events.filter((event) => event.type === "stage.completed"),
    ).toEqual([]);
    expect(
      fixture.events.filter((event) => event.type === "task.completed"),
    ).toEqual([]);
    const saved = structuredClone(
      (fixture.stage.result as { synthesisCheckpoint: SynthesisCheckpoint })
        .synthesisCheckpoint,
    );
    expect(saved.draft.hash).toBe(researchVersion(draft));
    expect(saved.report?.draftHash).toBe(saved.draft.hash);
    expect(saved.report?.hash).toBe(researchVersion(report));
    expect(saved.metadata?.reportHash).toBe(saved.report?.hash);
    expect(saved.metadata?.value).toEqual(metadata);
    expect(external.model.mock.calls.map((call) => call[4].purpose)).toEqual([
      "research.synthesize",
      "research.synthesize_editorial",
      "research.synthesize_metadata",
    ]);
    assertSingleAttemptModelCalls();

    await fixture.explicitRetryAndClaim();
    // All three completions can publish locally even with no calls left.
    fixture.task.llmCalls = 30;
    await fixture.run();

    expect(fixture.task.status).toBe("completed");
    expect(fixture.task.llmCalls).toBe(30);
    expect(fixture.stage.status).toBe("completed");
    expect(fixture.attempts.map((attempt) => attempt.status)).toEqual([
      "failed",
      "completed",
    ]);
    expect(external.model).toHaveBeenCalledTimes(3);
    expect(
      (fixture.stage.result as { synthesisCheckpoint: SynthesisCheckpoint })
        .synthesisCheckpoint,
    ).toEqual(saved);
    expect(fixture.bundles).toHaveLength(1);
    expect(fixture.bundles[0].publishedWith).toEqual({
      task: "completed",
      stage: "completed",
      attempt: "completed",
    });
    expect(
      fixture.events.filter((event) => event.type === "stage.completed"),
    ).toHaveLength(1);
    expect(
      fixture.events.filter((event) => event.type === "task.completed"),
    ).toHaveLength(1);
    expect(
      fixture.events
        .filter(
          (event) =>
            event.type === "stage.activity" &&
            event.payload.originAttemptId === "attempt-1",
        )
        .map((event) => event.payload.phase),
    ).toEqual(["draft", "report", "metadata"]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["draft", "all three steps"] as const)(
    "preserves saved %s when retained source text becomes unreadable before explicit retry",
    async (savedPhase) => {
      const fixture = harness("product_identity");
      external.model.mockImplementationOnce(draftResponse());
      if (savedPhase === "draft") {
        external.model.mockImplementationOnce(
          async (_attemptId, request, onEvent) => {
            assertEditorialInput(request);
            await onEvent({
              type: "response.output_text.delta",
              delta: "# 失败前已输出的编辑片段\n\n当前材料",
            });
            throw new ResearchError(
              "UPSTREAM_FAILED",
              "Controlled editorial failure after draft persistence",
              502,
            );
          },
        );
      } else {
        fixture.failNextCompletion();
        external.model
          .mockImplementationOnce(async (_attemptId, request, onEvent) => {
            assertEditorialInput(request);
            return streamCompletedResponse(
              report,
              "response-report-a",
              onEvent,
            );
          })
          .mockResolvedValueOnce(
            completedResponse(JSON.stringify(metadata), "response-metadata-a"),
          );
      }
      await fixture.run();

      // Obtain the saved checkpoint from the real orchestration and actual
      // persistence callback, rather than seeding an assumed completion.
      expect(fixture.task.status).toBe("failed");
      expect(fixture.bundles).toEqual([]);
      const saved = structuredClone(
        (fixture.stage.result as { synthesisCheckpoint: SynthesisCheckpoint })
          .synthesisCheckpoint,
      );
      expect(saved.draft.text).toBe(draft);
      if (savedPhase === "draft") {
        expect(saved.report).toBeUndefined();
        expect(saved.metadata).toBeUndefined();
      } else {
        expect(saved.report?.text).toBe(report);
        expect(saved.metadata?.value).toEqual(metadata);
      }
      const previousAttempt = structuredClone(fixture.attempts[0]);
      expect(previousAttempt.status).toBe("failed");
      expect(previousAttempt.text.trim()).not.toBe("");
      const originalModelCalls = external.model.mock.calls.length;
      const originalPublicationCalls = external.saveBundle.mock.calls.length;
      const originalReads = external.readFile.mock.calls.length;

      external.readFile.mockRejectedValue(
        new Error("Controlled retained source file is now unreadable"),
      );
      await fixture.explicitRetryAndClaim();
      await fixture.run();

      expect(external.readFile.mock.calls.length).toBeGreaterThan(
        originalReads,
      );
      expect(fixture.task.status).toBe("failed");
      expect(fixture.task.error).toMatchObject({
        code: "SYNTHESIS_CHECKPOINT_MISMATCH",
      });
      expect(fixture.stage.status).toBe("failed");
      expect(
        (fixture.stage.result as { synthesisCheckpoint: SynthesisCheckpoint })
          .synthesisCheckpoint,
      ).toEqual(saved);
      expect(fixture.attempts).toHaveLength(2);
      expect(fixture.attempts[0]).toEqual(previousAttempt);
      expect(fixture.attempts[1].status).toBe("failed");
      expect(external.model).toHaveBeenCalledTimes(originalModelCalls);
      expect(external.saveBundle).toHaveBeenCalledTimes(
        originalPublicationCalls,
      );
      expect(fixture.bundles).toEqual([]);
      expect(fixture.stage.result).not.toHaveProperty("finalResearchPackage");
      expect(fixture.stage.text).not.toContain("# 研究材料不足");
      expect(
        fixture.events.filter((event) =>
          [
            "synthesis.materials_insufficient",
            "stage.completed",
            "task.completed",
          ].includes(event.type),
        ),
      ).toEqual([]);
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});

