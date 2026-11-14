import type {
  Conversation,
  ConversationMessage,
  ConversationPricing,
  ConversationSummary,
  Generation,
  GenerationImage,
  Me,
  ModelInfo,
} from "@/components/studio/lib/types";
import type { ChatTurnView } from "@/lib/chat-turn-types";

export const PREVIEW_SCENARIOS = [
  "empty",
  "chat",
  "images",
  "waiting",
  "streaming",
  "html",
  "error",
] as const;
export type PreviewScenario = (typeof PREVIEW_SCENARIOS)[number];

const at = (minutesAgo: number) =>
  new Date(Date.UTC(2026, 10, 12, 12, 0) - minutesAgo * 60_000).toISOString();

export const me: Me = {
  id: "preview-user",
  email: "lin@example.com",
  name: "林见",
  role: "USER",
  status: "ACTIVE",
  credits: 1284,
  dailyGenLimit: 200,
  concurrentLimit: 4,
  dailyUsed: 7,
  dailyLimit: 200,
  authenticated: true,
};

export const pricing: ConversationPricing = {
  standardCredits: 2,
  reasoningCredits: 2,
  defaultModelId: "claude-opus-5-5",
  models: [
    {
      id: "claude-opus-5-5",
      displayName: "Claude Opus 5.5",
      reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
      defaultReasoningEffort: "low",
      credits: 0,
      pricing: {
        type: "per_million_tokens",
        input: 60,
        output: 300,
        cacheRead: 6,
        cacheCreation: 75,
      },
      supportsVision: true,
      maxReferenceImages: 8,
      supportsWebSearch: true,
      supportsDurableTurns: true,
    },
    {
      id: "gpt-6.1-sol",
      displayName: "GPT-6.1 Sol",
      reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
      defaultReasoningEffort: "medium",
      credits: 2,
      supportsVision: true,
      maxReferenceImages: 8,
      supportsWebSearch: true,
      supportsDurableTurns: true,
    },
  ],
};

export const imageModels: ModelInfo[] = [
  {
    id: "image-2.6",
    displayName: "Image 2.6",
    vendor: "preview",
    protocol: "openai-images",
    capabilities: {
      sizes: ["auto", "1024x1024", "1536x1024", "1024x1536"],
      responseFormats: ["url"],
      resolutions: ["1K"],
      qualities: ["auto", "low", "medium", "high"],
      supportsReferenceImage: true,
      maxReferenceImages: 4,
      supportsNegativePrompt: false,
      supportsSeed: false,
      maxN: 4,
      outputFormats: ["png", "jpeg", "webp"],
      backgrounds: ["auto", "opaque", "transparent"],
      supportsOutputCompression: false,
    },
    defaults: {
      size: "auto",
      quality: "auto",
      responseFormat: "url",
      outputFormat: "png",
      background: "auto",
    },
    available: true,
  } as ModelInfo,
];

const threadTitles = [
  "茶饮品牌秋季海报方向",
  "洪崖洞夜景组图",
  "个人作品集落地页",
  "把产品文案改得更口语",
  "咖啡杯贴纸，透明底",
  "年会邀请函版式",
  "这张图的光为什么假",
  "小红书封面三选一",
  "周报：十月投放复盘",
  "Logo 留白规范怎么写",
  "给妈妈的生日贺卡",
  "民宿详情页首屏",
];

export const threads: ConversationSummary[] = threadTitles.map(
  (title, index) => ({
    id: index === 0 ? "preview" : `thread-${index}`,
    title,
    lastMessageAt: at(index * 190),
    createdAt: at(index * 190 + 30),
    latestMessage: null,
    thumbnailUrl: null,
    generationCount: 0,
  }),
);

const image = (id: string, file: string, w: number, h: number) =>
  ({
    id,
    url: `/studio/${file}`,
    src: `/studio/${file}`,
    downloadUrl: `/studio/${file}`,
    thumbnailUrl: `/studio/${file}`,
    width: w,
    height: h,
    mimeType: "image/jpeg",
    createdAt: at(8),
  }) satisfies GenerationImage;

