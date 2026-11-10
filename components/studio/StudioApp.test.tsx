import {
  act,
  fireEvent,
  render as renderView,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { ComponentProps, ReactNode } from "react";
import type {
  Conversation,
  ConversationPricing,
  Generation,
  ModelInfo,
} from "./lib/types";
import type { GenerationStreamHandlers } from "./lib/sse";

const mocks = vi.hoisted(() => ({
  me: vi.fn(),
  models: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  generate: vi.fn(),
  append: vi.fn(),
  update: vi.fn(),
  compile: vi.fn(),
  chat: vi.fn(),
  cancelChat: vi.fn(),
  pricing: vi.fn(),
  context: vi.fn(),
  compact: vi.fn(),
  toast: vi.fn(),
  subscribe: vi.fn(),
  upload: vi.fn(),
  plan: vi.fn(),
  quote: vi.fn(),
  inspect: vi.fn(),
  check: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/app",
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("./lib/api", () => ({
  request: vi.fn(async () => ({})),
  getMe: mocks.me,
  listModels: mocks.models,
  listConversations: mocks.list,
  getConversation: mocks.get,
  createConversation: mocks.create,
  createGeneration: mocks.generate,
  appendConversationMessages: mocks.append,
  updateConversation: mocks.update,
  compileConversationPrompt: mocks.compile,
  getConversationPricing: mocks.pricing,
  getChatContext: mocks.context,
  compactChatContext: mocks.compact,
  cancelGeneration: vi.fn(),
  getGenerationForRetry: vi.fn(),
  optimizePrompt: vi.fn(),
  uploadReferenceImage: mocks.upload,
  planCreativeBrief: mocks.plan,
  quoteCreativeGeneration: mocks.quote,
  inspectCreativeReferences: mocks.inspect,
  checkCreativeResult: mocks.check,
  isApiError: (error: unknown) => error instanceof Error && "code" in error,
}));
vi.mock("./lib/sse", () => ({
  subscribeGeneration: mocks.subscribe,
}));
vi.mock("./lib/chat-turn-api", async (original) => ({
  ...(await original<object>()),
  streamManagedChat: mocks.chat,
  getActiveChatTurn: vi.fn(async () => null),
  cancelManagedChat: mocks.cancelChat,
}));
vi.mock("@/components/ui", async (original) => ({
  ...(await original<object>()),
  useToast: () => ({ toast: mocks.toast }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("./TopBar", () => ({
  TopBar: ({ title, leading }: { title: string; leading: ReactNode }) => (
    <header>
      {leading}
      <span>{title}</span>
    </header>
  ),
}));
vi.mock("./Lightbox", () => ({
  Lightbox: ({ state }: { state: { index: number } }) => (
    <div data-testid="image-index">{state.index}</div>
  ),
}));

import { StudioApp } from "./StudioApp";
import { WorkspaceShell } from "./WorkspaceShell";

function render(children: ReactNode) {
  return renderView(<WorkspaceShell>{children}</WorkspaceShell>);
}

const model = {
  id: "image",
  displayName: "Image2.5",
  available: true,
  defaults: { size: "1024x1024", outputFormat: "png" },
  capabilities: {
    sizes: ["auto", "1024x1024"],
    outputFormats: ["png"],
    maxN: 1,
    supportsReferenceImage: true,
    maxReferenceImages: 16,
  },
} as ModelInfo;
const chatPricing: ConversationPricing = {
  standardCredits: 0.5,
  reasoningCredits: 1,
  defaultModelId: "gpt-5.6-luna",
  models: [
    {
      id: "deepseek-chat",
      displayName: "DeepSeek",
      reasoningEfforts: [],
      credits: 0.5,
      supportsVision: false,
      maxReferenceImages: 0,
    },
    {
      id: "gpt-5.6-luna",
      displayName: "GPT-5.6 Luna",
      reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
      defaultReasoningEffort: "high",
      credits: 2,
      supportsVision: true,
      maxReferenceImages: 8,
    },
  ],
};
const conversation = (id = "thread-1"): Conversation => ({
  id,
  title: id === "thread-1" ? "庭院方案" : "海报设计",
  createdAt: "2026-09-22T12:00:00Z",
  lastMessageAt: "2026-09-22T12:00:00Z",
  messages: [],
});
const image = {
  id: "image-1",
  url: "/api/generations/g-1/images/image-1",
  thumbnailUrl: "/api/generations/g-1/images/image-1",
  width: 1024,
  height: 1024,
};
let stored: Conversation;
let handlers: GenerationStreamHandlers | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  stored = conversation();
  handlers = undefined;
  mocks.me.mockResolvedValue({ id: "test-user", credits: 100 });
  mocks.context.mockResolvedValue({
    estimatedTokens: 20,
    budgetTokens: 24_000,
    messageCount: 0,
    compactedMessages: 0,
    summary: null,
    canCompact: false,
  });
  mocks.compact.mockImplementation(() => mocks.context());
  mocks.models.mockResolvedValue([model]);
  mocks.pricing.mockResolvedValue(structuredClone(chatPricing));
  mocks.list.mockResolvedValue({
    items: [conversation(), conversation("thread-2")],
  });
  mocks.get.mockImplementation(async (id: string) =>
    id === "thread-1" ? structuredClone(stored) : conversation(id),
  );
  mocks.create.mockResolvedValue(conversation());
  mocks.subscribe.mockImplementation(
    (_id: string, callbacks: GenerationStreamHandlers) => {
      handlers = callbacks;
      return () => {};
    },
  );
  mocks.generate.mockImplementation(async (input) => {
    stored.messages.push(
      {
        id: "user-1",
        role: "user",
        content: input.userMessage,
        createdAt: stored.createdAt,
      },
      {
        id: "assistant-1",
        role: "assistant",
        content: input.assistantMessage,
        generationId: "g-1",
        generationPrompt: input.prompt,
        generationStatus: "PENDING",
        generationModelId: "image",
        createdAt: stored.createdAt,
      },
    );
    return {
      generationId: "g-1",
      status: "PENDING",
      estimatedCredits: 6,
      queueWaiting: 0,
    };
  });
  mocks.compile.mockResolvedValue({
    prompt: "保留庭院结构，改为白天",
    assistantMessage: "正在修改",
    shouldGenerate: true,
  });
  mocks.plan.mockResolvedValue({
    message: "我理解为：保留原有结构，只调整栏杆材质。",
    brief: {
      goal: "改造栏杆",
      keep: "改平道路",
      change: "金属栏杆",
      avoid: "增加建筑",
      style: "写实",
    },
    questions: [],
  });
  mocks.quote.mockResolvedValue({
    estimatedCredits: 6,
    prompt: "保持坡度，仅修改栏杆",
  });
  mocks.inspect.mockResolvedValue({
    subject: "一段坡道",
    composition: "道路向前延伸",
    style: "写实",
    constraints: ["保留道路坡度"],
    risks: [],
    confidence: "high",
    summary: "画面包含一段坡道。",
    referenceSummary: "主体：一段坡道\n构图与空间：道路向前延伸",
  });
  mocks.check.mockResolvedValue({
    generationId: "g-1",
    imageId: "image-1",
    status: "pass",
    score: 90,
    summary: "符合当前方案。",
    findings: [],
  });
  mocks.append.mockImplementation(async (_id, messages) => {
    stored.messages.push(
      ...messages.map((message: object, index: number) => ({
        ...message,
        id: "saved-" + index,
        createdAt: stored.createdAt,
      })),
    );
    return structuredClone(stored);
  });
  mocks.chat.mockImplementation(async ({ handlers: callbacks, content }) => {
    const turn = managedReply(content, "可以保留原有坡度。", "completed");
    callbacks.onTurn(turn);
    callbacks.onDone();
  });
});

function managedReply(content: string, text: string, status: string) {
  const turn = {
    id: "chat-turn",
    conversationId: stored.id,
    modelId: "gpt-5.6-luna",
    status,
    attemptId: "chat-attempt",
    attemptNumber: 1,
    text,
    sources: [],
    usage: null,
    error: null,
    priceCredits: 2,
    chargedCredits: status === "completed" ? 2 : 0,
    billingState: status === "completed" ? "settled" : "reserved",
    lastSeq: 1,
  };
  stored.messages = [
    ...stored.messages.filter((message) => message.chatTurnId !== turn.id),
    {
      id: "chat-user",
      role: "user",
      content,
      createdAt: stored.createdAt,
      chatTurnId: turn.id,
    },
    {
      id: "chat-assistant",
      role: "assistant",
      content: text,
      createdAt: stored.createdAt,
      chatTurnId: turn.id,
      chatAttemptId: turn.attemptId,
      chatStatus: status,
    },
  ];
  return turn;
}

it("plans without generating, preserves locks, and requires a separate priced confirmation", async () => {
  render(<StudioApp creativeEnabled />);
  await ready();
  fireEvent.click(screen.getByRole("radio", { name: "创作 Agent" }));
  fireEvent.click(screen.getByRole("button", { name: "编辑方案" }));
  fireEvent.change(screen.getByRole("textbox", { name: "保持不变" }), {
    target: { value: "保持坡度" },
  });
  fireEvent.click(screen.getByRole("button", { name: "锁定保持不变" }));
  fireEvent.change(screen.getByRole("textbox", { name: "创作需求" }), {
    target: { value: "修改栏杆" },
  });
  fireEvent.click(screen.getByRole("button", { name: "发送给 Agent" }));
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "画面目标" })).toHaveValue(
      "改造栏杆",
    ),
  );
  expect(
    screen.getByText("我理解为：保留原有结构，只调整栏杆材质。"),
  ).toBeVisible();
  expect(screen.getByRole("textbox", { name: "保持不变" })).toHaveValue(
    "保持坡度",
  );
  expect(screen.getByRole("textbox", { name: "保持不变" })).toHaveAttribute(
    "readonly",
  );
  expect(mocks.generate).not.toHaveBeenCalled();
  expect(mocks.create).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "核对并生成" }));
  const confirmation = await screen.findByRole("dialog", {
    name: "确认本次生成",
  });
  expect(within(confirmation).getByText("6 积分")).toBeVisible();
  expect(mocks.generate).not.toHaveBeenCalled();
  fireEvent.click(
    within(confirmation).getByRole("button", { name: "确认生成 · 6 积分" }),
  );
  await waitFor(() => expect(mocks.generate).toHaveBeenCalledOnce());
  expect(mocks.generate).toHaveBeenCalledWith(
    expect.objectContaining({
      n: 1,
      sourceImageIds: [],
      referenceImageKeys: [],
      creative: expect.objectContaining({
        operationId: expect.any(String),
        maxCredits: 6,
        baseReference: null,
        brief: expect.objectContaining({ keep: "保持坡度" }),
      }),
    }),
  );
  expect(mocks.compile).not.toHaveBeenCalled();
  await screen.findByText("排队中 · 0%");
});

