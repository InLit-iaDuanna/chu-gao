import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui";
import type { Conversation } from "../lib/types";
import { AssistantContent } from "./AssistantContent";
import { ConversationTimeline } from "./ConversationTimeline";

const askJson = {
  question: "这张图打算用在哪里？",
  options: [
    { label: "小红书封面", description: "3:4 竖版" },
    { label: "电商主图" },
    { label: "头像" },
  ],
  multiple: false,
};
const askFence = (value: object = askJson) =>
  "```chugao-ask\n" + JSON.stringify(value) + "\n```";
const nextFence =
  '```chugao-next\n{"options":["换成夜景","改成竖版海报","再来 4 张"]}\n```';

afterEach(() => vi.unstubAllGlobals());

function show(
  props: Partial<ComponentProps<typeof AssistantContent>> & { content: string },
) {
  return render(
    <ToastProvider>
      <AssistantContent messageStatus="completed" {...props} />
    </ToastProvider>,
  );
}

it("renders an interactive ask card instead of raw JSON and sends the clicked label", () => {
  const onQuickReply = vi.fn();
  const { container } = show({
    content: `先确认用途。\n\n${askFence()}`,
    interactive: true,
    onQuickReply,
  });
  expect(screen.getByText("先确认用途。")).toBeVisible();
  expect(container.textContent).not.toContain('"question"');
  expect(screen.queryByLabelText("chugao-ask 代码")).not.toBeInTheDocument();
  const card = screen.getByRole("region", { name: "助手提问" });
  expect(card).toHaveTextContent("这张图打算用在哪里？");
  expect(card).toHaveTextContent("3:4 竖版");
  expect(card).toHaveTextContent("也可以直接在输入框里回复");
  fireEvent.click(within(card).getByRole("button", { name: /电商主图/ }));
  expect(onQuickReply).toHaveBeenCalledTimes(1);
  expect(onQuickReply).toHaveBeenCalledWith("电商主图");
});

it("joins multiple selected labels in option order behind a send button", () => {
  const onQuickReply = vi.fn();
  show({
    content: askFence({ ...askJson, multiple: true }),
    interactive: true,
    onQuickReply,
  });
  const send = screen.getByRole("button", { name: "发送" });
  expect(send).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: /头像/ }));
  fireEvent.click(screen.getByRole("button", { name: /小红书封面/ }));
  expect(screen.getByRole("button", { name: /头像/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(onQuickReply).not.toHaveBeenCalled();
  fireEvent.click(send);
  expect(onQuickReply).toHaveBeenCalledWith("小红书封面、头像");
});

it("shows a compact disabled card and no quick replies when not interactive, marking the answered option", () => {
  const onQuickReply = vi.fn();
  show({
    content: `说明\n\n${askFence()}\n\n${nextFence}`,
    interactive: false,
    answer: "电商主图",
    onQuickReply,
  });
  const card = screen.getByRole("region", { name: "助手提问" });
  expect(within(card).queryByRole("button")).not.toBeInTheDocument();
  expect(card).not.toHaveTextContent("也可以直接在输入框里回复");
  expect(within(card).getByText("（已选）").parentElement).toHaveTextContent(
    "电商主图",
  );
  expect(screen.queryByRole("group", { name: "快捷回复" })).toBeNull();
});

it("renders quick replies as buttons that send their text", () => {
  const onQuickReply = vi.fn();
  show({ content: `好了。\n\n${nextFence}`, interactive: true, onQuickReply });
  const group = screen.getByRole("group", { name: "快捷回复" });
  expect(within(group).getAllByRole("button")).toHaveLength(3);
  fireEvent.click(within(group).getByRole("button", { name: "改成竖版海报" }));
  expect(onQuickReply).toHaveBeenCalledWith("改成竖版海报");
});

it("renders nothing for invalid blocks and hides unclosed fences while streaming", () => {
  const { container, rerender } = show({
    content: '说明\n\n```chugao-ask\n{"question":"缺选项"}\n```',
    interactive: true,
    onQuickReply: vi.fn(),
  });
  expect(screen.queryByRole("region", { name: "助手提问" })).toBeNull();
  expect(container.textContent).not.toContain("缺选项");
  rerender(
    <ToastProvider>
      <AssistantContent
        content={'说明\n\n```chugao-ask\n{"question":"这张图'}
        streaming
        messageStatus="running"
      />
    </ToastProvider>,
  );
  expect(container.textContent).toContain("说明");
  expect(container.textContent).not.toContain("这张图");
  expect(container.querySelector("pre")).toBeNull();
});

function conversationWith(messages: Conversation["messages"]): Conversation {
  return {
    id: "thread",
    title: "对话",
    createdAt: "2026-11-20",
    lastMessageAt: "2026-11-20",
    messages,
  };
}
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

it("only lets the latest settled assistant reply answer, and copies without the blocks", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const onQuickReply = vi.fn();
  const older = {
    id: "a1",
    role: "assistant" as const,
    content: `第一问\n\n${askFence()}\n\n${nextFence}`,
    createdAt: "2026-11-20",
    chatTurnId: "t1",
    chatStatus: "completed",
  };
  const conversation = conversationWith([
    older,
    { id: "u2", role: "user", content: "头像", createdAt: "2026-11-20" },
    {
      id: "a2",
      role: "assistant",
      content: `第二问\n\n${askFence({ ...askJson, question: "要什么风格？" })}`,
      createdAt: "2026-11-20",
      chatTurnId: "t2",
      chatStatus: "completed",
    },
  ]);
  const view = render(
    <ToastProvider>
      <ConversationTimeline
        {...timelineProps}
        conversation={conversation}
        onQuickReply={onQuickReply}
      />
    </ToastProvider>,
  );
  const [first, second] = screen.getAllByRole("region", { name: "助手提问" });
  expect(within(first).queryByRole("button")).toBeNull();
  expect(within(first).getByText("（已选）").parentElement).toHaveTextContent(
    "头像",
  );
  expect(screen.queryAllByRole("group", { name: "快捷回复" })).toHaveLength(0);
  fireEvent.click(within(second).getByRole("button", { name: /小红书封面/ }));
  expect(onQuickReply).toHaveBeenCalledWith("小红书封面");

  const [copyFirst] = screen.getAllByRole("button", { name: "复制消息" });
  fireEvent.click(copyFirst);
  await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("第一问"));

  view.rerender(
    <ToastProvider>
      <ConversationTimeline
        {...timelineProps}
        conversation={conversationWith([
          ...conversation.messages.slice(0, 2),
          { ...conversation.messages[2], chatStatus: "running" },
        ])}
        onQuickReply={onQuickReply}
      />
    </ToastProvider>,
  );
  expect(screen.queryAllByRole("button", { name: /小红书封面/ })).toHaveLength(
    0,
  );
});
