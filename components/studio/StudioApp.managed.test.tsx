import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import type { ChatTurnView } from "@/lib/chat-turn-types";
import type { Conversation } from "./lib/types";
import { chatReceiptKey, readChatReceipt } from "./lib/chat-submission";

const mocks = vi.hoisted(() => ({
  me: vi.fn(),
  get: vi.fn(),
  pricing: vi.fn(),
  append: vi.fn(),
  refresh: vi.fn(),
  navigation: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/app",
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
}));
vi.mock("./WorkspaceShell", () => ({
  useWorkspaceNavigation: () => ({
    refreshThreads: mocks.refresh,
    setStudioNavigation: mocks.navigation,
    closeMobile: mocks.navigation,
  }),
  WorkspaceSidebarToggle: () => null,
}));
vi.mock("./TopBar", () => ({ TopBar: () => null }));
vi.mock("./lib/api", async (original) => ({
  ...(await original<object>()),
  getMe: mocks.me,
  getConversation: mocks.get,
  getConversationPricing: mocks.pricing,
  appendConversationMessages: mocks.append,
  listModels: vi.fn(async () => []),
  getChatContext: vi.fn(async () => null),
}));
vi.mock("@/components/ui", async (original) => ({
  ...(await original<object>()),
  useToast: () => ({ toast: mocks.toast }),
}));
import { StudioApp } from "./StudioApp";

const createdAt = new Date(Date.now() - 15_000).toISOString();
let canonical: ChatTurnView;
let history: Conversation;
let receiptAccepted: boolean;
let loseAck: "before" | "after" | null;
let eventController: ReadableStreamDefaultController<Uint8Array> | undefined;
let posts: Array<{ path: string; body: Record<string, unknown> }>;
let fetchMock: ReturnType<typeof vi.fn>;