it("automatically checks an Agent result and supports a manual recheck", async () => {
  mocks.generate.mockImplementationOnce(async (input) => {
    stored.messages.push(
      {
        id: "quality-user",
        role: "user",
        content: input.userMessage,
        createdAt: stored.createdAt,
      },
      {
        id: "quality-assistant",
        role: "assistant",
        content: "按已确认的创作方案生成",
        generationId: "g-quality",
        generationPrompt: input.prompt,
        generationStatus: "SUCCEEDED",
        generationModelId: "image",
        images: [image] as Generation["images"],
        createdAt: stored.createdAt,
      },
    );
    return {
      generationId: "g-quality",
      status: "SUCCEEDED",
      estimatedCredits: 6,
      queueWaiting: 0,
    };
  });
  render(<StudioApp creativeEnabled />);
  await ready();
  fireEvent.click(screen.getByRole("radio", { name: "创作 Agent" }));
  fireEvent.click(screen.getByRole("button", { name: "编辑方案" }));
  fireEvent.change(screen.getByRole("textbox", { name: "画面目标" }), {
    target: { value: "设计栏杆" },
  });
  fireEvent.click(screen.getByRole("button", { name: "核对并生成" }));
  const confirmation = await screen.findByRole("dialog", {
    name: "确认本次生成",
  });
  fireEvent.click(
    within(confirmation).getByRole("button", { name: "确认生成 · 6 积分" }),
  );

  await waitFor(() =>
    expect(mocks.check).toHaveBeenCalledWith(
      expect.objectContaining({
        generationId: "g-quality",
        imageId: "image-1",
        brief: expect.objectContaining({ goal: "设计栏杆" }),
      }),
    ),
  );
  expect(await screen.findByText("结果质量检查")).toBeVisible();
  expect(screen.getByText("90/100")).toBeVisible();
  expect(screen.getByText("符合当前方案。")).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "再检查" }));
  await waitFor(() => expect(mocks.check).toHaveBeenCalledTimes(2));
});

