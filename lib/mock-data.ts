import { listModels } from "@/lib/models/registry";

export const mockUser = {
  id: "user_demo",
  email: "student@scfa.example",
  name: "Chūgǎo 试点用户",
  credits: 142,
  role: "USER",
  dailyUsed: 8,
  dailyLimit: 50,
};

export const mockGenerations = [
  {
    id: "gen_1",
    modelId: "gpt-image-2",
    prompt: "极简海报，黑底白字，中央一只银色蝴蝶，留足边距。",
    status: "SUCCEEDED",
    createdAt: "2026-05-10T01:20:00.000Z",
    aspectRatio: "3:2",
    resolution: "4K",
    credits: 20,
    provider: "image2",
    images: [
      {
        id: "img_1",
        src: "/sample-poster.jpg",
      },
    ],
  },
  {
    id: "gen_2",
    modelId: "gemini-2.5-flash-image-pro",
    prompt: "服装立裁工作室，晨雾感，柔和天光，浅灰与米白。",
    status: "RUNNING",
    createdAt: "2026-05-10T01:31:00.000Z",
    aspectRatio: "4:5",
    resolution: "2K",
    credits: 8,
    provider: "Gemini Relay CQ",
    images: [],
  },
  {
    id: "gen_3",
    modelId: "gemini-2.5-flash-image",
    prompt: "赛博重庆夜景，长焦压缩感，霓虹雨丝。",
    status: "PENDING",
    createdAt: "2026-05-10T01:34:00.000Z",
    aspectRatio: "16:9",
    resolution: "1K",
    credits: 2,
    provider: "Gemini Relay CQ",
    images: [],
  },
] as const;

export const mockStats = {
  todayGenerations: 184,
  onlineUsers: 19,
  healthyProviders: 4,
  queueDepth: 7,
};

export const mockProviders = [
  {
    id: "provider_1",
    name: "image2",
    protocol: "OPENAI_IMAGES",
    baseUrl: "https://api.xpzhao.top",
    priority: 100,
    health: "HEALTHY",
    lastErrorMsg: "",
    modelsSupported: ["gpt-image-2"],
    costMultiplier: 0.92,
  },
  {
    id: "provider_2",
    name: "Gemini Relay CQ",
    protocol: "GEMINI_IMAGE",
    baseUrl: "https://relay-2.example.com",
    priority: 80,
    health: "DEGRADED",
    lastErrorMsg: "上游 429 较多",
    modelsSupported: ["gemini-2.5-flash-image", "gemini-2.5-flash-image-pro"],
    costMultiplier: 1,
  },
] as const;

export const mockInvites = [
  { code: "CHUGAO-ALPHA-01", usedCount: 4, maxUses: 10, initialCredits: 100 },
  { code: "CHUGAO-PRINT-02", usedCount: 1, maxUses: 5, initialCredits: 200 },
] as const;

export const mockSystemConfigEntries = [
  { key: "registration.inviteOnly", value: true },
  { key: "registration.defaultCredits", value: 100 },
  { key: "generation.globalConcurrency", value: 20 },
  { key: "moderation.enabled", value: true },
] as const;

export const mockModelAvailability = listModels().map((model) => ({
  ...model,
  available: true,
}));
