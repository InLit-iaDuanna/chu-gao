import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResearchTaskView } from "@/lib/research/types";
import { ResearchWorkspace } from "./ResearchWorkspace";
import { task, decisionTask } from "./ResearchWorkspace.fixture";

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
}

function installApi(snapshot: ResearchTaskView | (() => ResearchTaskView)) {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/research/tasks/task-1/retry" && init?.method === "POST")
        return Response.json({ ok: true, data: {} });
      if (url === "/api/research/files/file-1")
        return new Response(
          `<!doctype html><html><head>
          <meta http-equiv="refresh" content="0; url=https://example.com/redirect">
          <meta http-equiv="Content-Security-Policy" content="default-src * 'unsafe-inline'">
          <base href="https://example.com/">
          <style>h1 { color: #123456; }</style>
          <script>window.unsafeHead = true</script>
        </head><body onload="alert('body')">
          <h1 onclick="alert('heading')">资料归档</h1>
          <a href="javascript:alert('link')" onmouseover="alert('hover')">资料链接</a>
          <a href="#source">定位资料</a><section id="source">证据记录</section>
          <img alt="留档图" src="data:image/png;base64,AA==" onerror="alert('image')">
          <iframe src="https://example.com/frame"></iframe>
          <object data="https://example.com/object"></object>
          <embed src="https://example.com/embed">
          <form action="https://example.com/form"><input name="secret"></form>
          <script>fetch("https://example.com/network")</script>
        </body></html>`,
          { headers: { "Content-Type": "text/html" } },
        );
      const current = typeof snapshot === "function" ? snapshot() : snapshot;
      const data =
        url === "/api/research/projects"
          ? []
          : url === "/api/admin/research"
            ? { ready: true, workerReady: true, modelReady: true, services: [] }
            : url === "/api/conversations/chat"
              ? { models: [] }
              : url === "/api/research/tasks/task-1?meta=1"
                ? {
                    id: current.id,
                    status: current.status,
                    nextSeq: current.nextSeq,
                  }
                : url === "/api/research/tasks/task-1"
                  ? current
                  : null;
      if (!data) throw new Error(`Unexpected test request: ${url}`);
      return Response.json({ ok: true, data });
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-18T16:00:00.000Z"));
  TestEventSource.instances = [];
  vi.stubGlobal("EventSource", TestEventSource);
  window.history.replaceState(null, "", "/app/research?task=task-1");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.getSelection()?.removeAllRanges();
});