it("retains the same confirmation operation after a network failure", async () => {
  mocks.generate.mockRejectedValueOnce(new Error("网络连接失败"));
  render(<StudioApp creativeEnabled />);
  await ready();
  fireEvent.click(screen.getByRole("radio", { name: "创作 Agent" }));
  fireEvent.click(screen.getByRole("button", { name: "编辑方案" }));
  fireEvent.change(screen.getByRole("textbox", { name: "画面目标" }), {
    target: { value: "设计栏杆" },
  });
  fireEvent.click(screen.getByRole("button", { name: "核对并生成" }));
  let confirmation = await screen.findByRole("dialog", {
    name: "确认本次生成",
  });
  fireEvent.click(
    within(confirmation).getByRole("button", { name: "确认生成 · 6 积分" }),
  );
  await waitFor(() =>
    expect(
      within(screen.getByRole("dialog")).getByRole("alert"),
    ).toHaveTextContent("网络连接失败"),
  );
  const first = mocks.generate.mock.calls[0][0];
  confirmation = screen.getByRole("dialog", { name: "确认本次生成" });
  fireEvent.click(
    within(confirmation).getByRole("button", { name: "确认生成 · 6 积分" }),
  );
  await waitFor(() => expect(mocks.generate).toHaveBeenCalledTimes(2));
  expect(mocks.generate.mock.calls[1][0]).toEqual(first);
  expect(mocks.create).toHaveBeenCalledOnce();
});

it("uses a new operation for a deliberate second confirmation", async () => {
  mocks.generate.mockImplementation(async () => ({
    generationId: `g-${mocks.generate.mock.calls.length}`,
    status: "SUCCEEDED",
    estimatedCredits: 6,
    queueWaiting: 0,
  }));
  render(<StudioApp creativeEnabled initialThreadId="thread-1" />);
  await ready();
  fireEvent.click(screen.getByRole("radio", { name: "创作 Agent" }));
  fireEvent.click(screen.getByRole("button", { name: "编辑方案" }));
  fireEvent.change(screen.getByRole("textbox", { name: "画面目标" }), {
    target: { value: "设计栏杆" },
  });

  for (let index = 0; index < 2; index += 1) {
    fireEvent.click(screen.getByRole("button", { name: "核对并生成" }));
    const confirmation = await screen.findByRole("dialog", {
      name: "确认本次生成",
    });
    fireEvent.click(
      within(confirmation).getByRole("button", { name: "确认生成 · 6 积分" }),
    );
    await waitFor(() =>
      expect(mocks.generate).toHaveBeenCalledTimes(index + 1),
    );
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: "创作 Agent" })).toBeChecked(),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "确认本次生成" }),
      ).not.toBeInTheDocument(),
    );
  }

  expect(mocks.generate.mock.calls[1][0].creative.operationId).not.toBe(
    mocks.generate.mock.calls[0][0].creative.operationId,
  );
});

