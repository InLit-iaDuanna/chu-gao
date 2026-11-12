import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui";
import type { Conversation } from "../lib/types";

const parsed = vi.hoisted(() => vi.fn());
vi.mock("react-markdown", async (original) => {
  const actual = await original<typeof import("react-markdown")>();
  return {
    ...actual,
    default: (props: ComponentProps<typeof actual.default>) => {
      parsed(props.children);
      return <actual.default {...props} />;
    },
  };
});
vi.mock("../GenerationCard", () => ({
  GenerationCard: () => <div data-testid="generation-card">生成结果</div>,
}));

import { ConversationTimeline } from "./ConversationTimeline";

beforeEach(() => parsed.mockClear());
afterEach(() => {
  vi.unstubAllGlobals();
  window.getSelection()?.removeAllRanges();
});
const conversation: Conversation = {
  id: "thread",
  title: "对话",
  createdAt: "2026-10-17",
  lastMessageAt: "2026-10-17",
  messages: [
    {
      id: "user",
      role: "user",
      content: "## 用户原文 <b>保留</b>",
      createdAt: "2026-10-17",
    },
    {
      id: "assistant",
      role: "assistant",
      content: "## 助手标题\n\n- 清单",
      createdAt: "2026-10-17",
    },
    {
      id: "image",
      role: "assistant",
      content: "不应成为 Markdown",
      generationId: "g-1",
      generationPrompt: "图像提示词",
      generationStatus: "SUCCEEDED",
      createdAt: "2026-10-17",
    },
  ],
};

it("only renders assistant prose and streamed text as Markdown, preserving image cards and actions", () => {
  const props: ComponentProps<typeof ConversationTimeline> = {
    conversation,
    generations: {},
    models: [],
    pending: "**发送原文**",
    streaming: "**流式第一段**",
    status: null,
    disabled: false,
    onEdit: vi.fn(),
    onReference: vi.fn(),
    onOpen: vi.fn(),
    onRetry: vi.fn(),
    onCancel: vi.fn(),
  };
  const view = render(
    <ToastProvider>
      <ConversationTimeline {...props} />
    </ToastProvider>,
  );
  const user = screen.getByRole("article", { name: "你的消息" });
  expect(user).toHaveTextContent("## 用户原文 <b>保留</b>");
  expect(within(user).queryByRole("heading")).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "助手标题" })).toBeVisible();
  expect(screen.getByTestId("generation-card")).toBeVisible();
  expect(screen.getByRole("button", { name: "复制提示词" })).toBeVisible();
  expect(screen.getByRole("button", { name: "重新编辑消息" })).toBeVisible();
  expect(screen.getByText("流式第一段").tagName).toBe("STRONG");
  expect(
    screen.getByRole("article", { name: "正在发送的消息" }),
  ).toHaveTextContent("**发送原文**");
  view.rerender(
    <ToastProvider>
      <ConversationTimeline {...props} streaming="**流式第二段**" />
    </ToastProvider>,
  );
  expect(screen.getByText("流式第二段").tagName).toBe("STRONG");
  expect(
    parsed.mock.calls.filter(
      ([content]) => content === conversation.messages[1].content,
    ),
  ).toHaveLength(1);
  expect(parsed).not.toHaveBeenCalledWith(conversation.messages[0].content);
  expect(parsed).not.toHaveBeenCalledWith(conversation.messages[2].content);
});

const timelineProps = {
  generations: {},
  models: [],
  pending: null,
  streaming: null,
  status: null,
  disabled: false,
  onEdit: vi.fn(),
  onReference: vi.fn(),
  onOpen: vi.fn(),
  onRetry: vi.fn(),
  onCancel: vi.fn(),
};
function managedConversation(
  content: string,
  status = "running",
  id = "assistant",
): Conversation {
  return {
    ...conversation,
    messages: [
      {
        id,
        role: "assistant" as const,
        content,
        createdAt: new Date(Date.now() - 15_000).toISOString(),
        chatTurnId: "render-turn",
        chatAttemptId: "render-attempt",
        chatStatus: status,
      },
    ],
  };
}

it("shows total, uncached, read and creation token counts separately", () => {
  const history = managedConversation("complete", "completed");
  render(
    <ToastProvider>
      <ConversationTimeline
        {...timelineProps}
        conversation={{
          ...history,
          messages: history.messages.map((message) => ({
            ...message,
            chatUsage: {
              input_tokens: 4517,
              output_tokens: 33,
              input_tokens_details: {
                cached_tokens: 4328,
                cache_write_tokens: 0,
              },
            },
          })),
        }}
      />
    </ToastProvider>,
  );
  fireEvent.click(screen.getByText("用量"));
  expect(screen.getByText(/输入总量 4,517 · 输出 33/)).toBeVisible();
  expect(screen.getByText(/未缓存输入 189 · 缓存读取 4,328/)).toBeVisible();
  expect(screen.getByText("缓存创建 0")).toBeVisible();
});

it("renders the streamed process as separate bubbles from the final result", () => {
  const history = managedConversation("最终答案", "completed");
  history.messages[0].chatActivityHistory = [
    "context",
    "reasoning",
    "searching",
    "answering",
  ];
  history.messages[0].chatActivity = "answering";
  const view = render(
    <ToastProvider>
      <ConversationTimeline {...timelineProps} conversation={history} />
    </ToastProvider>,
  );
  expect(screen.getByRole("group", { name: "过程" })).toHaveTextContent(
    "正在整理上下文",
  );
  expect(screen.getByRole("group", { name: "过程" })).toHaveTextContent(
    "正在生成回复",
  );
  expect(screen.getByRole("region", { name: "回答" })).toHaveTextContent(
    "最终答案",
  );
  expect(view.container.querySelectorAll('[aria-label="回答"]')).toHaveLength(
    1,
  );
});

