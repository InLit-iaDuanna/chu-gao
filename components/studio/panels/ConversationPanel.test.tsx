import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelInfo, Conversation } from "../lib/types";
import { ConversationPanel } from "./ConversationPanel";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  append: vi.fn(),
  compile: vi.fn(),
  stream: vi.fn(),
  upload: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("../lib/api", () => ({
  listConversations: mocks.list,
  getConversation: mocks.get,
  getMe: vi.fn(async () => ({ id: "user" })),
  appendConversationMessages: mocks.append,
  compileConversationPrompt: mocks.compile,
  createConversation: vi.fn(),
  updateConversation: vi.fn(),
  uploadReferenceImage: mocks.upload,
  getConversationPricing: () =>
    Promise.resolve({ standardCredits: 1, reasoningCredits: 2 }),
}));
vi.mock("../lib/sse", () => ({ streamConversationChat: mocks.stream }));
vi.mock("@/components/ui", async (original) => ({
  ...(await original<object>()),
  useToast: () => ({ toast: mocks.toast }),
}));

const model = {
  id: "image",
  displayName: "Image",
  defaults: {},
  capabilities: { supportsReferenceImage: true, maxReferenceImages: 16 },
} as ModelInfo;
const conversation = {
  id: "thread",
  title: "街道设计",
  messages: [
    { id: "u", role: "user", content: "保留街道坡度" },
    {
      id: "a",
      role: "assistant",
      content: "已整理需求",
      generationPrompt: "完整的生成提示词\n第二行",
    },
  ],
} as Conversation;

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  mocks.get.mockResolvedValue(conversation);
  mocks.list.mockResolvedValue({ items: [] });
  mocks.append.mockResolvedValue(conversation);
  mocks.compile.mockResolvedValue({
    prompt: "整理后的提示词",
    assistantMessage: "可以生成",
  });
});

function mount(onSubmitGeneration = vi.fn().mockResolvedValue(undefined)) {
  return render(
    <ConversationPanel
      model={model}
      storageKey="user"
      initialThreadId="thread"
      onSubmitGeneration={onSubmitGeneration}
      onCreditsChange={vi.fn()}
      onActiveThreadChange={vi.fn()}
    />,
  );
}

describe("conversation references and history", () => {
  it("copies messages, generation prompts, and the whole conversation separately", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    mount();
    await screen.findByText("保留街道坡度");
    fireEvent.click(screen.getAllByLabelText("复制消息")[0]);
    await waitFor(() =>
      expect(writeText).toHaveBeenLastCalledWith("保留街道坡度"),
    );
    fireEvent.click(screen.getByLabelText("复制提示词"));
    await waitFor(() =>
      expect(writeText).toHaveBeenLastCalledWith("完整的生成提示词\n第二行"),
    );
    fireEvent.click(screen.getByLabelText("复制整段对话"));
    await waitFor(() =>
      expect(writeText).toHaveBeenLastCalledWith(
        expect.stringContaining("我：\n保留街道坡度"),
      ),
    );
    fireEvent.click(screen.getAllByLabelText("重新编辑消息")[0]);
    expect(screen.getByLabelText("对话输入")).toHaveValue("保留街道坡度");
  });

  it("carries uploaded references into both chat and confirmed image generation", async () => {
    mocks.upload.mockResolvedValue({ key: "uploads/user/ref.png" });
    mocks.stream.mockImplementation(async ({ handlers }) => {
      handlers.onTurn({
        id: "turn",
        conversationId: "thread",
        modelId: "default",
        attemptId: "attempt",
        attemptNumber: 1,
        status: "completed",
        text: "回复",
        sources: [],
        usage: null,
        error: null,
        lastSeq: 1,
      });
      handlers.onDone();
    });
    const submit = vi.fn().mockResolvedValue(undefined);
    mount(submit);
    await screen.findByText("保留街道坡度");
    fireEvent.change(screen.getByLabelText("聊天参考图"), {
      target: { files: [new File(["png"], "ref.png", { type: "image/png" })] },
    });
    await screen.findByAltText("参考图 1");
    fireEvent.change(screen.getByLabelText("对话输入"), {
      target: { value: "分析这张图" },
    });
    fireEvent.keyDown(screen.getByLabelText("对话输入"), {
      key: "Enter",
      isComposing: true,
    });
    expect(mocks.stream).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("发送"));
    await waitFor(() =>
      expect(mocks.stream).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user",
          conversationId: "thread",
          referenceImageKeys: ["uploads/user/ref.png"],
        }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("对话输入")).toHaveValue(""),
    );
    fireEvent.click(screen.getByRole("button", { name: "生成图片" }));
    await screen.findByLabelText("生成提示词预览");
    fireEvent.click(screen.getByRole("button", { name: "确认生成" }));
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: "整理后的提示词",
          conversationId: "thread",
          referenceImageKeys: ["uploads/user/ref.png"],
        }),
      ),
    );
  });

  it("retains the draft when the chat request fails", async () => {
    mocks.stream.mockImplementation(async ({ handlers }) =>
      handlers.onError("上游暂不可用"),
    );
    mount();
    await screen.findByText("保留街道坡度");
    fireEvent.change(screen.getByLabelText("对话输入"), {
      target: { value: "不能丢的草稿" },
    });
    fireEvent.click(screen.getByLabelText("发送"));
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "对话失败" }),
      ),
    );
    expect(screen.getByLabelText("对话输入")).toHaveValue("不能丢的草稿");
    expect(mocks.append).not.toHaveBeenCalled();
  });
});