it("keeps the current plan when planning fails", async () => {
  mocks.plan.mockRejectedValueOnce(new Error("辅助模型暂不可用"));
  render(<StudioApp creativeEnabled />);
  await ready();
  fireEvent.click(screen.getByRole("radio", { name: "创作 Agent" }));
  fireEvent.click(screen.getByRole("button", { name: "编辑方案" }));
  fireEvent.change(screen.getByRole("textbox", { name: "画面目标" }), {
    target: { value: "原方案" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "创作需求" }), {
    target: { value: "改为金属" },
  });
  fireEvent.click(screen.getByRole("button", { name: "发送给 Agent" }));
  await screen.findByText("辅助模型暂不可用");
  expect(screen.getByRole("textbox", { name: "画面目标" })).toHaveValue(
    "原方案",
  );
  expect(screen.getByRole("textbox", { name: "创作需求" })).toHaveValue(
    "改为金属",
  );
  expect(mocks.generate).not.toHaveBeenCalled();
});

it("surfaces reference inspection failures while continuing text planning", async () => {
  mocks.inspect.mockRejectedValueOnce(
    Object.assign(new Error("网络连接失败"), { code: "NETWORK_ERROR" }),
  );
  render(
    <StudioApp creativeEnabled initialReferenceKeys={["uploads/ref.png"]} />,
  );
  await ready();
  fireEvent.click(screen.getByRole("radio", { name: "创作 Agent" }));
  fireEvent.click(screen.getByRole("button", { name: "编辑方案" }));
  fireEvent.change(screen.getByRole("textbox", { name: "创作需求" }), {
    target: { value: "保留这张参考图的坡度，修改栏杆" },
  });
  fireEvent.click(screen.getByRole("button", { name: "发送给 Agent" }));

  await waitFor(() => expect(mocks.inspect).toHaveBeenCalledOnce());
  await waitFor(() =>
    expect(mocks.plan).toHaveBeenCalledWith(
      expect.objectContaining({ referenceSummary: "" }),
    ),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "参考图分析失败：网络连接失败",
  );
  expect(screen.getByRole("textbox", { name: "画面目标" })).toHaveValue(
    "改造栏杆",
  );
});

async function ready() {
  await screen.findByRole("button", { name: "庭院方案" });
  await screen.findByRole("button", { name: "选择模型，当前 Image2.5" });
}

it("opens a single conversation composer without the old dock panels", async () => {
  render(<StudioApp />);
  await ready();
  expect(
    screen.getByRole("heading", { name: "今天，想创作什么？" }),
  ).toBeVisible();
  expect(screen.getAllByRole("textbox", { name: "提示词" })).toHaveLength(1);
  expect(
    screen.queryByRole("checkbox", { name: "队列" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "历史图片" })).toHaveAttribute(
    "href",
    "/app/history",
  );
});

it("creates the conversation lazily and shows an accepted image job inline", async () => {
  render(<StudioApp />);
  await ready();
  expect(mocks.create).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("textbox", { name: "提示词" }), {
    target: { value: "画一个庭院" },
  });
  fireEvent.click(screen.getByRole("button", { name: "生成图片" }));
  await waitFor(() =>
    expect(mocks.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "thread-1",
        userMessage: "画一个庭院",
        prompt: "画一个庭院",
      }),
    ),
  );
  await screen.findByText("排队中 · 0%");
  expect(screen.getByRole("log", { name: "创作对话" })).toHaveTextContent(
    "画一个庭院",
  );
  expect(mocks.compile).not.toHaveBeenCalled();
  expect(screen.getByRole("textbox", { name: "提示词" })).toHaveValue("");
});

it("preserves prompt and references if submitting the first image fails", async () => {
  mocks.generate.mockRejectedValueOnce(new Error("生图服务暂时不可用"));
  render(
    <StudioApp
      initialPrompt="保留坡道"
      initialReferenceKeys={["uploads/ref.png"]}
    />,
  );
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "生成图片" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("textbox", { name: "提示词" })).toHaveValue(
    "保留坡道",
  );
  expect(mocks.generate).toHaveBeenCalledWith(
    expect.objectContaining({ referenceImageKeys: ["uploads/ref.png"] }),
  );
  expect(screen.getByRole("button", { name: "移除参考图 1" })).toBeVisible();
});

it("keeps one image result, restores preview at index zero, and uses it for the next turn", async () => {
  stored.messages = [
    { id: "u1", role: "user", content: "庭院", createdAt: stored.createdAt },
    {
      id: "a1",
      role: "assistant",
      content: "已完成",
      generationId: "g-1",
      generationPrompt: "庭院原始提示词",
      generationStatus: "SUCCEEDED",
      generationModelId: "image",
      images: [image] as Generation["images"],
      createdAt: stored.createdAt,
    },
  ];
  render(<StudioApp initialThreadId="thread-1" />);
  await ready();
  const log = await screen.findByRole("log", { name: "创作对话" });
  expect(within(log).getAllByRole("img")).toHaveLength(1);
  fireEvent.click(within(log).getByRole("button", { name: "放大查看" }));
  expect(await screen.findByTestId("image-index")).toHaveTextContent("0");
  fireEvent.change(screen.getByRole("textbox", { name: "提示词" }), {
    target: { value: "改成白天" },
  });
  fireEvent.click(screen.getByRole("button", { name: "生成图片" }));
  await waitFor(() =>
    expect(mocks.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "保留庭院结构，改为白天",
        userMessage: "改成白天",
        sourceImageIds: ["image-1"],
      }),
    ),
  );
  expect(mocks.create).not.toHaveBeenCalled();
});

