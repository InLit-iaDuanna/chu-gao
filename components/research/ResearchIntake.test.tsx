import { useState } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResearchPlanInput } from "@/lib/research/types";
import { ResearchIntake } from "./ResearchIntake";
import {
  emptyIntakeView,
  intakeInput,
  intakeView,
} from "./ResearchIntake.fixture";

class TestEventSource {
  static instances: TestEventSource[] = [];
  onmessage: ((event: { data: string }) => void) | null = null;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
  addEventListener = vi.fn();
  constructor(readonly url: string) {
    TestEventSource.instances.push(this);
  }
  send(value: unknown) {
    this.onmessage?.({ data: JSON.stringify(value) });
  }
  raw(value: string) {
    this.onmessage?.({ data: value });
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function installApi(initial = emptyIntakeView()) {
  const state = {
    snapshot: initial,
    get: null as ((url: string) => Promise<Response>) | null,
    post: null as ((body: Record<string, unknown>) => Promise<Response>) | null,
    requests: [] as Array<{
      url: string;
      method: string;
      body?: Record<string, unknown>;
      rawBody?: string;
    }>,
  };
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || "GET";
    const rawBody = typeof init?.body === "string" ? init.body : undefined;
    const body = rawBody ? JSON.parse(rawBody) : undefined;
    state.requests.push({ url, method, body, rawBody });
    if (url.startsWith("/api/research/intake?"))
      return state.get
        ? state.get(url)
        : Response.json({ ok: true, data: state.snapshot });
    if (url === "/api/research/intake" && method === "POST") {
      if (state.post) return state.post(body);
      state.snapshot = intakeView({
        id: "intake-next",
        answer: String(body.answer),
        status: "queued",
        previous: state.snapshot,
      });
      return Response.json({
        ok: true,
        data: { taskId: "intake-next", projectId: "project-1" },
      });
    }
    if (url.endsWith("/cancel") && method === "POST")
      return Response.json({ ok: true, data: {} });
    throw new Error(`Unexpected offline request: ${method} ${url}`);
  });
  vi.stubGlobal("fetch", fetch);
  return state;
}
const postRequests = (api: ReturnType<typeof installApi>) =>
  api.requests.filter(
    (request) =>
      request.method === "POST" && request.url === "/api/research/intake",
  );