it("keeps table scroll, selection and the assistant node stable through streamed growth and final IDs", () => {
  const rows = Array.from(
    { length: 24 },
    (_, index) => `| ${index} | ${"长单元格 ".repeat(30)} |`,
  ).join("\n");
  const content = `固定段落\n\n| 项目 | 内容 |\n| --- | --- |\n${rows}`;
  const view = render(
    <ToastProvider>
      <ConversationTimeline
        {...timelineProps}
        conversation={managedConversation(content)}
        managedTurnId="render-turn"
      />
    </ToastProvider>,
  );
  const article = screen.getByRole("article", { name: "助手回复" });
  const table = screen.getByRole("region", { name: "表格" });
  table.scrollLeft = 120;
  const log = screen.getByRole("log");
  Object.defineProperties(log, {
    scrollHeight: { configurable: true, value: 1000 },
    clientHeight: { configurable: true, value: 100 },
  });
  log.scrollTop = 900;
  fireEvent.scroll(log);
  const range = document.createRange();
  range.selectNodeContents(screen.getByText("固定段落"));
  window.getSelection()?.addRange(range);
  view.rerender(
    <ToastProvider>
      <ConversationTimeline
        {...timelineProps}
        conversation={managedConversation(
          content + "\n| 追加 | 内容 |",
          "completed",
          "late-real-id",
        )}
        managedTurnId="render-turn"
      />
    </ToastProvider>,
  );
  expect(screen.getByRole("article", { name: "助手回复" })).toBe(article);
  expect(screen.getByRole("region", { name: "表格" })).toBe(table);
  expect(table.scrollLeft).toBe(120);
  expect(log.scrollTop).toBe(900);
  expect(window.getSelection()?.toString()).toBe("固定段落");
  window.getSelection()?.removeAllRanges();
  log.scrollTop = 100;
  fireEvent.scroll(log);
  expect(screen.getByRole("button", { name: "回到最新消息" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "回到最新消息" }));
  expect(log.scrollTop).toBe(1000);
});

it("shows honest search/reconnect waiting feedback and skips malformed historical source URLs", () => {
  const data = managedConversation("");
  Object.assign(data.messages[0], {
    chatSearched: true,
    chatSources: [
      { url: "not a url", title: "" },
      { url: "javascript:alert(1)", title: "unsafe" },
      { url: "https://user:password@example.com/", title: "credentials" },
      { url: "https://example.com/evidence", title: "" },
    ],
  });
  const view = render(
    <ToastProvider>
      <ConversationTimeline
        {...timelineProps}
        conversation={data}
        managedTurnId="render-turn"
      />
    </ToastProvider>,
  );
  expect(screen.getAllByText("检索已完成，正在等待回复…")[0]).toBeVisible();
  expect(screen.getByText(/已等待 1[5-6] 秒/)).toBeVisible();
  const sources = screen.getByRole("navigation", { name: "回复来源" });
  expect(within(sources).getAllByRole("link")).toHaveLength(1);
  expect(
    within(sources).getByRole("link", { name: "1. example.com" }),
  ).toHaveAttribute("href", "https://example.com/evidence");
  view.rerender(
    <ToastProvider>
      <ConversationTimeline
        {...timelineProps}
        conversation={data}
        managedTurnId="render-turn"
        connection="disconnected"
      />
    </ToastProvider>,
  );
  expect(screen.getAllByText("连接暂未恢复，生成状态待确认")[0]).toBeVisible();
  expect(screen.queryByText(/生成已结束/)).not.toBeInTheDocument();
});

it("reports first text only after paint frames, once per attempt, without blocking on diagnostics", async () => {
  let id = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (frame: number) =>
    frames.delete(frame),
  );
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    Response.json(
      { ok: false, error: { code: "OFFLINE", message: "diagnostic failed" } },
      { status: 503 },
    ),
  );
  vi.stubGlobal("fetch", fetch);
  const data = managedConversation("");
  data.messages[0].chatAttemptId = "diagnostic-attempt";
  const view = render(
    <ToastProvider>
      <ConversationTimeline {...timelineProps} conversation={data} />
    </ToastProvider>,
  );
  expect(frames.size).toBe(0);
  const update = (content: string) =>
    view.rerender(
      <ToastProvider>
        <ConversationTimeline
          {...timelineProps}
          conversation={{
            ...data,
            messages: [{ ...data.messages[0], content }],
          }}
        />
      </ToastProvider>,
    );
  update("首次正文");
  expect(fetch).not.toHaveBeenCalled();
  const paint = () =>
    act(() => {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback(0));
    });
  paint();
  expect(fetch).not.toHaveBeenCalled();
  paint();
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  expect(fetch.mock.calls[0][0]).toBe("/api/chat/turns/render-turn/rendered");
  expect(
    JSON.parse(
      String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body),
    ),
  ).toEqual({
    expectedAttemptId: "diagnostic-attempt",
    renderedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
  });
  update("首次正文，继续");
  paint();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(screen.getByText("首次正文，继续")).toBeVisible();
  expect(screen.getByRole("alert")).toBeEmptyDOMElement();
});