it("keeps image progress inside the correct conversation", async () => {
  stored.messages = [
    {
      id: "a1",
      role: "assistant",
      content: "生成中",
      generationId: "g-1",
      generationStatus: "RUNNING",
      generationPrompt: "庭院",
      createdAt: stored.createdAt,
    },
  ];
  render(<StudioApp initialThreadId="thread-1" />);
  await ready();
  await waitFor(() => expect(handlers).toBeDefined());
  fireEvent.click(screen.getByRole("button", { name: "海报设计" }));
  await screen.findByRole("heading", { name: "今天，想创作什么？" });
  act(() =>
    handlers!.onUpdate({
      id: "g-1",
      conversationId: "thread-1",
      status: "SUCCEEDED",
      images: [image],
    } as Generation),
  );
  expect(
    screen.queryByRole("button", { name: "放大查看" }),
  ).not.toBeInTheDocument();
});

it("uses the same composer for discussion without submitting an image", async () => {
  render(<StudioApp />);
  await ready();
  fireEvent.click(screen.getByRole("radio", { name: "讨论想法" }));
  expect(chatModelTrigger()).toHaveTextContent("GPT-5.6 Luna");
  await openEffort();
  expect(screen.getByRole("slider", { name: "思考强度" })).toHaveAttribute(
    "aria-valuetext",
    "High",
  );
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "选择聊天模型" }));
  expect(
    screen.getByRole("radio", { name: /GPT-5.6 Luna 2 积分/ }),
  ).toBeVisible();
  await userEvent.setup().keyboard("{Escape}");
  fireEvent.change(screen.getByRole("textbox", { name: "对话输入" }), {
    target: { value: "帮我分析坡道设计" },
  });
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  await screen.findByText("可以保留原有坡度。");
  expect(mocks.append).not.toHaveBeenCalled();
  expect(mocks.generate).not.toHaveBeenCalled();
  expect(mocks.chat).toHaveBeenCalledWith(
    expect.objectContaining({
      modelId: "gpt-5.6-luna",
      reasoningEffort: "high",
    }),
  );
});

it("does not create a replacement thread when the requested conversation failed to load", async () => {
  mocks.get.mockRejectedValue(new Error("offline"));
  render(<StudioApp initialThreadId="missing" />);
  await ready();
  await screen.findByText("这段对话暂时无法加载");
  fireEvent.change(screen.getByRole("textbox", { name: "提示词" }), {
    target: { value: "继续修改" },
  });
  expect(screen.getByRole("button", { name: "生成图片" })).toBeDisabled();
  expect(mocks.create).not.toHaveBeenCalled();
});

it("searches recent conversations without changing the selected conversation", async () => {
  render(<StudioApp />);
  await ready();
  fireEvent.change(screen.getByRole("textbox", { name: "搜索最近对话" }), {
    target: { value: "海报" },
  });
  expect(
    screen.queryByRole("button", { name: "庭院方案" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "海报设计" })).toBeVisible();
});

it("does not restore an already sent prompt when starting the next conversation", async () => {
  render(<StudioApp />);
  await ready();
  fireEvent.change(screen.getByRole("textbox", { name: "提示词" }), {
    target: { value: "画一个庭院" },
  });
  fireEvent.click(screen.getByRole("button", { name: "生成图片" }));
  await screen.findByText("排队中 · 0%");
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "提示词" })).toHaveValue(""),
  );
  fireEvent.click(screen.getByRole("button", { name: "新对话" }));
  await screen.findByRole("heading", { name: "今天，想创作什么？" });
  expect(screen.getByRole("textbox", { name: "提示词" })).toHaveValue("");
});

it("can remove the implicit previous image before sending another image request", async () => {
  stored.messages = [
    {
      id: "a1",
      role: "assistant",
      content: "完成",
      generationId: "g-1",
      generationStatus: "SUCCEEDED",
      generationPrompt: "庭院",
      images: [image] as Generation["images"],
      createdAt: stored.createdAt,
    },
  ];
  render(<StudioApp initialThreadId="thread-1" />);
  await ready();
  fireEvent.click(await screen.findByRole("button", { name: "移除参考图 1" }));
  fireEvent.change(screen.getByRole("textbox", { name: "提示词" }), {
    target: { value: "画新的建筑" },
  });
  fireEvent.click(screen.getByRole("button", { name: "生成图片" }));
  await waitFor(() =>
    expect(mocks.generate).toHaveBeenCalledWith(
      expect.objectContaining({ sourceImageIds: [] }),
    ),
  );
});

it("keeps clarification feedback local instead of appending an unmanaged assistant message", async () => {
  stored.messages = [
    { id: "user", role: "user", content: "庭院", createdAt: stored.createdAt },
  ];
  mocks.compile.mockResolvedValueOnce({
    prompt: "",
    assistantMessage: "请补充要修改的位置",
    shouldGenerate: false,
  });
  render(<StudioApp initialThreadId="thread-1" />);
  await ready();
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "提示词" })).toBeEnabled(),
  );
  fireEvent.change(screen.getByRole("textbox", { name: "提示词" }), {
    target: { value: "修改一下" },
  });
  fireEvent.click(screen.getByRole("button", { name: "生成图片" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "请补充要修改的位置",
  );
  expect(screen.getByRole("textbox", { name: "提示词" })).toHaveValue(
    "修改一下",
  );
  expect(mocks.append).not.toHaveBeenCalled();
  expect(mocks.generate).not.toHaveBeenCalled();
});