function Harness({
  projectId = "project-1",
  onDraft = vi.fn(),
  onUpload = vi.fn(),
  ensureProject = async () => projectId,
  initialInput = intakeInput(),
}: {
  projectId?: string;
  onDraft?: ReturnType<typeof vi.fn>;
  onUpload?: ReturnType<typeof vi.fn>;
  ensureProject?: () => Promise<string>;
  initialInput?: ResearchPlanInput;
}) {
  const [input, setInput] = useState(initialInput);
  const [ready, setReady] = useState(false);
  return (
    <>
      <ResearchIntake
        projectId={projectId}
        input={input}
        ensureProject={ensureProject}
        onDraft={(brief, approved, products, settings, confirmedTaskId) => {
          onDraft(brief, approved, products, settings, confirmedTaskId);
          setInput((previous) => ({
            ...previous,
            ...settings,
            brief,
            products,
          }));
          setReady(approved);
        }}
        onUpload={onUpload}
        disabled={false}
      />
      <button disabled={!ready}>开始研究</button>
    </>
  );
}
async function submit(text: string) {
  fireEvent.change(
    screen.getByRole("textbox", { name: "告诉研究助手你的想法" }),
    { target: { value: text } },
  );
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "发送回答" }));
  });
}
beforeEach(() => {
  TestEventSource.instances = [];
  window.sessionStorage.clear();
  vi.stubGlobal("EventSource", TestEventSource);
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false })),
  );
  window.history.replaceState(null, "", "/app/research?project=project-1");
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("research intake: real API conversation contract", () => {
  const suggestions = [
    "先比较通勤时单手拿取和重新盖紧的体验。",
    "先研究货架辨识度和包装视觉方向。",
    "还不确定，希望你结合研究再建议。",
  ];

  it("offers optional model answers for the latest question and submits a double click only once as ordinary user text", async () => {
    const first = intakeView({ suggestions });
    const api = installApi(first);
    const response = deferred<Response>();
    api.post = async () => response.promise;
    await act(async () => render(<Harness />));
    const group = screen.getByRole("group", { name: "建议回答" });
    expect(within(group).getAllByRole("button")).toHaveLength(3);
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    const choice = within(group).getByRole("button", { name: suggestions[0] });
    await act(async () => {
      fireEvent.click(choice);
      fireEvent.click(choice);
    });
    expect(postRequests(api)).toHaveLength(1);
    expect(postRequests(api)[0].body).toMatchObject({
      answer: suggestions[0],
      previousTaskId: first.task!.id,
    });
    expect(postRequests(api)[0].body).not.toHaveProperty("selectedOption");
    expect(postRequests(api)[0].body).not.toHaveProperty("suggestions");
    expect(screen.getAllByText(suggestions[0])).toHaveLength(1);
    expect(
      screen.queryByRole("group", { name: "建议回答" }),
    ).not.toBeInTheDocument();
    api.snapshot = intakeView({
      id: "chosen-answer",
      status: "queued",
      answer: suggestions[0],
      previous: first,
    });
    const readResponse = deferred<Response>();
    api.get = async () => readResponse.promise;
    await act(async () => {
      response.resolve(
        Response.json({
          ok: true,
          data: { taskId: "chosen-answer", projectId: "project-1" },
        }),
      );
    });
    // POST acceptance is durable even while the first confirming GET is slow.
    // Typing ahead/Enter must not turn into a second intake request.
    const editor = screen.getByRole("textbox", {
      name: "告诉研究助手你的想法",
    });
    fireEvent.change(editor, { target: { value: "另外也关注防漏。" } });
    await act(async () => fireEvent.keyDown(editor, { key: "Enter" }));
    expect(postRequests(api)).toHaveLength(1);
    await act(async () => {
      readResponse.resolve(Response.json({ ok: true, data: api.snapshot }));
    });
    expect(screen.getAllByText(suggestions[0])).toHaveLength(1);
    expect(editor).toHaveValue("另外也关注防漏。");
    expect(postRequests(api)).toHaveLength(1);
  });

  it("keeps free text primary and never overwrites an in-progress answer with a stale option click", async () => {
    const api = installApi(intakeView({ suggestions }));
    await act(async () => render(<Harness />));
    const oldChoice = screen.getByRole("button", { name: suggestions[1] });
    const editor = screen.getByRole("textbox", {
      name: "告诉研究助手你的想法",
    });
    const custom = "两个方向都要，但先排除玻璃包装。";
    fireEvent.change(editor, { target: { value: custom } });
    expect(
      screen.queryByRole("group", { name: "建议回答" }),
    ).not.toBeInTheDocument();
    fireEvent.click(oldChoice);
    expect(editor).toHaveValue(custom);
    expect(postRequests(api)).toHaveLength(0);
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "发送回答" })),
    );
    expect(postRequests(api)[0].body?.answer).toBe(custom);
  });

  it.each(["queued", "running", "failed", "interrupted"])(
    "does not revive an older question's suggestions while the current turn is %s",
    async (status) => {
      const previous = intakeView({ suggestions });
      const current = intakeView({ id: "newer", previous, status });
      installApi(current);
      await act(async () => render(<Harness />));
      expect(
        screen.queryByRole("group", { name: "建议回答" }),
      ).not.toBeInTheDocument();
    },
  );

  it("does not show suggestions on a ready summary even if old stored data contains them", async () => {
    installApi(intakeView({ suggestions, ready: true }));
    await act(async () => render(<Harness />));
    expect(
      screen.queryByRole("group", { name: "建议回答" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开始研究" })).toBeEnabled();
  });

  it("recovers a lost choice submission using its identical request receipt", async () => {
    const first = intakeView({ suggestions });
    const api = installApi(first);
    api.post = async () => {
      throw new TypeError("choice response lost");
    };
    await act(async () => render(<Harness />));
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: suggestions[2] })),
    );
    const firstBody = postRequests(api)[0].rawBody;
    expect(postRequests(api)).toHaveLength(1);
    expect(
      screen.queryByRole("group", { name: "建议回答" }),
    ).not.toBeInTheDocument();
    api.post = async (body) => {
      api.snapshot = intakeView({
        id: "recovered-choice",
        answer: String(body.answer),
        previous: first,
        ready: true,
        reply: "按现有信息先研究，具体方向保留未知。",
        summary: "按现有信息先研究，具体方向保留未知。",
      });
      return Response.json({
        ok: true,
        data: { taskId: "recovered-choice", projectId: "project-1" },
      });
    };
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "重试发送" })),
    );
    expect(postRequests(api)).toHaveLength(2);
    expect(postRequests(api)[1].rawBody).toBe(firstBody);
    expect(screen.getAllByText(suggestions[2])).toHaveLength(1);
    expect(screen.getByRole("button", { name: "开始研究" })).toBeEnabled();
  });

  it("reads another tab's accepted question after a stale choice conflict without automatically reposting the answer", async () => {
    const first = intakeView({ suggestions });
    const api = installApi(first);
    api.post = async () => {
      api.snapshot = intakeView({
        id: "other-tab",
        previous: first,
        answer: "先研究货架辨识度。",
        reply: "我会先看货架辨识。主要考虑哪个市场？",
        suggestions: ["先研究美国市场。", "先研究中国市场。"],
      });
      return Response.json(
        {
          ok: false,
          error: { code: "INTAKE_CHANGED", message: "对话已有新回复" },
        },
        { status: 409 },
      );
    };
    await act(async () => render(<Harness />));
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: suggestions[0] })),
    );
    expect(postRequests(api)).toHaveLength(1);
    expect(postRequests(api)[0].body?.previousTaskId).toBe(first.task!.id);
    expect(
      screen.getByRole("textbox", { name: "告诉研究助手你的想法" }),
    ).toHaveValue(suggestions[0]);
    expect(
      screen.getByText("我会先看货架辨识。主要考虑哪个市场？"),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("已在其他页面更新");
    expect(
      screen.queryByRole("group", { name: "建议回答" }),
    ).not.toBeInTheDocument();
  });

  it("starts with one free-text input and optional references, without a questionnaire or default suggestion choices", async () => {
    installApi();
    const onUpload = vi.fn();
    await act(async () => {
      render(<Harness onUpload={onUpload} />);
    });
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: "建议回答" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("这次想研究什么？直接说说你的想法就好。"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "添加参考资料（可选）" }),
    );
    expect(onUpload).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "开始研究" })).toBeDisabled();
  });

  it("sends the user's exact answer, then shows the persisted model question without simulating a reply while queued", async () => {
    const api = installApi();
    await act(async () => {
      render(<Harness />);
    });
    const answer = "我想比较饮料包装，重点是拿取和重新盖紧。";
    await submit(answer);
    expect(postRequests(api)).toHaveLength(1);
    expect(postRequests(api)[0].body).toMatchObject({
      answer,
      previousTaskId: null,
      projectId: "project-1",
    });
    expect(screen.getAllByText(answer)).toHaveLength(1);
    expect(screen.getByText("需求对话排队中…")).toBeInTheDocument();
    expect(
      screen.queryByText("目前的拿取情境是什么？"),
    ).not.toBeInTheDocument();
    api.snapshot = intakeView({
      id: "intake-next",
      answer,
      reply: "我会比较拿取与盖紧。主要发生在哪种使用情境？",
    });
    await act(async () => {
      TestEventSource.instances.at(-1)?.send({ type: "task.completed" });
    });
    expect(
      screen.getByText("我会比较拿取与盖紧。主要发生在哪种使用情境？"),
    ).toBeInTheDocument();
    expect(screen.getAllByText(answer)).toHaveLength(1);
    expect(screen.getByRole("button", { name: "开始研究" })).toBeDisabled();
  });

  it("accumulates the server brief and retains optional references in the next natural-language turn", async () => {
    const first = intakeView({ market: "国内", answer: "先看国内市场。" });
    const api = installApi(first);
    const input = intakeInput();
    input.brief.attachmentKeys = ["user-reference.pdf"];
    input.brief.sourceImageIds = ["reference-image-1"];
    await act(async () => {
      render(<Harness initialInput={input} />);
    });
    await submit("主要是在通勤时单手拿取。不要推荐玻璃。");
    const sent = postRequests(api)[0].body!;
    expect(sent.previousTaskId).toBe("intake-1");
    expect(sent.answer).toBe("主要是在通勤时单手拿取。不要推荐玻璃。");
    expect(sent.brief).toMatchObject({
      market: "国内",
      attachmentKeys: ["user-reference.pdf"],
      sourceImageIds: ["reference-image-1"],
    });
  });

  it("shows a short ready summary and unknowns, and revokes approval immediately when a correction is typed", async () => {
    const api = installApi(
      intakeView({
        ready: true,
        reply: "已按你的想法整理好研究方向。",
        summary: "比较国内饮料包装的单手拿取与盖紧体验。",
        market: "国内",
        unknowns: ["使用频次还未确定"],
      }),
    );
    const onDraft = vi.fn();
    const pendingProject = deferred<string>();
    await act(async () => {
      render(
        <Harness
          onDraft={onDraft}
          ensureProject={() => pendingProject.promise}
        />,
      );
    });
    expect(screen.getByRole("button", { name: "开始研究" })).toBeEnabled();
    expect(
      screen.getByRole("region", { name: "已理解的研究需求" }),
    ).toHaveTextContent("使用频次还未确定");
    expect(onDraft.mock.calls.at(-1)?.[4]).toBe("intake-1");
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "改成日本市场，保留单手操作的目标。" },
    });
    expect(screen.getByRole("button", { name: "开始研究" })).toBeDisabled();
    expect(onDraft.mock.calls.at(-1)?.[1]).toBe(false);
    expect(onDraft.mock.calls.at(-1)?.[4]).toBeUndefined();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "发送回答" }));
    });
    expect(postRequests(api)).toHaveLength(0);
    await act(async () => {
      pendingProject.resolve("project-1");
    });
    expect(postRequests(api)[0].body?.answer).toBe(
      "改成日本市场，保留单手操作的目标。",
    );
    const previous = intakeView({ market: "国内" });
    api.snapshot = intakeView({
      id: "intake-next",
      previous,
      answer: "改成日本市场，保留单手操作的目标。",
      market: "日本",
      ready: true,
      summary: "比较日本市场包装的单手操作体验。",
      reply: "已把市场改为日本。",
    });
    await act(async () => {
      TestEventSource.instances.at(-1)?.send({ type: "task.completed" });
    });
    expect(screen.getByRole("button", { name: "开始研究" })).toBeEnabled();
    expect(onDraft.mock.calls.at(-1)?.[0].market).toBe("日本");
    expect(onDraft.mock.calls.at(-1)?.[4]).toBe("intake-next");
  });

  it("passes uncertainty and a request to begin through the LLM API without forcing a mode or material selection", async () => {
    const api = installApi(intakeView());
    await act(async () => {
      render(<Harness />);
    });
    await submit("我还不确定，先按已知内容研究，其余留作待验证。");
    expect(postRequests(api)[0].body?.answer).toBe(
      "我还不确定，先按已知内容研究，其余留作待验证。",
    );
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByText("先按这些生成计划")).not.toBeInTheDocument();
  });

  it("does not reapprove a previous result when the latest intake failed", async () => {
    const previous = intakeView({ ready: true, summary: "旧研究方向。" });
    const api = installApi(
      intakeView({
        id: "failed-edit",
        previous,
        status: "failed",
        answer: "请换一个目标市场。",
      }),
    );
    const onDraft = vi.fn();
    await act(async () => {
      render(<Harness onDraft={onDraft} />);
    });
    expect(screen.getByRole("button", { name: "开始研究" })).toBeDisabled();
    expect(
      screen.queryByRole("region", { name: "已理解的研究需求" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("整理暂时失败");
    expect(onDraft.mock.calls.at(-1)?.[1]).toBe(false);
    expect(postRequests(api)).toHaveLength(0);
  });

  it("describes an incomplete intake reply without claiming any research results were saved", async () => {
    const snapshot = intakeView({ status: "failed", answer: "轻食机" });
    snapshot.task!.error = {
      code: "UPSTREAM_INCOMPLETE",
      message: "模型响应未完成，已有阶段结果已保留",
    };
    snapshot.result = null;
    snapshot.resultTaskId = null;
    const api = installApi(snapshot);
    await act(async () => render(<Harness />));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "模型服务未能完成这次回复，你的回答已保存。",
    );
    expect(screen.queryByText(/已有阶段结果已保留/)).not.toBeInTheDocument();
    expect(screen.getByText("轻食机")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "重新整理这条回答" }),
    ).toBeEnabled();
    expect(screen.getByRole("button", { name: "开始研究" })).toBeDisabled();
    expect(postRequests(api)).toHaveLength(0);
  });

  it("shows server-side automatic retry progress on the same task without another submission", async () => {
    const snapshot = intakeView({ status: "running", answer: "轻食机" });
    const api = installApi(snapshot);
    await act(async () => render(<Harness />));
    api.snapshot = {
      ...snapshot,
      task: {
        ...snapshot.task!,
        llmCalls: 2,
        nextSeq: snapshot.task!.nextSeq + 1,
      },
    };
    await act(async () => {
      TestEventSource.instances.at(-1)?.send({ type: "call.started" });
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "正在自动重试回复（1/2）…",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(postRequests(api)).toHaveLength(0);

    api.snapshot = intakeView({ status: "failed", answer: "轻食机" });
    api.snapshot.task!.llmCalls = 3;
    api.snapshot.task!.nextSeq = snapshot.task!.nextSeq + 2;
    api.snapshot.task!.error = {
      code: "UPSTREAM_INCOMPLETE",
      message: "模型响应未完成，已有阶段结果已保留",
    };
    await act(async () => {
      TestEventSource.instances.at(-1)?.send({ type: "task.failed" });
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "自动重试 2 次后仍未完成回复，你的回答已保存。",
    );
    expect(postRequests(api)).toHaveLength(0);
  });

  it.each(["failed", "cancelled"])(
    "preserves selected products after a %s intake and can submit another answer",
    async (status) => {
      const snapshot = intakeView({ status });
      snapshot.task!.plan.products = [];
      const api = installApi(snapshot);
      const initialInput = intakeInput();
      initialInput.products = ["report", "pptx"];
      await act(async () => {
        render(<Harness initialInput={initialInput} />);
      });
      await submit("先按目前的信息研究，保留演示稿。");
      expect(postRequests(api)[0].body?.products).toEqual(["report", "pptx"]);
    },
  );

  it("restores selected products from a pending turn without using its empty execution products", async () => {
    const snapshot = intakeView({ status: "queued" });
    snapshot.task!.plan.products = [];
    snapshot.settings = {
      preset: "proposal",
      scope: "standard",
      modelId: "gpt-6.1-sol",
      reasoningEffort: "medium",
      collectVisuals: true,
      verify: true,
      products: ["docx"],
    };
    installApi(snapshot);
    const onDraft = vi.fn();
    await act(async () => {
      render(<Harness onDraft={onDraft} />);
    });
    expect(onDraft.mock.calls.at(-1)?.[2]).toEqual(["docx"]);
  });

  it("only resubmits a failed answer after an explicit action, as one new durable intake turn", async () => {
    const snapshot = intakeView({
      status: "failed",
      answer: "暂不确定，先按现有信息整理。",
    });
    snapshot.task!.plan.products = [];
    const api = installApi(snapshot);
    await act(async () => render(<Harness />));
    expect(postRequests(api)).toHaveLength(0);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "重新整理这条回答" }));
    });
    expect(postRequests(api)).toHaveLength(1);
    expect(postRequests(api)[0].body?.answer).toBe(
      "暂不确定，先按现有信息整理。",
    );
    expect(postRequests(api)[0].body?.previousTaskId).toBe(snapshot.task!.id);
    expect(postRequests(api)[0].body?.clientRequestId).toEqual(
      expect.any(String),
    );
  });

  it("reuses the identical receipt after a lost POST response and never automatically repeats the model request", async () => {
    const api = installApi();
    let postCount = 0;
    api.post = async (body) => {
      postCount++;
      api.snapshot = intakeView({
        id: "accepted-once",
        status: "queued",
        answer: String(body.answer),
      });
      if (postCount === 1) throw new TypeError("连接中断，发送状态未知");
      return Response.json({
        ok: true,
        data: { taskId: "accepted-once", projectId: "project-1" },
      });
    };
    await act(async () => {
      render(<Harness />);
    });
    await submit("比较软包装的便携体验。");
    expect(postRequests(api)).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent("发送状态未知");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "重试发送" }));
    });
    expect(postRequests(api)).toHaveLength(2);
    expect(postRequests(api)[1].rawBody).toBe(postRequests(api)[0].rawBody);
    expect(screen.getAllByText("比较软包装的便携体验。")).toHaveLength(1);
    expect(
      screen.queryByRole("button", { name: "重试发送" }),
    ).not.toBeInTheDocument();
  });

  it("recovers a lost POST response by reading its server-bound request identity without submitting it again", async () => {
    const api = installApi();
    api.post = async (body) => {
      api.snapshot = intakeView({
        id: "saved-after-drop",
        clientRequestId: String(body.clientRequestId),
        answer: String(body.answer),
        ready: true,
        reply: "可以开始研究。",
        summary: "围绕便携包装开展研究。",
      });
      throw new TypeError("网络暂时中断");
    };
    await act(async () => {
      render(<Harness />);
    });
    await submit("按现有信息开始研究。");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "重新读取对话" }));
    });
    expect(postRequests(api)).toHaveLength(1);
    expect(screen.getByRole("button", { name: "开始研究" })).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "重试发送" }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText("按现有信息开始研究。")).toHaveLength(1);
  });

  it.each([undefined, "00000000-0000-4000-8000-000000000002"])(
    "does not claim another tab's identical answer when the latest request identity is %s",
    async (clientRequestId) => {
      const api = installApi();
      api.post = async (body) => {
        // The other tab used the same sentence but different full input.
        api.snapshot = intakeView({
          id: "other-tab-task",
          clientRequestId,
          answer: String(body.answer),
          market: "另一标签的市场",
          ready: true,
        });
        api.snapshot.task!.brief.attachmentKeys = ["other-tab-reference.md"];
        if (clientRequestId === undefined)
          delete api.snapshot.latestClientRequestId;
        throw new TypeError("本次发送结果未知");
      };
      await act(async () => {
        render(<Harness />);
      });
      await submit("按现有信息开始研究。");
      const savedReceipt = window.sessionStorage.getItem(
        "chugao.research.intake.pending.v1:project-1",
      );
      expect(savedReceipt).not.toBeNull();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "重新读取对话" }));
      });
      expect(postRequests(api)).toHaveLength(1);
      expect(screen.getByRole("button", { name: "开始研究" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "重试发送" })).toBeEnabled();
      expect(
        window.sessionStorage.getItem(
          "chugao.research.intake.pending.v1:project-1",
        ),
      ).toBe(savedReceipt);
    },
  );

  it("keeps an acknowledged task active when its first GET fails, then performs only GET recovery", async () => {
    const api = installApi();
    let failReads = false;
    api.post = async (body) => {
      failReads = true;
      api.snapshot = intakeView({
        id: "accepted-read-failed",
        answer: String(body.answer),
        status: "queued",
      });
      return Response.json({
        ok: true,
        data: { taskId: "accepted-read-failed", projectId: "project-1" },
      });
    };
    api.get = async () => {
      if (failReads) throw new TypeError("读取暂时失败");
      return Response.json({ ok: true, data: api.snapshot });
    };
    await act(async () => {
      render(<Harness />);
    });
    await submit("研究通勤时的包装体验。");
    expect(screen.getByRole("button", { name: "开始研究" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "停止整理" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "重试发送" }),
    ).not.toBeInTheDocument();
    failReads = false;
    api.snapshot = intakeView({
      id: "accepted-read-failed",
      ready: true,
      reply: "已整理好研究方向。",
      summary: "比较通勤时的包装体验。",
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "重新读取对话" }));
    });
    expect(postRequests(api)).toHaveLength(1);
    expect(screen.getByRole("button", { name: "开始研究" })).toBeEnabled();
  });

  it("ignores an old project GET even if the transport disregards AbortSignal", async () => {
    const api = installApi();
    const oldRead = deferred<Response>();
    api.get = async (url) =>
      url.includes("project-1")
        ? oldRead.promise
        : Response.json({
            ok: true,
            data: intakeView({
              id: "other-task",
              projectId: "project-2",
              reply: "新项目的问题是什么？",
              market: "新项目市场",
            }),
          });
    const onDraft = vi.fn();
    const mounted = render(<Harness projectId="project-1" onDraft={onDraft} />);
    await act(async () => {
      mounted.rerender(<Harness projectId="project-2" onDraft={onDraft} />);
    });
    expect(screen.getByText("新项目的问题是什么？")).toBeInTheDocument();
    await act(async () => {
      oldRead.resolve(
        Response.json({
          ok: true,
          data: intakeView({
            reply: "旧项目的问题是什么？",
            market: "旧项目市场",
          }),
        }),
      );
    });
    expect(screen.queryByText("旧项目的问题是什么？")).not.toBeInTheDocument();
    expect(
      onDraft.mock.calls.some((call) => call[0].market === "旧项目市场"),
    ).toBe(false);
    expect(window.location.search).toBe("?project=project-1"); // Reads never rewrite navigation.
  });

  it("drops a pending send when project selection changes before ensureProject resolves", async () => {
    installApi();
    const oldProject = deferred<string>();
    const onDraft = vi.fn();
    const mounted = render(
      <Harness
        projectId="project-1"
        ensureProject={() => oldProject.promise}
        onDraft={onDraft}
      />,
    );
    await waitFor(() =>
      expect(screen.queryByText("正在恢复需求对话")).not.toBeInTheDocument(),
    );
    await submit("旧项目的尚未发送需求。");
    await act(async () => {
      mounted.rerender(
        <Harness
          projectId="project-2"
          ensureProject={async () => "project-2"}
          onDraft={onDraft}
        />,
      );
    });
    window.history.replaceState(null, "", "/app/research?project=project-2");
    await act(async () => {
      oldProject.resolve("project-1");
    });
    expect(
      vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(0);
    expect(window.location.search).toBe("?project=project-2");
    expect(
      screen.queryByText("旧项目的尚未发送需求。"),
    ).not.toBeInTheDocument();
  });

  it("recovers malformed SSE via GET and respects composition/Shift+Enter without issuing a model request", async () => {
    const api = installApi(intakeView({ status: "running" }));
    await act(async () => {
      render(<Harness />);
    });
    const reads = api.requests.length;
    await act(async () => {
      TestEventSource.instances.at(-1)?.raw("not-json");
    });
    expect(api.requests.length).toBeGreaterThan(reads);
    expect(postRequests(api)).toHaveLength(0);
    api.snapshot = intakeView();
    await act(async () => {
      TestEventSource.instances.at(-1)?.send({ type: "task.completed" });
    });
    const editor = screen.getByRole("textbox");
    fireEvent.change(editor, { target: { value: "输入法正在组合" } });
    fireEvent.keyDown(editor, { key: "Enter", isComposing: true });
    fireEvent.keyDown(editor, { key: "Enter", shiftKey: true });
    expect(postRequests(api)).toHaveLength(0);
    expect(
      within(screen.getByRole("log")).getAllByText(api.snapshot.result!.reply),
    ).toHaveLength(1);
  });

  it("restores an unconfirmed receipt across reload and blocks an older ready result until the same submission is resolved", async () => {
    const previous = intakeView({
      ready: true,
      reply: "旧方向已整理。",
      summary: "旧的研究方向。",
    });
    const api = installApi(previous);
    api.post = async () => {
      throw new TypeError("POST response lost before its task is visible");
    };
    let mounted = render(<Harness />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "开始研究" })).toBeEnabled(),
    );
    await submit("把研究目标改为夜间便携。");
    const firstBody = postRequests(api)[0].rawBody;
    mounted.unmount();
    await act(async () => {
      mounted = render(<Harness />);
    });
    expect(screen.getByRole("button", { name: "开始研究" })).toBeDisabled();
    expect(
      screen.queryByRole("region", { name: "已理解的研究需求" }),
    ).not.toBeInTheDocument();
    expect(postRequests(api)).toHaveLength(1);
    api.post = async (body) => {
      api.snapshot = intakeView({
        id: "recovered-edit",
        previous,
        answer: String(body.answer),
        ready: true,
        reply: "研究夜间便携包装。",
        summary: "研究夜间便携包装。",
      });
      return Response.json({
        ok: true,
        data: { taskId: "recovered-edit", projectId: "project-1" },
      });
    };
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "重试发送" }));
    });
    expect(postRequests(api)[1].rawBody).toBe(firstBody);
    expect(screen.getByRole("button", { name: "开始研究" })).toBeEnabled();
    expect(screen.getAllByText("研究夜间便携包装。")).toHaveLength(1);
    expect(
      window.sessionStorage.getItem(
        "chugao.research.intake.pending.v1:project-1",
      ),
    ).toBeNull();
    mounted.unmount();
  });

  it("does one more GET when a terminal event arrives during an in-flight snapshot read", async () => {
    const running = intakeView({ status: "running" });
    const api = installApi(running);
    const delayed = deferred<Response>();
    let reads = 0;
    api.get = async () => {
      reads++;
      if (reads === 2) return delayed.promise;
      return Response.json({
        ok: true,
        data:
          reads === 1
            ? running
            : intakeView({
                ready: true,
                reply: "可以研究。",
                summary: "可以研究。",
              }),
      });
    };
    await act(async () => {
      render(<Harness />);
    });
    expect(reads).toBe(2);
    await act(async () => {
      TestEventSource.instances.at(-1)?.send({ type: "task.completed" });
    });
    expect(reads).toBe(2);
    await act(async () => {
      delayed.resolve(Response.json({ ok: true, data: running }));
    });
    expect(reads).toBeGreaterThanOrEqual(3);
    expect(screen.getByRole("button", { name: "开始研究" })).toBeEnabled();
    expect(postRequests(api)).toHaveLength(0);
  });

  it("surfaces the existing authentication error and does not fall back to synthetic assistant answers", async () => {
    const api = installApi();
    api.get = async () =>
      Response.json(
        { ok: false, error: { message: "请先登录" } },
        { status: 401 },
      );
    await act(async () => {
      render(<Harness />);
    });
    expect(screen.getByRole("alert")).toHaveTextContent("请先登录");
    expect(postRequests(api)).toHaveLength(0);
    expect(document.querySelectorAll('[data-role="assistant"]')).toHaveLength(
      0,
    );
  });
});