const generation = (
  id: string,
  patch: Partial<Generation>,
): Generation => ({
  id,
  source: "web",
  conversationId: "preview",
  modelId: "image-2.6",
  prompt:
    "雨夜的重庆洪崖洞，吊脚楼层层叠起，暖黄灯火映在湿漉漉的石阶上，低机位仰拍，35mm 电影感，浅景深，画面不出现文字",
  negativePrompt: null,
  aspectRatio: "3:2",
  resolution: "1K",
  size: "1536x1024",
  n: 1,
  outputFormat: "png",
  referenceImageKeys: [],
  status: "SUCCEEDED",
  provider: null,
  providerChannelId: null,
  providerChannelName: null,
  providerAccountName: null,
  progress: 100,
  errorCode: null,
  errorMessage: null,
  credits: 12,
  costCredits: 12,
  billing: { state: "charged", chargedCredits: 12 },
  attempts: 1,
  startedAt: at(9),
  finishedAt: at(8),
  createdAt: at(9),
  images: [],
  ...patch,
});

export const generations: Record<string, Generation> = {
  "gen-done": generation("gen-done", {
    aspectRatio: "16:9",
    images: [image("img-1", "landscape.jpg", 1600, 900)],
  }),
  "gen-running": generation("gen-running", {
    status: "RUNNING",
    progress: 42,
    finishedAt: null,
    prompt:
      "同一场景换成清晨薄雾，灯火刚熄，江面有一艘早班轮渡，色调偏冷，保留仰拍构图",
    billing: { state: "reserved", chargedCredits: null, reservedCredits: 12 },
  }),
  "gen-failed": generation("gen-failed", {
    status: "FAILED",
    progress: 0,
    errorCode: "CONTENT_POLICY",
    errorMessage: "图片模型拒绝了这次请求：提示词里包含真实人物姓名。",
    billing: { state: "released", chargedCredits: 0 },
    prompt: "把上一张图里的路人换成某位明星的脸",
  }),
};

const usage = {
  input_tokens: 4210,
  output_tokens: 612,
  input_tokens_details: { cached_tokens: 3584 },
};

const turnMessages = (
  turn: string,
  minutesAgo: number,
  user: string,
  reply: Partial<ConversationMessage> & { content: string },
): ConversationMessage[] => [
  {
    id: `${turn}-user`,
    role: "user",
    content: user,
    chatTurnId: turn,
    createdAt: at(minutesAgo),
  },
  {
    id: `${turn}-assistant`,
    role: "assistant",
    chatTurnId: turn,
    chatAttemptId: `${turn}-attempt`,
    chatAttemptNumber: 1,
    chatStatus: "completed",
    chatActivity: "answering",
    chatActivityHistory: ["context", "waiting_upstream", "answering"],
    chatStartedAt: at(minutesAgo),
    chatUsage: usage,
    chatBilling: { state: "charged", chargedCredits: 0.42 },
    createdAt: at(minutesAgo),
    ...reply,
  },
];

const MARKDOWN_REPLY = `先说结论：三个方向里我会选 **“一杯里的秋天”**，它最容易做成系列，也最不依赖模特。

### 三个方向

| 方向 | 画面 | 风险 |
| --- | --- | --- |
| 一杯里的秋天 | 俯拍杯口，茶汤里映出银杏和天空 | 需要控制反光，否则像合成 |
| 街角第一口 | 骑车的人单手接过杯子，背景虚化 | 人物表情难统一 |
| 配方手稿 | 牛皮纸上的手写配方加水渍 | 容易做得太“文艺”，看不出是茶饮 |

### 文案可以这样收

1. 主标题控制在七个字以内，比如“秋天先到杯里”。
2. 副标题只讲一件事：新品是什么茶底。
3. 价格和门店信息放在最下方一行，不要抢画面。

> 如果预算只够拍一组，先拍俯拍杯口。这个角度后期换背景的余地最大。

配色上建议用茶汤本身的琥珀色做主色，\`#C8842B\` 左右，其余全部压到米白和深褐，不要再加第三个彩色。

需要的话我可以直接出一张俯拍方向的视觉稿，你看了再决定要不要往下做。`;

