// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResearchTask } from "@prisma/client";
import { setTimeout as delay } from "node:timers/promises";
import { db } from "@/lib/db";
import {
  activeResearchAttempt,
  finishResearchCall,
  waitForResearchCall,
} from "./budget";
import {
  runResearchIntake,
  researchIntakeView,
  createResearchIntakeTurn,
} from "./intake";
import { researchEvent, researchTaskView } from "./service";
import {
  confirmedIntakeRequirements,
  INTAKE_DIALOGUE_VERSION,
  parseIntakeDialogue,
  readIntakeConfirmationRequirements,
} from "./intake-contract";
import { researchBriefSchema, researchIntakeInputSchema } from "./types";

vi.mock("node:timers/promises", () => ({ setTimeout: vi.fn() }));
vi.mock("@/lib/db", () => {
  const database = {
    researchCall: { findMany: vi.fn(async () => []) },
    researchProject: { findFirst: vi.fn(async () => ({ id: "project" })) },
    researchTask: {
      findUnique: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
    },
    $transaction: vi.fn(),
  };
  database.$transaction.mockImplementation(async (fn) => fn(database));
  return { db: database };
});
vi.mock("@/lib/crypto", () => ({
  encrypt: (value: string) => value,
  decrypt: (value: string) => value,
}));
vi.mock("@/lib/chat-profiles", () => ({
  getChatProfile: vi.fn(async () => ({
    enabled: true,
    apiKey: "[REDACTED]",
    model: "synthetic-sol",
    baseUrl: "https://intake.invalid/v1",
  })),
}));
vi.mock("./budget", () => ({
  waitForResearchCall: vi.fn(async () => ({
    call: { id: "call" },
    task: {
      id: "task",
      modelId: "configured-sol",
      reasoningEffort: "medium",
      executionToken: "fixture-token",
      configSnapshot: {},
    },
  })),
  activeResearchAttempt: vi.fn(async () => ({
    stageId: "stage",
    stage: {
      taskId: "task",
      task: {
        id: "task",
        executionToken: "fixture-token",
        llmCalls: 1,
        plan: { limits: { llm: 3 } },
        deadlineAt: null,
      },
    },
  })),
  finishResearchCall: vi.fn(async () => {}),
}));
vi.mock("./service", () => ({
  researchEvent: vi.fn(async () => {}),
  createResearchTask: vi.fn(async () => ({
    id: "created",
    projectId: "project",
  })),
  researchTaskView: vi.fn(async (_user: string, id: string) => ({
    id,
    projectId: "project",
  })),
  readResearchTaskView: vi.fn(
    async (_tx: unknown, _user: string, id: string) => ({
      id,
      status: "queued",
      brief: {},
    }),
  ),
}));

const brief = researchBriefSchema.parse({
  question: "办公室轻食机的清洗流程研究",
  audience: "办公室使用者",
});
const utterance = "研究办公室轻食机的清洗流程。";
const modelAnswer = (overrides: Record<string, unknown> = {}) => ({
  acknowledgement: "我会先围绕实际使用流程理解问题。",
  nextQuestion: "目前最想改善的是哪一步使用体验？",
  ready: false,
  summary: "围绕办公室轻食机的使用与清洗展开研究。",
  unknowns: ["尚未确认具体型号"],
  confirmedRequirements: [utterance],
  products: ["report", "brief"],
  brief: {
    question: brief.question,
    market: "",
    audience: brief.audience,
    timeRange: "",
    constraints: "",
    competitors: [],
    links: [],
  },
  ...overrides,
});
const task = (
  answer = utterance,
  history: Array<{ role: string; content: string }> = [],
  intent = "continue",
) =>
  ({
    id: "task",
    scope: "standard",
    executionToken: "fixture-token",
    llmCalls: 0,
    deadlineAt: null,
    plan: { limits: { llm: 3, search: 0, crawl: 0, minutes: 4 } },
    configSnapshot: {
      intake: {
        answer,
        history,
        intent,
        settings: { preset: "auto", products: ["report", "brief"] },
      },
    },
  }) as unknown as ResearchTask;