it("keeps uploaded references across discussion turns", async () => {
  render(<StudioApp initialReferenceKeys={["uploads/ref.png"]} />);
  await ready();
  fireEvent.click(screen.getByRole("radio", { name: "讨论想法" }));
  fireEvent.change(screen.getByRole("textbox", { name: "对话输入" }), {
    target: { value: "分析这张参考图" },
  });
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  await screen.findByText("可以保留原有坡度。");
  expect(screen.getByRole("button", { name: "移除参考图 1" })).toBeVisible();
  expect(mocks.chat).toHaveBeenCalledWith(
    expect.objectContaining({ referenceImageKeys: ["uploads/ref.png"] }),
  );
});

it("stops a streaming reply and preserves its received text", async () => {
  mocks.chat.mockImplementation(async ({ content, handlers: callbacks }) => {
    callbacks.onTurn(managedReply(content, "先保留原有坡度", "running"));
    await new Promise<void>((resolve) => {
      mocks.cancelChat.mockImplementation(async () => {
        const turn = managedReply(content, "先保留原有坡度", "cancelled");
        callbacks.onTurn(turn);
        resolve();
        return turn;
      });
    });
  });
  render(<StudioApp />);
  await ready();
  fireEvent.click(screen.getByRole("radio", { name: "讨论想法" }));
  fireEvent.change(screen.getByRole("textbox", { name: "对话输入" }), {
    target: { value: "分析坡道" },
  });
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  const stop = await screen.findByRole("button", { name: "停止回复" });
  expect(chatModelTrigger()).toBeDisabled();
  fireEvent.click(stop);
  await waitFor(() =>
    expect(mocks.cancelChat).toHaveBeenCalledWith("chat-turn", "chat-attempt"),
  );
  expect(mocks.append).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("button", { name: "停止回复" }),
  ).not.toBeInTheDocument();
});

async function openChat() {
  fireEvent.click(screen.getByRole("radio", { name: "讨论想法" }));
  await waitFor(() =>
    expect(chatModelTrigger()).toHaveTextContent("GPT-5.6 Luna"),
  );
  fireEvent.change(screen.getByRole("textbox", { name: "对话输入" }), {
    target: { value: "讨论庭院设计" },
  });
}

async function selectChatModel(name: string) {
  const user = userEvent.setup();
  await user.click(chatModelTrigger());
  const chooseModel = screen.queryByRole("button", { name: "选择聊天模型" });
  if (chooseModel) await user.click(chooseModel);
  await user.click(
    screen.getByRole("radio", { name: (label) => label.startsWith(name) }),
  );
  await user.keyboard("{Escape}");
}

function chatModelTrigger() {
  return screen.getByRole("button", {
    name: /^(模型与思考强度：|聊天模型未就绪)/,
  });
}
async function openEffort() {
  if (!screen.queryByRole("slider", { name: "思考强度" }))
    await userEvent.setup().click(chatModelTrigger());
  return screen.findByRole("slider", { name: "思考强度" });
}