describe("research workspace quality and waiting feedback", () => {
  it("allows server-validated saved synthesis publication at the call ceiling", async () => {
    const snapshot = task();
    snapshot.status = "failed";
    snapshot.llmCalls = snapshot.plan.limits.llm;
    snapshot.stages[0] = {
      ...snapshot.stages[0],
      status: "failed",
      savedSynthesisComplete: true,
    };
    const fetchMock = installApi(snapshot);
    await act(async () => {
      render(<ResearchWorkspace />);
    });
    const resume = screen.getByRole("button", { name: "继续研究" });
    expect(resume).toBeEnabled();
    expect(
      screen.getByText(/成文结果已保存，可以继续发布/),
    ).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(resume);
    });
    const retries = fetchMock.mock.calls.filter(
      ([url, init]) =>
        String(url) === "/api/research/tasks/task-1/retry" &&
        init?.method === "POST",
    );
    expect(retries).toHaveLength(1);
    expect(JSON.parse(String(retries[0][1]?.body))).toMatchObject({
      stageId: "stage-1",
      renewTime: true,
      clientRequestId: expect.any(String),
    });
  });

  it.each([
    { saved: undefined, kind: "synthesize", expired: false },
    { saved: false, kind: "synthesize", expired: false },
    { saved: true, kind: "research", expired: false },
    { saved: true, kind: "synthesize", expired: true },
  ])(
    "does not waive the call ceiling without an available validated synthesis: %j",
    async ({ saved, kind, expired }) => {
      const snapshot = task();
      snapshot.status = "failed";
      snapshot.llmCalls = snapshot.plan.limits.llm;
      snapshot.expiresAt = expired ? "2026-10-18T15:59:00.000Z" : null;
      snapshot.stages[0] = {
        ...snapshot.stages[0],
        kind,
        status: "failed",
        savedSynthesisComplete: saved,
        result: { synthesisCheckpoint: { metadata: { unchecked: true } } },
      };
      const fetchMock = installApi(snapshot);
      await act(async () => {
        render(<ResearchWorkspace />);
      });
      const resume = screen.getByRole("button", { name: "继续研究" });
      expect(resume).toBeDisabled();
      fireEvent.click(resume);
      expect(
        fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/retry")),
      ).toEqual([]);
    },
  );

  it("keeps synthesis phase feedback through generic calls and restores it from a reconnect snapshot", async () => {
    let snapshot = task();
    snapshot.status = "running";
    snapshot.finishedAt = null;
    snapshot.stages[0] = {
      ...snapshot.stages[0],
      status: "running",
      text: "",
      result: { synthesisPhase: "report" },
    };
    installApi(() => snapshot);
    await act(async () => {
      render(<ResearchWorkspace />);
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "研究材料已整理，正在编写完整报告",
    );
    const source = TestEventSource.instances.at(-1)!;
    await act(async () => {
      source.onopen?.();
      source.send({ seq: 11, type: "call.started", payload: { kind: "llm" } });
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "研究材料已整理，正在编写完整报告",
    );
    await act(async () => {
      source.send({
        seq: 12,
        type: "stage.activity",
        payload: {
          stageId: "stage-1",
          attemptId: "attempt-1",
          phase: "metadata",
          message: "报告已成文，正在整理摘要与交付内容",
        },
      });
      source.send({ seq: 13, type: "call.started", payload: { kind: "llm" } });
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "报告已成文，正在整理摘要与交付内容",
    );
    snapshot = {
      ...snapshot,
      nextSeq: 14,
      llmCalls: snapshot.llmCalls + 2,
      stages: [
        { ...snapshot.stages[0], result: { synthesisPhase: "metadata" } },
      ],
    };
    await act(async () => {
      source.onerror?.();
    });
    expect(screen.getByRole("status")).toHaveTextContent("订阅正在重连");
    await act(async () => {
      source.onopen?.();
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "报告已成文，正在整理摘要与交付内容",
    );
    await act(async () => {
      source.send({
        seq: 15,
        type: "stage.activity",
        payload: {
          stageId: "stage-1",
          attemptId: "old-attempt",
          phase: "draft",
          message: "旧尝试迟到的草稿活动",
        },
      });
    });
    expect(screen.queryByText("旧尝试迟到的草稿活动")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "报告已成文，正在整理摘要与交付内容",
    );
  });

  it("detects a resumed failed task without a browser reload and reconnects progress", async () => {
    let snapshot: ResearchTaskView = {
      ...task(),
      status: "failed",
      nextSeq: 10,
      stages: task().stages.map((stage) => ({ ...stage, status: "failed" })),
    };
    const fetchMock = installApi(() => snapshot);
    await act(async () => {
      render(<ResearchWorkspace />);
    });
    expect(
      screen.getByRole("button", { name: "继续研究" }),
    ).toBeInTheDocument();
    const source = TestEventSource.instances.at(-1)!;
    await act(async () => {
      source.send({
        seq: 11,
        type: "task.failed",
        payload: { code: "MODEL_CALL_TIMEOUT", message: "上一次调用超时" },
      });
      snapshot = { ...snapshot, nextSeq: 11 };
      const terminal = source.addEventListener.mock.calls.find(
        ([type]) => type === "terminal",
      )?.[1];
      terminal?.();
    });
    const fullReads = () =>
      fetchMock.mock.calls.filter(
        ([url]) => String(url) === "/api/research/tasks/task-1",
      ).length;
    const unchanged = fullReads();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(fullReads()).toBe(unchanged);
    snapshot = {
      ...snapshot,
      status: "running",
      nextSeq: 12,
      finishedAt: null,
      stages: snapshot.stages.map((stage) => ({
        ...stage,
        status: "running",
        activeAttemptId: "attempt-2",
        text: "",
      })),
    };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(fullReads()).toBe(unchanged + 1);
    expect(
      screen.queryByRole("button", { name: "继续研究" }),
    ).not.toBeInTheDocument();
    expect(TestEventSource.instances.at(-1)).not.toBe(source);
    expect(source.close).toHaveBeenCalled();
    expect(screen.getByRole("status")).not.toHaveTextContent("上一次调用超时");
  });
  it("checks the task cursor immediately when returning to the page", async () => {
    let snapshot: ResearchTaskView = {
      ...task(),
      status: "failed",
      stages: task().stages.map((stage) => ({ ...stage, status: "failed" })),
    };
    installApi(() => snapshot);
    await act(async () => {
      render(<ResearchWorkspace />);
    });
    snapshot = {
      ...snapshot,
      status: "running",
      nextSeq: snapshot.nextSeq + 1,
      finishedAt: null,
    };
    await act(async () => {
      fireEvent.focus(window);
    });
    expect(
      screen.queryByRole("button", { name: "继续研究" }),
    ).not.toBeInTheDocument();
  });
  it("keeps execution success separate from insufficient research and exposes context omission", async () => {
    installApi(task());
    await act(async () => {
      render(<ResearchWorkspace />);
    });
    expect(screen.getByText(/^执行完成 ·/)).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "设计决策" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("待补证的研究草稿。")).toBeInTheDocument();
    expect(
      screen.getByText("运行与版本信息").closest("details"),
    ).not.toHaveAttribute("open");
    const quality = screen.getByRole("region", { name: "研究质量" });
    expect(
      within(quality).getByText("证据不足 · 尚不能支撑研究结论"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "证据 1" }));
    expect(
      screen.getByText(
        "留档正文 99,701 字符 · 本阶段未纳入正文（上下文预算不足）",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看留档原文" })).toHaveAttribute(
      "href",
      "/api/research/evidence/source-1/file",
    );
    fireEvent.click(screen.getByRole("tab", { name: "文件 1" }));
    expect(screen.getByText("网页留档 / 视觉资料")).toBeInTheDocument();
    expect(screen.queryByText("视觉参考板")).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "预览" }));
    });
    const preview = screen.getByTitle("网页留档 / 视觉资料");
    expect(preview).toHaveAttribute("sandbox", "");
    const srcdoc = preview.getAttribute("srcdoc")!;
    const previewDocument = new DOMParser().parseFromString(
      srcdoc,
      "text/html",
    );
    expect(previewDocument.querySelector("h1")?.textContent).toBe("资料归档");
    expect(
      previewDocument.querySelector('a[href="about:srcdoc#source"]')
        ?.textContent,
    ).toBe("定位资料");
    expect(previewDocument.querySelector("style")?.textContent).toContain(
      "#123456",
    );
    expect(
      previewDocument.querySelectorAll(
        "script, base, iframe, object, embed, form",
      ),
    ).toHaveLength(0);
    expect(previewDocument.querySelector("a")?.getAttribute("href")).toBeNull();
    for (const element of previewDocument.querySelectorAll("*"))
      expect(
        [...element.attributes].some((attribute) =>
          /^on/i.test(attribute.name),
        ),
      ).toBe(false);
    const policies = previewDocument.querySelectorAll("meta");
    expect(policies).toHaveLength(1);
    expect(policies[0].getAttribute("http-equiv")).toBe(
      "Content-Security-Policy",
    );
    const policy = policies[0].getAttribute("content");
    expect(policy).toContain("script-src 'none'");
    expect(policy).toContain("connect-src 'none'");
    expect(policy).toContain("form-action 'none'");
  });

  it("places persisted design choices before the full report and navigates both card and report citations to the exact source", async () => {
    const fetchMock = installApi(decisionTask());
    await act(async () => {
      render(<ResearchWorkspace />);
    });
    const choices = screen.getByRole("region", { name: "设计决策" });
    const report = screen.getByRole("region", { name: "研究报告全文" });
    expect(
      choices.compareDocumentPosition(report) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(within(choices).getByText("材料启发的方向")).toBeInTheDocument();
    expect(
      within(choices).getByText("先用同样食材比较现场制作与预制复热。"),
    ).toBeInTheDocument();
    expect(
      within(choices).getByText("预制方向把部分准备工作移到前一天。"),
    ).toBeInTheDocument();
    const verification = within(choices)
      .getByText("下一步怎么验证，什么会改变选择")
      .closest("details")!;
    expect(verification).not.toHaveAttribute("open");
    fireEvent.click(
      within(choices).getByText("下一步怎么验证，什么会改变选择"),
    );
    expect(verification).toHaveAttribute("open");
    expect(
      within(verification).getByText("同时记录准备、等待、清洁与收纳。"),
    ).toBeInTheDocument();
    const gaps = screen.getByRole("region", { name: "待解关键问题" });
    expect(within(gaps).getByText("证据不足 · 已读材料")).toBeInTheDocument();
    expect(
      within(gaps).getByText("可拆盘是否减少整顿午餐的清洁负担？"),
    ).toBeInTheDocument();
    expect(
      within(gaps).getByText("观察拆盘、擦机身、晾干及收纳。"),
    ).toBeInTheDocument();
    const requests = fetchMock.mock.calls.length;
    fireEvent.click(
      within(choices).getByRole("button", {
        name: "来源 1 · 单个受邀众测样例",
      }),
    );
    expect(screen.getByRole("tab", { name: "证据 1" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const source = screen.getByRole("article", {
      name: "来源 1：单个受邀众测样例",
    });
    expect(source).toHaveFocus();
    expect(
      within(source).getByRole("link", { name: "查看留档原文" }),
    ).toHaveAttribute("href", "/api/research/evidence/source-1/file");
    expect(
      within(source).getByRole("link", { name: "原始来源" }),
    ).toHaveAttribute("href", "https://example.com/product");
    fireEvent.click(screen.getByRole("tab", { name: "报告" }));
    fireEvent.click(
      within(screen.getByRole("region", { name: "研究报告全文" })).getByRole(
        "link",
        { name: "来源 1" },
      ),
    );
    expect(
      screen.getByRole("article", { name: "来源 1：单个受邀众测样例" }),
    ).toHaveFocus();
    expect(fetchMock).toHaveBeenCalledTimes(requests);
  });

  it("keeps a missing source visible as a limitation rather than creating an unusable citation control", async () => {
    const snapshot = decisionTask();
    snapshot.evidence = [];
    installApi(snapshot);
    await act(async () => {
      render(<ResearchWorkspace />);
    });
    const choices = screen.getByRole("region", { name: "设计决策" });
    expect(within(choices).getByText("依据待核对")).toBeInTheDocument();
    expect(
      within(choices).getByText("部分来源未随此版本保存"),
    ).toBeInTheDocument();
    expect(
      within(choices).queryByRole("button", { name: /来源/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "原始报告全文" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "文件 1" })).toBeInTheDocument();
  });

  it("shows real activity before text and preserves Markdown nodes and selection across elapsed-time ticks", async () => {
    const snapshot = task();
    snapshot.status = "running";
    snapshot.finishedAt = null;
    snapshot.stages[0] = {
      ...snapshot.stages[0],
      kind: "research",
      status: "running",
      result: null,
      text: "",
    };
    const fetchMock = installApi(snapshot);
    await act(async () => {
      render(<ResearchWorkspace />);
    });
    expect(screen.getByText(/尚未收到本阶段正文增量/)).toBeInTheDocument();
    const source = TestEventSource.instances.at(-1)!;
    await act(async () => {
      source.onopen?.();
      source.send({
        seq: 11,
        type: "stage.activity",
        payload: {
          stageId: "stage-1",
          attemptId: "attempt-1",
          message: "正在核对产品手册",
        },
      });
    });
    expect(screen.getByRole("status")).toHaveTextContent("正在核对产品手册");
    await act(async () => {
      vi.advanceTimersByTime(30000);
    });
    expect(
      screen.getByText("任务历时 30 秒（含排队与恢复）"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "官方资料" }),
    ).not.toBeInTheDocument();
    await act(async () => {
      source.send({
        seq: 12,
        type: "stage.text",
        payload: {
          stageId: "stage-1",
          attemptId: "attempt-1",
          delta:
            "真实正文 [官方资料](https://example.com/manual)\n\n```ts\nconst ready = true;\n```\n\n| 方案 | 状态 |\n| --- | --- |\n| 加热盒 | 待核验 |",
        },
      });
    });
    const link = screen.getByRole("link", { name: "官方资料" });
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("const ready = true;")).toBeInTheDocument();
    const range = document.createRange();
    range.selectNodeContents(link);
    window.getSelection()?.addRange(range);
    const snapshotRequests = () =>
      fetchMock.mock.calls.filter(([url]) => !String(url).includes("?meta=1"))
        .length;
    const requestCount = snapshotRequests();
    await act(async () => {
      vi.advanceTimersByTime(10000);
    });
    expect(screen.getByRole("link", { name: "官方资料" })).toBe(link);
    expect(window.getSelection()?.toString()).toBe("官方资料");
    expect(snapshotRequests()).toBe(requestCount);
    await act(async () => {
      source.send({
        seq: 13,
        type: "stage.text",
        payload: {
          stageId: "stage-1",
          attemptId: "attempt-1",
          text: "最终校正正文",
        },
      });
    });
    expect(screen.getByText("最终校正正文")).toBeInTheDocument();
    expect(screen.queryByText(/真实正文/)).not.toBeInTheDocument();
  });
});