const HTML_REPLY = `落地页做好了，一屏一件事，往下滚依次是作品、经历和联系方式。

\`\`\`html
<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>林见 · 作品集</title>
<style>
  body { margin: 0; font: 16px/1.7 "Noto Serif SC", Georgia, serif; background: #f4efe6; color: #1d1b17; }
  main { max-width: 720px; margin: 0 auto; padding: 96px 24px; }
  h1 { font-size: 56px; line-height: 1.1; margin: 0 0 24px; font-weight: 600; }
  p { max-width: 34em; }
  a { color: #8a3b12; }
</style>
</head>
<body>
<main>
  <h1>林见<br />做安静的版式。</h1>
  <p>平面设计师，现居杭州。过去六年主要给茶饮、民宿和独立出版做视觉。</p>
  <p><a href="#work">看作品</a></p>
</main>
</body>
</html>
\`\`\`

字体用了衬线体配暖灰底色，如果想更现代一点，我可以换成无衬线再给你一版。`;

const chatMessages: ConversationMessage[] = [
  ...turnMessages(
    "turn-1",
    46,
    "我们是一家做原叶茶饮的小店，秋季要上桂花乌龙。想做一张主海报，你先给我几个方向，别太网红。",
    { content: MARKDOWN_REPLY },
  ),
  ...turnMessages(
    "turn-2",
    31,
    "桂花乌龙今年有哪些品牌在做？帮我查一下，看看别人怎么拍的。",
    {
      content:
        "查了一下，今年秋季上新里把桂花乌龙当主推的有三家，拍法差别不大：都是暖色逆光加飘落的桂花，杯身占画面一半以上 [1][2]。\n\n这反而是机会。大家都在拍“桂花落下来”，没有人拍“茶汤里的倒影”，俯拍方向在货架上会很好认 [3]。",
      chatSearched: true,
      chatActivityHistory: [
        "context",
        "waiting_upstream",
        "searching",
        "answering",
      ],
      chatSources: [
        {
          url: "https://example.com/autumn-tea-2026",
          title: "2026 秋季茶饮上新盘点",
        },
        {
          url: "https://example.com/osmanthus-oolong-visuals",
          title: "桂花乌龙的十二种拍法",
        },
        {
          url: "https://example.com/shelf-recognition",
          title: "货架识别度研究",
        },
      ],
      chatBilling: { state: "charged", chargedCredits: 2 },
    },
  ),
];

const imageMessages: ConversationMessage[] = [
  ...turnMessages(
    "turn-3",
    12,
    "帮我生成一张图：雨夜的重庆洪崖洞，电影感，横版",
    {
      content:
        "已经提交了。画面按低机位仰拍来做，灯火映在湿石阶上，稍后会显示在下面。",
      chatActivityHistory: [
        "context",
        "waiting_upstream",
        "image_tool",
        "image_generating",
        "answering",
      ],
      generationId: "gen-done",
    },
  ),
  ...turnMessages("turn-4", 6, "同一场景换成清晨薄雾，保留仰拍构图", {
    content: "换成清晨的版本也提交了，色调会偏冷，江面加了一艘早班轮渡。",
    chatActivityHistory: [
      "context",
      "waiting_upstream",
      "image_tool",
      "image_generating",
      "answering",
    ],
    generationId: "gen-running",
  }),
  ...turnMessages("turn-5", 2, "把上一张图里的路人换成某位明星的脸", {
    content:
      "这张没有提交成功：图片模型不接受包含真实人物姓名的提示词，积分没有扣。可以描述你想要的气质和穿着，我按描述来做。",
    generationId: "gen-failed",
  }),
];