it("keeps DeepSeek selectable, updates pricing, and omits unsupported reasoning effort", async () => {
  render(<StudioApp />);
  await ready();
  await openChat();
  await selectChatModel("DeepSeek");
  expect(chatModelTrigger()).toHaveTextContent("DeepSeek");
  expect(
    screen.queryByRole("slider", { name: "思考强度" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  await waitFor(() => expect(mocks.chat).toHaveBeenCalledOnce());
  expect(mocks.chat).toHaveBeenCalledWith(
    expect.objectContaining({
      modelId: "deepseek-chat",
      reasoningEffort: undefined,
      webSearch: false,
    }),
  );
});

it("enables supported search automatically and ignores the retired draft switch", async () => {
  const pricing = structuredClone(chatPricing);
  pricing.models[1].supportsWebSearch = true;
  mocks.pricing.mockResolvedValue(pricing);
  sessionStorage.setItem(
    "chugao.dialogue-draft.v1.test-user.new",
    JSON.stringify({ mode: "chat", chatWebSearch: false }),
  );
  render(<StudioApp />);
  await ready();
  await openChat();
  expect(
    screen.queryByRole("button", { name: "联网检索" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  await waitFor(() => expect(mocks.chat).toHaveBeenCalledOnce());
  expect(mocks.chat).toHaveBeenCalledWith(
    expect.objectContaining({ webSearch: true }),
  );
});

it("persists the selected chat model and reasoning separately from image settings", async () => {
  const view = render(<StudioApp />);
  await ready();
  await openChat();
  await openEffort();
  fireEvent.change(screen.getByRole("slider", { name: "思考强度" }), {
    target: { value: "4" },
  });
  await waitFor(() =>
    expect(
      JSON.parse(
        sessionStorage.getItem("chugao.dialogue-draft.v1.test-user.new")!,
      ),
    ).toMatchObject({
      modelId: "image",
      chatModelId: "gpt-5.6-luna",
      chatReasoningEffort: "max",
    }),
  );
  fireEvent.click(screen.getByRole("radio", { name: "生成图片" }));
  expect(
    screen.getByRole("button", { name: "选择模型，当前 Image2.5" }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("radio", { name: "讨论想法" }));
  view.unmount();
  render(<StudioApp />);
  await waitFor(() => expect(chatModelTrigger()).toHaveTextContent("Max"));
  await openEffort();
  await waitFor(() =>
    expect(screen.getByRole("slider", { name: "思考强度" })).toHaveAttribute(
      "aria-valuetext",
      "Max",
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  await waitFor(() =>
    expect(mocks.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: "gpt-5.6-luna",
        reasoningEffort: "max",
      }),
    ),
  );
});

it.each([
  {
    name: "removed model",
    saved: { chatModelId: "retired", chatReasoningEffort: "high" },
  },
  {
    name: "removed effort",
    saved: { chatModelId: "gpt-5.6-luna", chatReasoningEffort: "max" },
  },
  {
    name: "invalid saved effort",
    saved: { chatModelId: "gpt-5.6-luna", chatReasoningEffort: "unknown" },
  },
  { name: "legacy draft", saved: {} },
])(
  "falls back to server defaults for a $name without losing the draft",
  async ({ saved }) => {
    const pricing = structuredClone(chatPricing);
    pricing.models[1].reasoningEfforts = ["low", "high"];
    pricing.models[1].defaultReasoningEffort = "low";
    mocks.pricing.mockResolvedValue(pricing);
    sessionStorage.setItem(
      "chugao.dialogue-draft.v1.test-user.new",
      JSON.stringify({
        mode: "chat",
        prompt: "保留草稿内容",
        modelId: "image",
        params: { n: 1, referenceImages: [] },
        ...saved,
      }),
    );
    render(<StudioApp />);
    await screen.findByRole("button", { name: /模型与思考强度：GPT-5.6 Luna/ });
    await openEffort();
    await waitFor(() =>
      expect(screen.getByRole("slider", { name: "思考强度" })).toHaveAttribute(
        "aria-valuetext",
        "Low",
      ),
    );
    expect(screen.getByRole("slider", { name: "思考强度" })).toHaveAttribute(
      "max",
      "1",
    );
    expect(screen.getByRole("textbox", { name: "对话输入" })).toHaveValue(
      "保留草稿内容",
    );
    expect(screen.queryByText("最高")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() =>
      expect(mocks.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          modelId: "gpt-5.6-luna",
          reasoningEffort: "low",
        }),
      ),
    );
  },
);

it("uses the first available effort when the server default was removed", async () => {
  const pricing = structuredClone(chatPricing);
  pricing.models[1].reasoningEfforts = ["medium"];
  mocks.pricing.mockResolvedValue(pricing);
  render(<StudioApp />);
  await ready();
  await openChat();
  await openEffort();
  const slider = screen.getByRole("slider", { name: "思考强度" });
  expect(slider).toHaveAttribute("aria-valuetext", "Medium");
  expect(slider).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  await waitFor(() =>
    expect(mocks.chat).toHaveBeenCalledWith(
      expect.objectContaining({ reasoningEffort: "medium" }),
    ),
  );
});

it("blocks clicks and Enter until chat configuration has loaded", async () => {
  let resolvePricing!: (value: ConversationPricing) => void;
  mocks.pricing.mockReturnValueOnce(
    new Promise<ConversationPricing>((resolve) => {
      resolvePricing = resolve;
    }),
  );
  render(<StudioApp />);
  await ready();
  fireEvent.click(screen.getByRole("radio", { name: "讨论想法" }));
  fireEvent.change(screen.getByRole("textbox", { name: "对话输入" }), {
    target: { value: "还未加载" },
  });
  expect(screen.getByText("正在加载聊天模型，暂不能发送")).toBeVisible();
  expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
  expect(chatModelTrigger()).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  fireEvent.keyDown(screen.getByRole("textbox", { name: "对话输入" }), {
    key: "Enter",
  });
  expect(mocks.chat).not.toHaveBeenCalled();
  expect(mocks.create).not.toHaveBeenCalled();
  await act(async () => resolvePricing(chatPricing));
  expect(screen.getByRole("button", { name: "发送" })).toBeEnabled();
});

it.each([
  {
    name: "legacy pricing only",
    value: { standardCredits: 0.5, reasoningCredits: 1 },
  },
  { name: "empty models", value: { ...chatPricing, models: [] } },
  {
    name: "missing default model",
    value: { ...chatPricing, defaultModelId: "missing" },
  },
  {
    name: "missing vision capabilities",
    value: {
      ...chatPricing,
      models: [{ id: "gpt-5.6-luna", displayName: "GPT-5.6 Luna" }],
    },
  },
])(
  "blocks requests for $name instead of silently using legacy chat",
  async ({ value }) => {
    mocks.pricing.mockResolvedValueOnce(value);
    render(<StudioApp />);
    await ready();
    fireEvent.click(screen.getByRole("radio", { name: "讨论想法" }));
    fireEvent.change(screen.getByRole("textbox", { name: "对话输入" }), {
      target: { value: "不能误发" },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "聊天模型加载失败",
    );
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "对话输入" }), {
      key: "Enter",
    });
    expect(mocks.chat).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  },
);

it("recovers a failed model load only after a successful retry", async () => {
  mocks.pricing.mockRejectedValueOnce(new Error("offline"));
  render(<StudioApp />);
  await ready();
  fireEvent.click(screen.getByRole("radio", { name: "讨论想法" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "聊天模型加载失败",
  );
  expect(chatModelTrigger()).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "重新加载聊天模型" }));
  await openChat();
  expect(screen.getByRole("button", { name: "发送" })).toBeEnabled();
  expect(mocks.pricing).toHaveBeenCalledTimes(2);
  expect(mocks.chat).not.toHaveBeenCalled();
});

it("can chat and upload references without any image models", async () => {
  mocks.models.mockResolvedValue([]);
  mocks.upload.mockResolvedValueOnce({ key: "uploads/chat.png" });
  render(<StudioApp />);
  await openChat();
  expect(screen.queryByText("暂无可用模型")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("选择参考图文件"), {
    target: { files: [new File(["image"], "chat.png", { type: "image/png" })] },
  });
  await screen.findByRole("button", { name: "移除参考图 1" });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "发送" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  await waitFor(() =>
    expect(mocks.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: "gpt-5.6-luna",
        referenceImageKeys: ["uploads/chat.png"],
      }),
    ),
  );
  expect(mocks.generate).not.toHaveBeenCalled();
});