function setHistory(content = "分析布局", includeReply = true) {
  history.messages = [
    {
      id: "real-user",
      role: "user",
      content,
      chatTurnId: canonical.id,
      createdAt,
    },
    ...(includeReply
      ? [
          {
            id: `real-assistant-${canonical.attemptId}`,
            role: "assistant" as const,
            content: canonical.text,
            chatTurnId: canonical.id,
            chatAttemptId: canonical.attemptId,
            chatStatus: canonical.status,
            chatSources: canonical.sources,
            chatUsage: canonical.usage,
            createdAt,
          },
        ]
      : []),
  ];
}
function ok(data: unknown) {
  return Response.json({ ok: true, data });
}
function emit(
  seq: number,
  type: string,
  payload: Record<string, unknown>,
  attemptId = canonical.attemptId,
) {
  if (!eventController) throw new Error("No event subscriber");
  eventController.enqueue(
    new TextEncoder().encode(
      `event: turn\ndata: ${JSON.stringify({ v: 1, turnId: canonical.id, attemptId, seq, type, payload })}\n\n`,
    ),
  );
}
async function start(
  content = "分析布局",
  initialReferenceKeys: string[] = [],
) {
  const result = render(
    <StudioApp
      initialThreadId="conversation"
      initialReferenceKeys={initialReferenceKeys}
    />,
  );
  expect(screen.queryByRole("radio", { name: "聊天" })).not.toBeInTheDocument();
  const input = await screen.findByRole("textbox", { name: "对话输入" });
  await waitFor(() => expect(input).toBeEnabled());
  await screen.findByRole("button", { name: /模型与思考强度：Sol/ });
  fireEvent.change(input, {
    target: { value: content },
  });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "发送" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  return result;
}
async function subscribed() {
  await waitFor(() => expect(eventController).toBeDefined());
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  canonical = {
    id: "turn",
    conversationId: "conversation",
    modelId: "gpt-6.1-sol",
    status: "running",
    attemptId: "attempt",
    attemptNumber: 1,
    text: "",
    sources: [],
    usage: null,
    error: null,
    priceCredits: 1,
    chargedCredits: 0,
    billingState: "reserved",
    lastSeq: 0,
    createdAt,
  };
  history = {
    id: "conversation",
    title: "布局",
    messages: [],
    createdAt,
    lastMessageAt: createdAt,
  };
  receiptAccepted = false;
  loseAck = null;
  eventController = undefined;
  posts = [];
  mocks.me.mockResolvedValue({ id: "managed-user", credits: 100 });
  mocks.get.mockImplementation(async () => structuredClone(history));
  mocks.pricing.mockResolvedValue({
    standardCredits: 1,
    reasoningCredits: 1,
    defaultModelId: "gpt-6.1-sol",
    models: [
      {
        id: "gpt-6.1-sol",
        displayName: "Sol",
        reasoningEfforts: ["low"],
        defaultReasoningEffort: "low",
        credits: 1,
        supportsDurableTurns: true,
        supportsWebSearch: true,
        supportsVision: true,
        maxReferenceImages: 8,
      },
    ],
  });
  fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
    const url = new URL(path, "https://studio.invalid");
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      posts.push({ path: url.pathname, body });
      if (url.pathname.endsWith("/rendered")) return ok({ recorded: true });
      if (url.pathname.endsWith("/cancel")) {
        canonical = {
          ...canonical,
          status: "cancelled",
          lastSeq: canonical.lastSeq + 1,
        };
        setHistory();
        emit(canonical.lastSeq, "attempt.terminal", { status: "cancelled" });
        return ok(canonical);
      }
      if (loseAck === "before")
        throw new Error("connection lost before receipt");
      if (url.pathname.endsWith("/retry"))
        canonical = {
          ...canonical,
          attemptId: "attempt-2",
          attemptNumber: 2,
          status: "queued",
          text: "",
          lastSeq: canonical.lastSeq + 1,
        };
      receiptAccepted = true;
      if (loseAck === "after") throw new Error("ACK lost after commit");
      return ok(canonical);
    }
    if (url.pathname.endsWith("/events"))
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            eventController = controller;
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    if (url.pathname === "/api/chat/turns") {
      if (url.searchParams.has("clientRequestId"))
        return ok(receiptAccepted ? canonical : null);
      return ok(
        ["queued", "running"].includes(canonical.status) &&
          history.messages.length
          ? canonical
          : null,
      );
    }
    if (url.pathname === "/api/chat/turns/turn") return ok(canonical);
    throw new Error(`Unexpected request ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("restores a lost create ACK after remount by the persisted user/conversation request key", async () => {
  loseAck = "after";
  const view = await start();
  await screen.findByText(/提交结果尚未确认/);
  const receipt = readChatReceipt("managed-user", "conversation")!;
  expect(receipt.pending?.kind).toBe("create");
  expect(
    localStorage.getItem(chatReceiptKey("other-user", "conversation")),
  ).toBeNull();
  expect(posts.filter((item) => item.path === "/api/chat/turns")).toHaveLength(
    1,
  );
  view.unmount();
  canonical = {
    ...canonical,
    status: "completed",
    text: "已保存的唯一回复",
    lastSeq: 4,
    sources: [{ url: "https://example.com/evidence", title: "证据" }],
    usage: { input_tokens: 20, output_tokens: 8 },
  };
  setHistory();
  loseAck = null;
  render(<StudioApp initialThreadId="conversation" />);
  expect(await screen.findByText("已保存的唯一回复")).toBeVisible();
  await waitFor(() =>
    expect(
      readChatReceipt("managed-user", "conversation")?.pending,
    ).toBeUndefined(),
  );
  expect(
    screen.getByRole("navigation", { name: "回复来源" }),
  ).toHaveTextContent("证据");
  fireEvent.click(screen.getByText("用量"));
  expect(screen.getByText(/输入 20 · 输出 8/)).toBeVisible();
  expect(posts.filter((item) => item.path === "/api/chat/turns")).toHaveLength(
    1,
  );
  expect(mocks.append).not.toHaveBeenCalled();
});

it("replays exactly the original body and key if the unknown create has no receipt", async () => {
  loseAck = "before";
  const view = await start("原始消息", ["uploads/first.png"]);
  await screen.findByText(/提交结果尚未确认/);
  const first = posts.find((item) => item.path === "/api/chat/turns")!;
  expect(first.body.references).toEqual([
    { kind: "upload", key: "uploads/first.png", label: "图1" },
  ]);
  view.unmount();
  loseAck = null;
  canonical = {
    ...canonical,
    status: "completed",
    text: "原请求的回复",
    lastSeq: 2,
  };
  render(<StudioApp initialThreadId="conversation" />);
  await screen.findByText("原请求的回复");
  const creates = posts.filter((item) => item.path === "/api/chat/turns");
  expect(creates).toHaveLength(2);
  expect(creates[1].body).toEqual(first.body);
  expect(
    fetchMock.mock.calls.some(([path]) =>
      String(path).startsWith("/api/conversations/chat"),
    ),
  ).toBe(false);
});

it("recovers the known turn even when history says running but the active query returns null", async () => {
  canonical = {
    ...canonical,
    status: "completed",
    text: "终态快照",
    lastSeq: 5,
  };
  setHistory();
  history.messages[1] = {
    ...history.messages[1],
    content: "旧内容",
    chatStatus: "running",
  };
  render(<StudioApp initialThreadId="conversation" />);
  expect(await screen.findByText("终态快照")).toBeVisible();
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "停止回复" }),
    ).not.toBeInTheDocument(),
  );
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/chat/turns/turn",
    expect.anything(),
  );
  expect(posts.filter((item) => item.path === "/api/chat/turns")).toHaveLength(
    0,
  );
});

it("keeps the same assistant DOM node and collapsed code across deltas, final snapshot and late history IDs", async () => {
  await start();
  await subscribed();
  canonical = {
    ...canonical,
    text: "段落\n\n```js\nconst value = 1;\n```",
    lastSeq: 1,
  };
  await act(async () =>
    emit(1, "text.delta", { offset: 0, text: canonical.text }),
  );
  const article = screen.getByRole("article", { name: "助手回复" });
  fireEvent.click(within(article).getByRole("button", { name: "收起代码" }));
  canonical = {
    ...canonical,
    text: canonical.text + "\n\n后续段落",
    status: "completed",
    lastSeq: 3,
  };
  setHistory();
  await act(async () =>
    emit(2, "text.delta", {
      offset: "段落\n\n```js\nconst value = 1;\n```".length,
      text: "\n\n后续段落",
    }),
  );
  await act(async () => emit(3, "attempt.terminal", { status: "completed" }));
  await screen.findByText("后续段落");
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "停止回复" }),
    ).not.toBeInTheDocument(),
  );
  expect(screen.getByRole("article", { name: "助手回复" })).toBe(article);
  expect(
    within(article).getByRole("button", { name: "展开代码" }),
  ).toBeVisible();
  expect(screen.getByLabelText("js 代码")).not.toBeVisible();
});

it("sends the visible expected attempt when stopping and preserves partial sources", async () => {
  await start();
  await subscribed();
  canonical = {
    ...canonical,
    text: "部分回复",
    lastSeq: 2,
    sources: [{ url: "https://example.com/source", title: "部分来源" }],
  };
  await act(async () => {
    emit(1, "text.delta", { offset: 0, text: "部分回复" });
    emit(2, "citations.updated", { sources: canonical.sources });
  });
  fireEvent.click(screen.getByRole("button", { name: "停止回复" }));
  await waitFor(() =>
    expect(posts.some((item) => item.path.endsWith("/cancel"))).toBe(true),
  );
  expect(posts.find((item) => item.path.endsWith("/cancel"))?.body).toEqual({
    expectedAttemptId: "attempt",
  });
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "停止回复" }),
    ).not.toBeInTheDocument(),
  );
  expect(screen.getByText("部分回复")).toBeVisible();
  expect(
    screen.getByRole("navigation", { name: "回复来源" }),
  ).toHaveTextContent("部分来源");
});

it("persists retry identity and sends expectedPreviousAttemptId", async () => {
  canonical = { ...canonical, status: "failed", text: "失败片段", lastSeq: 1 };
  setHistory();
  render(<StudioApp initialThreadId="conversation" />);
  const retry = await screen.findByRole("button", { name: "重新生成回复" });
  await waitFor(() => expect(retry).toBeEnabled());
  fireEvent.click(retry);
  await subscribed();
  const body = posts.find((item) => item.path.endsWith("/retry"))?.body;
  expect(body).toEqual({
    clientRequestId: expect.any(String),
    expectedPreviousAttemptId: "attempt",
  });
  canonical = {
    ...canonical,
    status: "completed",
    text: "重试结果",
    lastSeq: 3,
  };
  setHistory();
  await act(async () => emit(3, "attempt.terminal", { status: "completed" }));
  await screen.findByText("重试结果");
  expect(posts.filter((item) => item.path === "/api/chat/turns")).toHaveLength(
    0,
  );
});

it("recovers a lost retry ACK after remount without allocating another retry key", async () => {
  canonical = { ...canonical, status: "failed", text: "失败片段", lastSeq: 1 };
  setHistory();
  const view = render(<StudioApp initialThreadId="conversation" />);
  const retry = await screen.findByRole("button", { name: "重新生成回复" });
  await waitFor(() => expect(retry).toBeEnabled());
  loseAck = "after";
  fireEvent.click(retry);
  await screen.findByText(/提交结果尚未确认/);
  expect(
    readChatReceipt("managed-user", "conversation")?.pending,
  ).toMatchObject({ kind: "retry", expectedPreviousAttemptId: "attempt" });
  const body = posts.find((item) => item.path.endsWith("/retry"))?.body;
  view.unmount();
  loseAck = null;
  canonical = {
    ...canonical,
    status: "completed",
    text: "已保存的重试回复",
    lastSeq: 4,
  };
  setHistory();
  render(<StudioApp initialThreadId="conversation" />);
  await screen.findByText("已保存的重试回复");
  await waitFor(() =>
    expect(
      readChatReceipt("managed-user", "conversation")?.pending,
    ).toBeUndefined(),
  );
  expect(posts.filter((item) => item.path.endsWith("/retry"))).toEqual([
    { path: "/api/chat/turns/turn/retry", body },
  ]);
});

it("uses managed submissions even when a stale catalog omits the old durable flag", async () => {
  const catalog = await mocks.pricing();
  delete catalog.models[0].supportsDurableTurns;
  mocks.pricing.mockResolvedValue(catalog);
  canonical = {
    ...canonical,
    status: "completed",
    text: "managed",
    lastSeq: 1,
  };
  await start();
  await screen.findByText("managed");
  expect(posts.filter((item) => item.path === "/api/chat/turns")).toHaveLength(
    1,
  );
  expect(mocks.append).not.toHaveBeenCalled();
});

it("does not lose focus reconciliation while terminal history is still loading", async () => {
  const view = await start();
  await subscribed();
  const reads = mocks.get.mock.calls.length;
  let finishHistory!: (value: Conversation) => void;
  mocks.get.mockImplementationOnce(
    () =>
      new Promise<Conversation>((resolve) => {
        finishHistory = resolve;
      }),
  );
  canonical = {
    ...canonical,
    status: "completed",
    text: "第一轮完成",
    lastSeq: 1,
  };
  setHistory();
  await act(async () => emit(1, "attempt.terminal", { status: "completed" }));
  await waitFor(() =>
    expect(mocks.get.mock.calls.length).toBeGreaterThan(reads),
  );
  canonical = {
    ...canonical,
    status: "queued",
    attemptId: "focus-attempt-2",
    attemptNumber: 2,
    text: "",
    lastSeq: 2,
  };
  setHistory();
  act(() => window.dispatchEvent(new Event("focus")));
  await act(async () => finishHistory(structuredClone(history)));
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some(([path]) =>
        String(path).endsWith("/events?after=2"),
      ),
    ).toBe(true),
  );
  expect(screen.getByRole("button", { name: "停止回复" })).toBeVisible();
  expect(posts.filter((item) => item.path === "/api/chat/turns")).toHaveLength(
    1,
  );
  view.unmount();
});

it("refreshes historical attempt status when an old terminal reveals a newer active attempt", async () => {
  const view = await start();
  await subscribed();
  canonical = { ...canonical, text: "旧片段", lastSeq: 1 };
  await act(async () => emit(1, "text.delta", { offset: 0, text: "旧片段" }));
  canonical = {
    ...canonical,
    attemptId: "newer-attempt",
    attemptNumber: 2,
    text: "新尝试",
    lastSeq: 3,
  };
  setHistory();
  await act(async () =>
    emit(2, "attempt.terminal", { status: "failed" }, "attempt"),
  );
  await screen.findByText("新尝试");
  await waitFor(() =>
    expect(screen.queryByText("旧片段")).not.toBeInTheDocument(),
  );
  expect(screen.getAllByRole("article", { name: "助手回复" })).toHaveLength(1);
  expect(posts.filter((item) => item.path === "/api/chat/turns")).toHaveLength(
    1,
  );
  view.unmount();
});
