import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Conversation, Generation, ModelInfo } from "./lib/types";
import type { GenerationStreamHandlers } from "./lib/sse";

const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  chat: vi.fn(),
  compile: vi.fn(),
  pricing: vi.fn(),
  subscribe: vi.fn(),
  refresh: vi.fn(),
  navigation: vi.fn(),
  toast: vi.fn(),
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
  getMe: async () => ({ id: "command-user", credits: 100 }),
  listModels: async () => [model],
  getConversation: async () => structuredClone(history),
  createConversation: async () => structuredClone(history),
  getChatContext: async () => null,
  getConversationPricing: mocks.pricing,
  createGeneration: mocks.generate,
  compileConversationPrompt: mocks.compile,
}));
vi.mock("./lib/chat-turn-api", async (original) => ({
  ...(await original<object>()),
  streamManagedChat: mocks.chat,
  getActiveChatTurn: async () => null,
}));
vi.mock("./lib/sse", async (original) => ({
  ...(await original<object>()),
  subscribeGeneration: mocks.subscribe,
}));
vi.mock("@/components/ui", async (original) => ({
  ...(await original<object>()),
  useToast: () => ({ toast: mocks.toast }),
}));
import { StudioApp } from "./StudioApp";

const model = {
  id: "image-test",
  displayName: "图片测试模型",
  available: true,
  defaults: { size: "1024x1024", outputFormat: "png" },
  capabilities: {
    sizes: ["1024x1024", "1536x1024"],
    outputFormats: ["png"],
    maxN: 1,
    supportsReferenceImage: true,
    maxReferenceImages: 4,
  },
} as ModelInfo;
let history: Conversation;
let generationHandlers: GenerationStreamHandlers | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  generationHandlers = undefined;
  history = {
    id: "thread",
    title: "对话",
    createdAt: "2026-11-12",
    lastMessageAt: "2026-11-12",
    messages: [],
  };
  mocks.pricing.mockResolvedValue({
    standardCredits: 1,
    reasoningCredits: 1,
    defaultModelId: "text-only",
    models: [
      {
        id: "text-only",
        displayName: "文字模型",
        reasoningEfforts: [],
        credits: 1,
        supportsVision: false,
        maxReferenceImages: 0,
      },
    ],
  });
  mocks.subscribe.mockImplementation((_id, handlers) => {
    generationHandlers = handlers;
    return () => {};
  });
  mocks.generate.mockImplementation(async (input) => {
    history.messages.push(
      {
        id: "user",
        role: "user",
        content: input.userMessage,
        createdAt: history.createdAt,
      },
      {
        id: "reply",
        role: "assistant",
        content: "正在生成图片",
        generationId: "image-job",
        generationPrompt: input.prompt,
        generationModelId: model.id,
        generationStatus: "PENDING",
        generationBilling: {
          state: "reserved",
          chargedCredits: null,
          reservedCredits: 11,
        },
        createdAt: history.createdAt,
      },
    );
    return {
      generationId: "image-job",
      status: "PENDING",
      estimatedCredits: 11,
    };
  });
});
afterEach(() => vi.restoreAllMocks());

it.each(["/生图", "/image"])(
  "sends %s verbatim with references in the same conversation, skips both LLM paths, and displays actual image credits",
  async (command) => {
    const prompt = '  原样  保留\n第二行\t"文字"  ';
    const content = `${command} ${prompt}`;
    render(
      <StudioApp
        initialThreadId="thread"
        initialPrompt={content}
        initialReferenceKeys={["uploads/command-user/ref.png"]}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "发送" })).toBeEnabled(),
    );
    expect(
      screen.queryByRole("radio", { name: "生成图片" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("radio", { name: "聊天" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(mocks.generate).toHaveBeenCalledTimes(1));
    expect(mocks.generate.mock.calls[0][0]).toMatchObject({
      prompt,
      userMessage: content,
      conversationId: "thread",
      referenceImageKeys: ["uploads/command-user/ref.png"],
    });
    expect(mocks.chat).not.toHaveBeenCalled();
    expect(mocks.compile).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "对话输入" })).toHaveValue(""),
    );
    expect(history.messages[0].content).toBe(content);
    const credits = screen.getByLabelText("本轮积分");
    expect(credits).toHaveTextContent("聊天实际积分：0");
    expect(credits).toHaveTextContent("生图实际积分：待结算");
    await act(async () =>
      generationHandlers!.onUpdate({
        id: "image-job",
        status: "SUCCEEDED",
        modelId: model.id,
        prompt,
        images: [],
        billing: { state: "charged", chargedCredits: 9 },
        createdAt: history.createdAt,
      } as unknown as Generation),
    );
    expect(screen.getByLabelText("本轮积分")).toHaveTextContent(
      "生图实际积分：9",
    );
    expect(screen.getByLabelText("本轮积分")).toHaveTextContent("合计：9 积分");
  },
);

it("completes the slash command, rejects an empty prompt, and keeps image settings available", async () => {
  render(<StudioApp />);
  const input = await screen.findByRole("textbox", { name: "对话输入" });
  fireEvent.change(input, { target: { value: "/" } });
  fireEvent.click(await screen.findByRole("option", { name: "/生图" }));
  expect(input).toHaveValue("/生图 ");
  expect(screen.getByText("请在 /生图 后输入提示词")).toBeVisible();
  expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
  fireEvent.keyDown(input, { key: "Enter" });
  expect(mocks.generate).not.toHaveBeenCalled();
  expect(mocks.chat).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "生成参数" }));
  const settings = await screen.findByRole("dialog", { name: "生成参数" });
  expect(
    within(settings).getByRole("combobox", { name: "图片模型" }),
  ).toBeVisible();
  expect(
    within(settings).getByRole("combobox", { name: "图片尺寸" }),
  ).toBeVisible();
  expect(within(settings).queryByText(/渠道/)).not.toBeInTheDocument();
});

it("keeps direct image submission available when chat configuration is unavailable", async () => {
  mocks.pricing.mockRejectedValue(new Error("chat unavailable"));
  render(<StudioApp initialPrompt="/生图 原图提示词" />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "发送" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  await waitFor(() => expect(mocks.generate).toHaveBeenCalledTimes(1));
  expect(mocks.chat).not.toHaveBeenCalled();
  expect(mocks.compile).not.toHaveBeenCalled();
});