it("preserves incompatible references and blocks sending with a text-only model", async () => {
  render(<StudioApp initialReferenceKeys={["uploads/ref.png"]} />);
  await ready();
  await openChat();
  await selectChatModel("DeepSeek");
  expect(
    screen.getByText("当前聊天模型不支持参考图，请移除参考图或切换模型"),
  ).toBeVisible();
  expect(screen.queryByLabelText("选择参考图文件")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
  fireEvent.keyDown(screen.getByRole("textbox", { name: "对话输入" }), {
    key: "Enter",
  });
  expect(mocks.chat).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "移除参考图 1" }));
  expect(screen.getByRole("button", { name: "发送" })).toBeEnabled();
});

it("enforces the chat model reference limit, independently of the image model", async () => {
  const pricing = structuredClone(chatPricing);
  pricing.models[1].maxReferenceImages = 1;
  mocks.pricing.mockResolvedValue(pricing);
  render(
    <StudioApp initialReferenceKeys={["uploads/a.png", "uploads/b.png"]} />,
  );
  await ready();
  await openChat();
  expect(
    screen.getByText("当前聊天模型最多使用 1 张参考图，请移除多余参考图"),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
  expect(screen.getByLabelText("选择参考图文件")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "移除参考图 2" }));
  expect(screen.getByRole("button", { name: "发送" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  await waitFor(() =>
    expect(mocks.chat).toHaveBeenCalledWith(
      expect.objectContaining({ referenceImageKeys: ["uploads/a.png"] }),
    ),
  );
});

it("restores the selected model even when pricing loads after the session draft", async () => {
  let resolvePricing!: (value: ConversationPricing) => void;
  mocks.pricing.mockReturnValueOnce(
    new Promise<ConversationPricing>((resolve) => {
      resolvePricing = resolve;
    }),
  );
  sessionStorage.setItem(
    "chugao.dialogue-draft.v1.test-user.new",
    JSON.stringify({
      mode: "chat",
      prompt: "保留 DeepSeek 选择",
      modelId: "image",
      chatModelId: "deepseek-chat",
      params: { n: 1, referenceImages: [] },
    }),
  );
  render(<StudioApp />);
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "对话输入" })).toHaveValue(
      "保留 DeepSeek 选择",
    ),
  );
  expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
  await act(async () => resolvePricing(chatPricing));
  expect(chatModelTrigger()).toHaveTextContent("DeepSeek");
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  await waitFor(() =>
    expect(mocks.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: "deepseek-chat",
        reasoningEffort: undefined,
      }),
    ),
  );
});

it("restores separate chat settings when moving between conversations", async () => {
  sessionStorage.setItem(
    "chugao.dialogue-draft.v1.test-user.thread-2",
    JSON.stringify({
      mode: "chat",
      prompt: "第二段草稿",
      modelId: "image",
      chatModelId: "deepseek-chat",
      params: { n: 1, referenceImages: [] },
    }),
  );
  render(<StudioApp initialThreadId="thread-1" />);
  await ready();
  await openChat();
  await openEffort();
  fireEvent.change(screen.getByRole("slider", { name: "思考强度" }), {
    target: { value: "3" },
  });
  await waitFor(() =>
    expect(
      JSON.parse(
        sessionStorage.getItem("chugao.dialogue-draft.v1.test-user.thread-1")!,
      ),
    ).toMatchObject({ mode: "chat", chatReasoningEffort: "xhigh" }),
  );
  await userEvent.setup().keyboard("{Escape}");
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "海报设计" }));
  await waitFor(() => expect(chatModelTrigger()).toHaveTextContent("DeepSeek"));
  expect(screen.getByRole("textbox", { name: "对话输入" })).toHaveValue(
    "第二段草稿",
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "发送" })).toBeEnabled(),
  );
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "庭院方案" }));
  await screen.findByRole("button", { name: /模型与思考强度：GPT-5.6 Luna/ });
  await openEffort();
  await waitFor(() =>
    expect(screen.getByRole("slider", { name: "思考强度" })).toHaveAttribute(
      "aria-valuetext",
      "XHigh",
    ),
  );
  expect(screen.getByRole("textbox", { name: "对话输入" })).toHaveValue(
    "讨论庭院设计",
  );
});