const conversation = (
  title: string,
  messages: ConversationMessage[],
): Conversation => ({
  id: "preview",
  title,
  createdAt: at(60),
  lastMessageAt: at(1),
  messages,
});

export const RUNNING_TURN: ChatTurnView = {
  id: "turn-live",
  conversationId: "preview",
  modelId: "claude-opus-5-5",
  status: "running",
  attemptId: "turn-live-attempt",
  attemptNumber: 1,
  text: "海报的层级可以这样排：\n\n1. **主视觉**占画面上方三分之二，俯拍杯口，茶汤里是银杏的倒影。\n2. 主标题压在杯沿下方，字不要大过杯口直径，",
  sources: [],
  usage: null,
  error: null,
  priceCredits: 0,
  chargedCredits: 0,
  billingState: "reserved",
  lastSeq: 12,
  activity: "answering",
  activityHistory: ["context", "waiting_upstream", "reasoning", "answering"],
  createdAt: new Date(Date.now() - 14_000).toISOString(),
  startedAt: new Date(Date.now() - 14_000).toISOString(),
  protocolVersion: 2,
};

/** The timeline reads image jobs from fields on the message, not from a map. */
function withGeneration(message: ConversationMessage): ConversationMessage {
  const item = message.generationId
    ? generations[message.generationId]
    : undefined;
  if (!item) return message;
  return {
    ...message,
    images: item.images,
    generationPrompt: item.prompt,
    generationModelId: item.modelId,
    generationSize: item.size,
    generationCount: item.n,
    generationStatus: item.status,
    generationProgress: item.progress,
    generationErrorCode: item.errorCode,
    generationErrorMessage: item.errorMessage,
    generationCostCredits: item.costCredits,
    generationBilling: item.billing,
    generationStartedAt: item.startedAt,
    generationFinishedAt: item.finishedAt,
  };
}

export function runningTurn(scenario: PreviewScenario): ChatTurnView | null {
  if (scenario === "streaming") return RUNNING_TURN;
  if (scenario === "waiting")
    return {
      ...RUNNING_TURN,
      text: "",
      lastSeq: 3,
      activity: "waiting_upstream",
      activityHistory: ["context", "waiting_upstream"],
    };
  return null;
}

export function conversationFor(scenario: PreviewScenario): Conversation | null {
  switch (scenario) {
    case "empty":
      return null;
    case "chat":
      return conversation("茶饮品牌秋季海报方向", chatMessages);
    case "images":
      return conversation(
        "洪崖洞夜景组图",
        imageMessages.map(withGeneration),
      );
    case "html":
      return conversation(
        "个人作品集落地页",
        turnMessages(
          "turn-6",
          9,
          "帮我做一个个人作品集的落地页，我是平面设计师，风格安静一点。",
          { content: HTML_REPLY },
        ),
      );
    case "waiting":
    case "streaming":
      return conversation("茶饮品牌秋季海报方向", [
        ...chatMessages.slice(0, 2),
        {
          id: "turn-live-user",
          role: "user",
          content: "就按俯拍杯口做，帮我把海报的层级排一下。",
          chatTurnId: "turn-live",
          createdAt: RUNNING_TURN.createdAt!,
        },
      ]);
    case "error":
      return conversation("茶饮品牌秋季海报方向", [
        ...chatMessages.slice(0, 2),
        ...turnMessages("turn-7", 4, "主标题再给我十个备选。", {
          content: "可以，先给前四个：\n\n1. 秋天先到杯里\n2. 桂花落进乌龙\n3. 一口，入秋\n4. 把秋天",
          chatStatus: "interrupted",
          chatError: "连接中断，已保留收到的内容",
          chatUsage: null,
          chatBilling: { state: "released", chargedCredits: 0 },
        }),
      ]);
  }
}