const sse = (text: string) =>
  new Response(
    [
      { type: "response.output_text.delta", delta: text.slice(0, 15) },
      { type: "response.output_text.delta", delta: text.slice(15) },
      {
        type: "response.completed",
        response: {
          status: "completed",
          output: [
            { type: "message", content: [{ type: "output_text", text }] },
          ],
          usage: { input_tokens: 100, output_tokens: 80 },
        },
      },
    ]
      .map((event) => `data: ${JSON.stringify(event)}\n\n`)
      .join(""),
    { headers: { "Content-Type": "text/event-stream" } },
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(delay).mockReset();
  vi.mocked(delay).mockImplementation(async (_ms, value, options) => {
    options?.signal?.throwIfAborted();
    return value;
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("intake dialogue through the real Responses adapter (synthetic HTTP only)", () => {
  it("preserves model-authored answer suggestions without treating unchosen options as user requirements", async () => {
    const suggestions = [
      "先改善使用后拆洗和晾干的体验。",
      "先研究工作日快速备餐的体验。",
      "还不确定，希望你结合研究再建议。",
    ];
    const fetch = vi.fn(async () =>
      sse(JSON.stringify(modelAnswer({ suggestions }))),
    );
    vi.stubGlobal("fetch", fetch);
    const result = await runResearchIntake(
      task(),
      "attempt",
      brief,
      new AbortController().signal,
    );
    expect(result.suggestions).toEqual(suggestions);
    expect(result.confirmedRequirements).toEqual([utterance]);
    expect(result.reply.match(/[?？]/gu)).toHaveLength(1);
    const [, options] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(options.body));
    expect(body.instructions).toContain("未被用户实际发送前绝不是已确认需求");
    expect(fetch).toHaveBeenCalledTimes(1);

    expect(() =>
      parseIntakeDialogue(
        JSON.stringify(
          modelAnswer({
            suggestions,
            confirmedRequirements: [utterance, suggestions[0]],
          }),
        ),
        [utterance],
      ),
    ).toThrow();
    const chosen = parseIntakeDialogue(
      JSON.stringify(
        modelAnswer({
          ready: true,
          nextQuestion: null,
          suggestions: [],
          confirmedRequirements: [utterance, suggestions[0]],
        }),
      ),
      [utterance, suggestions[0]],
    );
    expect(chosen.confirmedRequirements).toEqual([utterance, suggestions[0]]);
  });

  it.each([
    ["only one option", ["先改善清洗体验。"]],
    ["duplicate options", ["先改善清洗体验。", "先改善清洗体验。"]],
    ["empty option", ["", "先改善清洗体验。"]],
    ["an extra question", ["预算是多少？", "先改善清洗体验。"]],
    ["a hidden questionnaire", ["清洗\n预算", "先改善清洗体验。"]],
    ["too many options", ["一", "二", "三", "四", "五"]],
  ])(
    "rejects %s without inventing replacement choices",
    (_name, suggestions) => {
      expect(() =>
        parseIntakeDialogue(JSON.stringify(modelAnswer({ suggestions })), [
          utterance,
        ]),
      ).toThrow();
    },
  );

  it("allows no useful options and reads the old additive contract, but never displays choices on a ready result", () => {
    expect(
      parseIntakeDialogue(JSON.stringify(modelAnswer({ suggestions: [] })), [
        utterance,
      ]).suggestions,
    ).toEqual([]);
    expect(
      parseIntakeDialogue(JSON.stringify(modelAnswer()), [utterance])
        .suggestions,
    ).toEqual([]);
    expect(() =>
      parseIntakeDialogue(
        JSON.stringify(
          modelAnswer({
            ready: true,
            nextQuestion: null,
            suggestions: ["先改善清洗体验。", "还不确定。"],
          }),
        ),
        [utterance],
      ),
    ).toThrow();
  });

  it("sends the actual conversation, asks one question, and keeps application drafts out of user evidence", async () => {
    const history = [
      { role: "user", content: "最初考虑中国市场。" },
      { role: "assistant", content: "一个待确认建议是预算 299 元。" },
    ];
    const fetch = vi.fn(async () => sse(JSON.stringify(modelAnswer())));
    vi.stubGlobal("fetch", fetch);
    const result = await runResearchIntake(
      task(utterance, history),
      "attempt",
      brief,
      new AbortController().signal,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(String(options.body));
    expect(url).toBe("https://intake.invalid/v1/responses");
    expect(body).toMatchObject({
      model: "synthetic-sol",
      reasoning: { effort: "medium" },
      stream: true,
      store: false,
      tools: [],
    });
    expect(body.text).toBeUndefined(); // No unverified structured-output provider capability is required.
    expect(
      body.input.map(
        (item: { role: string; content: Array<{ text: string }> }) => ({
          role: item.role,
          content: item.content[0].text,
        }),
      ),
    ).toEqual([...history, { role: "user", content: utterance }]);
    expect(body.instructions).toContain("应用草稿与默认设置");
    expect(result.reply.match(/[?？]/gu)).toHaveLength(1);
    expect(result).toMatchObject({
      contractVersion: INTAKE_DIALOGUE_VERSION,
      suggestions: [],
      confirmedRequirements: [utterance],
      ready: false,
    });
    expect(finishResearchCall).toHaveBeenCalledTimes(1);
  });

  it("retains uncertainty and supports a natural-language early start without a mode selection", async () => {
    const answer = "预算和地区我都不知道，先按现有信息研究。";
    const fetch = vi.fn(async () =>
      sse(
        JSON.stringify(
          modelAnswer({
            ready: true,
            nextQuestion: null,
            confirmedRequirements: [utterance],
            unknowns: ["预算未知", "地区未知"],
          }),
        ),
      ),
    );
    vi.stubGlobal("fetch", fetch);
    const result = await runResearchIntake(
      task(answer, [{ role: "user", content: utterance }]),
      "attempt",
      brief,
      new AbortController().signal,
    );
    expect(result.ready).toBe(true);
    expect(result.nextQuestion).toBeNull();
    expect(result.unknowns).toEqual(["预算未知", "地区未知"]);
    expect(result.reply).toBe(result.summary);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps the user's correction and does not combine the obsolete constraint with the new one", async () => {
    const answer = "改成英国市场，不要保留原来的 100 元预算。";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sse(
          JSON.stringify(
            modelAnswer({
              ready: true,
              nextQuestion: null,
              confirmedRequirements: [answer],
              brief: {
                ...modelAnswer().brief,
                market: "英国",
                constraints: "预算尚未确定",
              },
            }),
          ),
        ),
      ),
    );
    const result = await runResearchIntake(
      task(answer, [{ role: "user", content: "中国市场，预算 100 元。" }]),
      "attempt",
      brief,
      new AbortController().signal,
    );
    expect(result.confirmedRequirements).toEqual([answer]);
    expect(result.brief.market).toBe("英国");
  });

  it.each([
    [
      "two questions",
      modelAnswer({ nextQuestion: "目标用户是谁？预算是多少？" }),
    ],
    [
      "assistant suggestion promoted",
      modelAnswer({ confirmedRequirements: ["一个待确认建议是预算 299 元。"] }),
    ],
    ["bad JSON", "not JSON"],
  ])(
    "fails %s after one actual HTTP call without a repair request",
    async (_name, value) => {
      const fetch = vi.fn(async () =>
        sse(typeof value === "string" ? value : JSON.stringify(value)),
      );
      vi.stubGlobal("fetch", fetch);
      await expect(
        runResearchIntake(
          task(utterance, [
            { role: "assistant", content: "一个待确认建议是预算 299 元。" },
          ]),
          "attempt",
          brief,
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ code: "INTAKE_INVALID_RESPONSE" });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it("records a failed SSE once and does not publish or fabricate a completed interview", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          'data: {"type":"response.output_text.delta","delta":"{\\"acknowledgement\\":"}\n\ndata: {"type":"response.failed","response":{"error":{"code":"upstream_error"}}}\n\n',
          { headers: { "Content-Type": "text/event-stream" } },
        ),
    );
    vi.stubGlobal("fetch", fetch);
    await expect(
      runResearchIntake(task(), "attempt", brief, new AbortController().signal),
    ).rejects.toMatchObject({ code: "UPSTREAM_INCOMPLETE" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(finishResearchCall).toHaveBeenCalledWith(
      "call",
      expect.objectContaining({ errorCode: "UPSTREAM_INCOMPLETE" }),
    );
  });

  const failed = (reason = "server_error", partial = "") =>
    new Response(
      `${partial ? `data: ${JSON.stringify({ type: "response.output_text.delta", delta: partial })}\n\n` : ""}data: ${JSON.stringify({ type: "response.failed", response: { error: { code: reason } } })}\n\n`,
      { headers: { "Content-Type": "text/event-stream" } },
    );

  it.each(["server_error", "http_503"])(
    "automatically retries a confirmed empty %s once without creating a new intake turn",
    async (failure) => {
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(
          failure === "server_error"
            ? failed()
            : new Response("unavailable", { status: 503 }),
        )
        .mockResolvedValueOnce(sse(JSON.stringify(modelAnswer())));
      vi.stubGlobal("fetch", fetch);
      const result = await runResearchIntake(
        task(),
        "attempt",
        brief,
        new AbortController().signal,
      );
      expect(result.ready).toBe(false);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(waitForResearchCall).toHaveBeenCalledTimes(2);
      expect(finishResearchCall).toHaveBeenCalledTimes(2);
      expect(researchEvent).toHaveBeenCalledWith(
        "task",
        "call.retry_scheduled",
        expect.objectContaining({
          attemptId: "attempt",
          retry: 1,
          delayMs: 2000,
        }),
        "fixture-token",
      );
      expect(delay).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[0][1].body).toBe(fetch.mock.calls[1][1].body);
      expect(
        vi.mocked(waitForResearchCall).mock.calls.map(([id]) => id),
      ).toEqual(["attempt", "attempt"]);
    },
  );

  it("stops after three recorded calls and two backoffs when the provider keeps failing", async () => {
    const fetch = vi.fn(async () => failed());
    vi.stubGlobal("fetch", fetch);
    await expect(
      runResearchIntake(task(), "attempt", brief, new AbortController().signal),
    ).rejects.toMatchObject({ code: "UPSTREAM_INCOMPLETE" });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(waitForResearchCall).toHaveBeenCalledTimes(3);
    expect(finishResearchCall).toHaveBeenCalledTimes(3);
    expect(vi.mocked(delay).mock.calls.map(([ms]) => ms)).toEqual([2000, 4000]);
  });

  it.each([
    "content_filter",
    "invalid_api_key",
    "max_output_tokens",
    "unknown",
  ])("does not retry %s", async (reason) => {
    const fetch = vi.fn(async () => failed(reason));
    vi.stubGlobal("fetch", fetch);
    await expect(
      runResearchIntake(task(), "attempt", brief, new AbortController().signal),
    ).rejects.toMatchObject({ code: "UPSTREAM_INCOMPLETE" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });

  it("does not retry an explicit server failure after partial answer text", async () => {
    const fetch = vi.fn(async () =>
      failed("server_error", '{"acknowledgement":'),
    );
    vi.stubGlobal("fetch", fetch);
    await expect(
      runResearchIntake(task(), "attempt", brief, new AbortController().signal),
    ).rejects.toMatchObject({ code: "UPSTREAM_INCOMPLETE" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });

  it.each(["network", "eof"])(
    "does not replay an uncertain %s failure",
    async (failure) => {
      const fetch = vi.fn(async () => {
        if (failure === "network") throw new TypeError("connection reset");
        return new Response('data: {"type":"response.created"}\n\n', {
          headers: { "Content-Type": "text/event-stream" },
        });
      });
      vi.stubGlobal("fetch", fetch);
      await expect(
        runResearchIntake(
          task(),
          "attempt",
          brief,
          new AbortController().signal,
        ),
      ).rejects.toThrow();
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(delay).not.toHaveBeenCalled();
    },
  );

  it("respects a legacy one-call limit instead of silently increasing its budget", async () => {
    const legacy = task();
    legacy.plan = { limits: { llm: 1 } };
    vi.mocked(activeResearchAttempt).mockResolvedValueOnce({
      stage: { task: { ...legacy, llmCalls: 1 } },
    } as never);
    const fetch = vi.fn(async () => failed());
    vi.stubGlobal("fetch", fetch);
    await expect(
      runResearchIntake(legacy, "attempt", brief, new AbortController().signal),
    ).rejects.toMatchObject({ code: "UPSTREAM_INCOMPLETE" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });

  it("does not retry when earlier calls or the deadline leave no retry allowance", async () => {
    const fetch = vi.fn(async () => failed());
    vi.stubGlobal("fetch", fetch);
    const used = task();
    used.llmCalls = 2;
    vi.mocked(activeResearchAttempt).mockResolvedValueOnce({
      stage: { task: { ...used, llmCalls: 3 } },
    } as never);
    await expect(
      runResearchIntake(used, "attempt", brief, new AbortController().signal),
    ).rejects.toMatchObject({ code: "UPSTREAM_INCOMPLETE" });
    const expiring = task();
    expiring.deadlineAt = new Date(Date.now() + 1000);
    vi.mocked(activeResearchAttempt).mockResolvedValueOnce({
      stage: { task: expiring },
    } as never);
    await expect(
      runResearchIntake(
        expiring,
        "attempt",
        brief,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "UPSTREAM_INCOMPLETE" });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(delay).not.toHaveBeenCalled();
  });

  it("cancels backoff without sending another model request", async () => {
    const abort = new AbortController();
    vi.mocked(delay).mockImplementationOnce(async () => {
      abort.abort(new Error("cancelled during backoff"));
      abort.signal.throwIfAborted();
    });
    const fetch = vi.fn(async () => failed());
    vi.stubGlobal("fetch", fetch);
    await expect(
      runResearchIntake(task(), "attempt", brief, abort.signal),
    ).rejects.toThrow("cancelled during backoff");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("intake confirmation and receipts", () => {
  it("does not allow quoting a constraint while dropping its user's negation", () => {
    expect(() =>
      parseIntakeDialogue(
        JSON.stringify(
          modelAnswer({
            ready: true,
            nextQuestion: null,
            confirmedRequirements: ["预算 100 元"],
          }),
        ),
        ["不要采用预算 100 元。"],
      ),
    ).toThrow();
    expect(() =>
      parseIntakeDialogue(
        JSON.stringify(modelAnswer()),
        [utterance],
        "prepare_research",
      ),
    ).toThrow();
  });
  it("binds confirmation to user statements and the exact execution brief, including an intentional empty list", () => {
    const result = parseIntakeDialogue(
      JSON.stringify(modelAnswer({ ready: true, nextQuestion: null })),
      [utterance],
    );
    expect(confirmedIntakeRequirements(result, [utterance], brief)).toEqual([
      utterance,
    ]);
    expect(
      confirmedIntakeRequirements(result, [utterance], {
        ...brief,
        market: "invented",
      }),
    ).toBeNull();
    const snapshot = {
      taskId: "accepted",
      contractVersion: INTAKE_DIALOGUE_VERSION,
      brief: result.brief,
      confirmedRequirements: result.confirmedRequirements,
    };
    expect(readIntakeConfirmationRequirements(snapshot, brief)).toEqual([
      utterance,
    ]);
    expect(
      readIntakeConfirmationRequirements(
        { ...snapshot, contractVersion: "legacy-unverified" },
        brief,
      ),
    ).toEqual([]);
    expect(
      readIntakeConfirmationRequirements({ ...snapshot, taskId: null }, brief),
    ).toBeNull();
    expect(
      readIntakeConfirmationRequirements(
        { ...snapshot, brief: { ...result.brief, market: "changed" } },
        brief,
      ),
    ).toBeNull();
  });
  it("accepts thin requests with no form, preserving absent settings and existing complete input compatibility", () => {
    const thin = researchIntakeInputSchema.parse({
      projectId: "project",
      clientRequestId: "11111111-1111-4111-8111-111111111111",
      answer: "茶",
    });
    expect(thin.brief).toBeUndefined();
    expect(thin.modelId).toBeUndefined();
    expect(thin.preset).toBeUndefined();
    expect(thin.intent).toBe("continue");
    expect(
      researchIntakeInputSchema.parse({
        ...thin,
        brief,
        scope: "standard",
        modelId: "gpt-6.1-sol",
      }).brief?.question,
    ).toBe(brief.question);
  });
  it("returns the accepted receipt before loading mutable dialogue on a repeated thin POST", async () => {
    const request = researchIntakeInputSchema.parse({
      projectId: "project",
      clientRequestId: "22222222-2222-4222-8222-222222222222",
      answer: utterance,
    });
    const { createHash } = await import("node:crypto");
    const requestHash = createHash("sha256")
      .update(JSON.stringify(request))
      .digest("hex");
    vi.mocked(db.researchTask.findUnique).mockResolvedValueOnce({
      id: "accepted",
      preset: "intake",
      configSnapshot: { intake: { requestHash } },
    } as never);
    await createResearchIntakeTurn("user", request);
    expect(researchTaskView).toHaveBeenCalledWith("user", "accepted");
    expect(db.researchTask.findMany).not.toHaveBeenCalled();
  });
  it("does not reinterpret a legacy receipt as a new prepare-research action", async () => {
    const request = researchIntakeInputSchema.parse({
      projectId: "project",
      clientRequestId: "33333333-3333-4333-8333-333333333333",
      answer: utterance,
      brief,
      intent: "prepare_research",
    });
    vi.mocked(db.researchTask.findUnique).mockResolvedValueOnce({
      id: "legacy",
      preset: "intake",
      configSnapshot: { intake: { answer: utterance } },
    } as never);
    await expect(
      createResearchIntakeTurn("user", request),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(db.researchTask.findMany).not.toHaveBeenCalled();
  });
  it("does not return an older ready result while the latest correction is queued or failed", async () => {
    const completed = parseIntakeDialogue(
      JSON.stringify(modelAnswer({ ready: true, nextQuestion: null })),
      [utterance],
    );
    for (const status of ["queued", "failed"]) {
      vi.mocked(db.researchTask.findMany).mockResolvedValueOnce([
        {
          id: "old",
          clientRequestId: "11111111-1111-4111-8111-111111111111",
          status: "completed",
          configSnapshot: { intake: { answer: utterance } },
          stages: [{ result: completed }],
        },
        {
          id: "new",
          clientRequestId: "22222222-2222-4222-8222-222222222222",
          status,
          scope: "standard",
          configSnapshot: { intake: { answer: "改成家用" } },
          stages: [{ result: null }],
        },
      ] as never);
      const view = await researchIntakeView("user", "project");
      expect(view.result).toBeNull();
      expect(view.resultTaskId).toBeNull();
      expect(view.latestClientRequestId).toBe(
        "22222222-2222-4222-8222-222222222222",
      );
      expect(view.messages.map((message) => message.content)).toContain(
        completed.reply,
      );
      expect(view.messages.at(-1)?.content).toBe("改成家用");
    }
  });
});

