// AI 集成配置（DeepSeek + PPT 系统提示词），集中存于 SystemConfig 键值表。
// 设计要点：
//  - DeepSeek API Key 以密文存储（lib/crypto），且其键不进入 SYSTEM_CONFIG_DEFAULT_ROWS，
//    避免被通用 /api/admin/system-config GET 原样回传给前端而泄露。
//  - getDeepSeekConfig() 返回解密后的明文 key，仅供服务端调用；
//    getDeepSeekStatus() 只返回掩码状态，可安全回传给后台 UI。

import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import { logger } from "@/lib/logger";

const KEY_PPT_SYSTEM_PROMPT = "ppt.systemPrompt";
const KEY_DEEPSEEK_ENABLED = "deepseek.enabled";
const KEY_DEEPSEEK_BASE_URL = "deepseek.baseUrl";
const KEY_DEEPSEEK_MODEL = "deepseek.model";
const KEY_DEEPSEEK_SYSTEM_PROMPT = "deepseek.systemPrompt";
const KEY_DEEPSEEK_API_KEY_ENC = "deepseek.apiKeyEnc";

// 对话模型（独立于 DeepSeek 提示词优化与出图渠道），用于未来的流式聊天模式。
const KEY_CONVERSATION_ENABLED = "conversation.enabled";
const KEY_CONVERSATION_BASE_URL = "conversation.baseUrl";
const KEY_CONVERSATION_MODEL = "conversation.model";
const KEY_CONVERSATION_SYSTEM_PROMPT = "conversation.systemPrompt";
const KEY_CONVERSATION_COMPILE_SYSTEM_PROMPT =
  "conversation.compileSystemPrompt";
const KEY_CONVERSATION_API_KEY_ENC = "conversation.apiKeyEnc";
const KEY_CONVERSATION_REASONING = "conversation.reasoning";
const KEY_CONVERSATION_STANDARD_CREDITS = "conversation.standardCredits";
const KEY_CONVERSATION_REASONING_CREDITS = "conversation.reasoningCredits";

const AI_CONFIG_KEYS = [
  KEY_PPT_SYSTEM_PROMPT,
  KEY_DEEPSEEK_ENABLED,
  KEY_DEEPSEEK_BASE_URL,
  KEY_DEEPSEEK_MODEL,
  KEY_DEEPSEEK_SYSTEM_PROMPT,
  KEY_DEEPSEEK_API_KEY_ENC,
  KEY_CONVERSATION_ENABLED,
  KEY_CONVERSATION_BASE_URL,
  KEY_CONVERSATION_MODEL,
  KEY_CONVERSATION_SYSTEM_PROMPT,
  KEY_CONVERSATION_COMPILE_SYSTEM_PROMPT,
  KEY_CONVERSATION_API_KEY_ENC,
  KEY_CONVERSATION_REASONING,
  KEY_CONVERSATION_STANDARD_CREDITS,
  KEY_CONVERSATION_REASONING_CREDITS,
] as const;

export const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export const DEFAULT_DEEPSEEK_MODEL = "deepseek-chat";

// DeepSeek 优化的「系统提示词」：指导 DeepSeek 如何把提示词优化成出图 prompt。
// 这是 DeepSeek 接入的通用优化指令，可在后台修改。
export const DEFAULT_DEEPSEEK_SYSTEM_PROMPT = `你是图像生成提示词优化专家。把用户提供的内容优化为高质量的英文图像生成提示词。
规则：
1. 保留用户意图与主体，不要臆造无关元素。
2. 强化视觉细节（构图、配色、光影、材质、镜头）并加入专业设计术语。
3. 仅输出英文提示词本身，控制在 60-120 个单词，不要任何解释或前后缀。`;

export const DEFAULT_PPT_SYSTEM_PROMPT = `这是 PPT 演示文稿的单页配图。在 DeepSeek 优化规则之上，额外遵循：
1. 严格遵循「整体风格 / 约束」（不变提示词），保证全套幻灯片视觉统一。
2. 面向 16:9 演示文稿单页排版，注重层级、留白与可读性。`;

export const DEFAULT_CONVERSATION_BASE_URL = "https://api.deepseek.com";
export const DEFAULT_CONVERSATION_MODEL = "deepseek-chat";
export const DEFAULT_CONVERSATION_STANDARD_CREDITS = 0.5;
export const DEFAULT_CONVERSATION_REASONING_CREDITS = 1;

// 对话模型的「系统提示词」：多轮助手，同时能协助用户打磨出图提示词。
// 这是独立于 DeepSeek 优化指令与出图渠道的配置，可在后台修改。
export const DEFAULT_CONVERSATION_SYSTEM_PROMPT = `你是一个乐于助人的中文 AI 助手，支持多轮自然对话。
你的能力：
1. 像通用助手一样回答问题、梳理思路、给出建议，保持简洁、准确、友好。
2. 当用户希望生成图像时，主动帮助其把模糊想法打磨成清晰、具体的图像生成提示词（明确主体、风格、构图、配色、光影、镜头等）。
3. 在用户确认要出图之前，先以「图像提示词预览」的形式展示你拟定的提示词，让用户确认或继续调整，再进入生成环节。
始终用中文与用户交流，除非用户另有要求。`;

// 「出图提示词编译指令」：把多轮对话整理成可直接出图的最终 prompt。
// 独立于对话系统提示词，可在后台修改。compile 端点用它作 system 提示词。
export const DEFAULT_CONVERSATION_COMPILE_SYSTEM_PROMPT = `你是 Chūgǎo Studio 的图像创作上下文编译器。根据多轮对话，把用户最新意图和历史上下文整理成一个可直接传给图像生成模型的中文 prompt。
规则：
1. 保留用户明确要求延续的主体、风格、构图与限制；新的用户要求优先级最高；助手消息可作为已确认状态参考。
2. 强化必要的视觉细节（构图、配色、光影、材质、镜头），但不要臆造与对话无关的元素。
3. 只输出严格的 JSON 对象，不要任何解释或代码块标记，形如：
{"prompt": "最终出图 prompt，完整自包含，不超过 4000 字", "assistantMessage": "给用户看的简短中文回复，不超过 80 字", "shouldGenerate": true}
其中 shouldGenerate：信息足够生成则为 true；若仍需向用户追问关键信息则为 false。`;

export interface DeepSeekConfig {
  enabled: boolean;
  apiKey: string | null;
  baseUrl: string;
  model: string;
  systemPrompt: string;
}

export interface DeepSeekStatus {
  enabled: boolean;
  baseUrl: string;
  model: string;
  systemPrompt: string;
  hasKey: boolean;
}

interface AiConfigCache {
  expiresAt: number;
  rows: Record<string, unknown>;
}

const CACHE_TTL_MS = 60_000;
let cache: AiConfigCache | null = null;

function toStringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function toNonNegativeHalfCredit(value: unknown, fallback: number): number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    Number.isInteger(value * 2)
    ? value
    : fallback;
}

async function loadRows(): Promise<Record<string, unknown>> {
  if (cache && cache.expiresAt > Date.now()) {
    return cache.rows;
  }

  const rows: Record<string, unknown> = {};

  if (!process.env.DATABASE_URL) {
    cache = { expiresAt: Date.now() + CACHE_TTL_MS, rows };
    return rows;
  }

  try {
    const records = await db.systemConfig.findMany({
      where: { key: { in: [...AI_CONFIG_KEYS] } },
    });

    for (const record of records) {
      rows[record.key] = record.value;
    }
  } catch (error) {
    logger.warn({ error }, "AI config read failed; using env/defaults.");
    return rows;
  }

  cache = { expiresAt: Date.now() + CACHE_TTL_MS, rows };
  return rows;
}

async function writeRow(key: string, value: unknown): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to update AI config.");
  }

  await db.systemConfig.upsert({
    where: { key },
    create: { key, value: value as Prisma.InputJsonValue },
    update: { value: value as Prisma.InputJsonValue },
  });

  cache = null;
}

// 服务端使用：返回解密后的明文 key（DB 优先，env 兜底）。
export async function getDeepSeekConfig(): Promise<DeepSeekConfig> {
  const rows = await loadRows();

  const encKey = rows[KEY_DEEPSEEK_API_KEY_ENC];
  let apiKey: string | null = null;

  if (typeof encKey === "string" && encKey) {
    try {
      apiKey = decrypt(encKey);
    } catch (error) {
      logger.warn({ error }, "Failed to decrypt DeepSeek API key.");
      apiKey = null;
    }
  }

  if (!apiKey && process.env.DEEPSEEK_API_KEY) {
    apiKey = process.env.DEEPSEEK_API_KEY;
  }

  // 未显式配置 enabled 时：只要有可用 key 就视为启用，保持向后兼容。
  const enabledRaw = rows[KEY_DEEPSEEK_ENABLED];
  const enabled =
    enabledRaw === undefined ? Boolean(apiKey) : toBoolean(enabledRaw, false);

  return {
    enabled,
    apiKey,
    baseUrl: toStringValue(
      rows[KEY_DEEPSEEK_BASE_URL],
      process.env.DEEPSEEK_BASE_URL ?? DEFAULT_DEEPSEEK_BASE_URL,
    ),
    model: toStringValue(
      rows[KEY_DEEPSEEK_MODEL],
      process.env.DEEPSEEK_MODEL ?? DEFAULT_DEEPSEEK_MODEL,
    ),
    systemPrompt: toStringValue(
      rows[KEY_DEEPSEEK_SYSTEM_PROMPT],
      DEFAULT_DEEPSEEK_SYSTEM_PROMPT,
    ),
  };
}

// 后台展示用：不含明文 key。
export async function getDeepSeekStatus(): Promise<DeepSeekStatus> {
  const config = await getDeepSeekConfig();

  return {
    enabled: config.enabled,
    baseUrl: config.baseUrl,
    model: config.model,
    systemPrompt: config.systemPrompt,
    hasKey: Boolean(config.apiKey),
  };
}

// DeepSeek 优化的系统提示词（独立读取，供 optimizeImagePrompt 使用）。
export async function getDeepSeekSystemPrompt(): Promise<string> {
  const rows = await loadRows();
  return toStringValue(
    rows[KEY_DEEPSEEK_SYSTEM_PROMPT],
    DEFAULT_DEEPSEEK_SYSTEM_PROMPT,
  );
}

export async function getPptSystemPrompt(): Promise<string> {
  const rows = await loadRows();
  return toStringValue(rows[KEY_PPT_SYSTEM_PROMPT], DEFAULT_PPT_SYSTEM_PROMPT);
}

export interface DeepSeekConfigUpdate {
  enabled?: boolean;
  baseUrl?: string;
  model?: string;
  systemPrompt?: string;
  // 留空 / undefined 表示不修改；显式空字符串表示清除已存 key。
  apiKey?: string;
}

export async function setDeepSeekConfig(
  update: DeepSeekConfigUpdate,
): Promise<void> {
  if (update.enabled !== undefined) {
    await writeRow(KEY_DEEPSEEK_ENABLED, update.enabled);
  }

  if (update.baseUrl !== undefined) {
    await writeRow(KEY_DEEPSEEK_BASE_URL, update.baseUrl.trim());
  }

  if (update.model !== undefined) {
    await writeRow(KEY_DEEPSEEK_MODEL, update.model.trim());
  }

  if (update.systemPrompt !== undefined) {
    await writeRow(KEY_DEEPSEEK_SYSTEM_PROMPT, update.systemPrompt.trim());
  }

  if (update.apiKey !== undefined) {
    const trimmed = update.apiKey.trim();
    await writeRow(KEY_DEEPSEEK_API_KEY_ENC, trimmed ? encrypt(trimmed) : "");
  }

  cache = null;
}

export async function setPptSystemPrompt(prompt: string): Promise<void> {
  await writeRow(KEY_PPT_SYSTEM_PROMPT, prompt.trim());
}

// ---------------------------------------------------------------------------
// 对话模型（独立配置，用于未来的流式聊天模式）
//  - API Key 同样以密文存储（lib/crypto），其键不进入任何通用可泄露列表。
//  - getConversationConfig() 返回解密后的明文 key，仅供服务端调用；
//    getConversationStatus() 只返回掩码状态，可安全回传给后台 UI。
// ---------------------------------------------------------------------------

export interface ConversationConfig {
  enabled: boolean;
  apiKey: string | null;
  baseUrl: string;
  model: string;
  systemPrompt: string;
  reasoning: boolean;
}

export interface ConversationStatus {
  enabled: boolean;
  baseUrl: string;
  model: string;
  reasoning: boolean;
  hasKey: boolean;
}

export interface ConversationPricing {
  standardCredits: number;
  reasoningCredits: number;
}

// 服务端使用：返回解密后的明文 key（DB 优先，env 兜底）。
export async function getConversationConfig(): Promise<ConversationConfig> {
  const rows = await loadRows();

  const encKey = rows[KEY_CONVERSATION_API_KEY_ENC];
  let apiKey: string | null = null;

  if (typeof encKey === "string" && encKey) {
    try {
      apiKey = decrypt(encKey);
    } catch (error) {
      logger.warn({ error }, "Failed to decrypt conversation API key.");
      apiKey = null;
    }
  }

  if (!apiKey && process.env.CONVERSATION_API_KEY) {
    apiKey = process.env.CONVERSATION_API_KEY;
  }

  // 未显式配置 enabled 时：只要有可用 key 就视为启用，保持向后兼容。
  const enabledRaw = rows[KEY_CONVERSATION_ENABLED];
  const enabled =
    enabledRaw === undefined ? Boolean(apiKey) : toBoolean(enabledRaw, false);

  return {
    enabled,
    apiKey,
    baseUrl: toStringValue(
      rows[KEY_CONVERSATION_BASE_URL],
      process.env.CONVERSATION_BASE_URL ?? DEFAULT_CONVERSATION_BASE_URL,
    ),
    model: toStringValue(
      rows[KEY_CONVERSATION_MODEL],
      process.env.CONVERSATION_MODEL ?? DEFAULT_CONVERSATION_MODEL,
    ),
    systemPrompt: toStringValue(
      rows[KEY_CONVERSATION_SYSTEM_PROMPT],
      DEFAULT_CONVERSATION_SYSTEM_PROMPT,
    ),
    reasoning: toBoolean(rows[KEY_CONVERSATION_REASONING], false),
  };
}

// 后台展示用：不含明文 key，也不含系统提示词（提示词单独读取以供编辑）。
export async function getConversationStatus(): Promise<ConversationStatus> {
  const config = await getConversationConfig();

  return {
    enabled: config.enabled,
    baseUrl: config.baseUrl,
    model: config.model,
    reasoning: config.reasoning,
    hasKey: Boolean(config.apiKey),
  };
}

export async function getConversationPricing(): Promise<ConversationPricing> {
  const rows = await loadRows();

  return {
    standardCredits: toNonNegativeHalfCredit(
      rows[KEY_CONVERSATION_STANDARD_CREDITS],
      Number(process.env.CONVERSATION_STANDARD_CREDITS) ||
        DEFAULT_CONVERSATION_STANDARD_CREDITS,
    ),
    reasoningCredits: toNonNegativeHalfCredit(
      rows[KEY_CONVERSATION_REASONING_CREDITS],
      Number(process.env.CONVERSATION_REASONING_CREDITS) ||
        DEFAULT_CONVERSATION_REASONING_CREDITS,
    ),
  };
}

export async function setConversationPricing(
  pricing: ConversationPricing,
): Promise<void> {
  // Write the global keys AND the per-model keys so Sol/Luna pick up the
  // same value — they read their own "conversation.sol.credits" key directly
  // and ignore the global standardCredits.
  await Promise.all([
    writeRow(KEY_CONVERSATION_STANDARD_CREDITS, pricing.standardCredits),
    writeRow(KEY_CONVERSATION_REASONING_CREDITS, pricing.reasoningCredits),
    writeRow("conversation.sol.credits", pricing.standardCredits),
    writeRow("conversation.luna.credits", pricing.standardCredits),
  ]);

  cache = null;
}

// 对话系统提示词（独立读取，供对话聊天端使用）。
export async function getConversationSystemPrompt(): Promise<string> {
  const rows = await loadRows();
  return toStringValue(
    rows[KEY_CONVERSATION_SYSTEM_PROMPT],
    DEFAULT_CONVERSATION_SYSTEM_PROMPT,
  );
}

// 出图提示词编译指令（独立读取，供 compile 端点使用）。
export async function getConversationCompileSystemPrompt(): Promise<string> {
  const rows = await loadRows();
  return toStringValue(
    rows[KEY_CONVERSATION_COMPILE_SYSTEM_PROMPT],
    DEFAULT_CONVERSATION_COMPILE_SYSTEM_PROMPT,
  );
}

export interface ConversationConfigUpdate {
  enabled?: boolean;
  baseUrl?: string;
  model?: string;
  systemPrompt?: string;
  compileSystemPrompt?: string;
  reasoning?: boolean;
  // 留空 / undefined 表示不修改；显式空字符串表示清除已存 key。
  apiKey?: string;
}

export async function setConversationConfig(
  update: ConversationConfigUpdate,
): Promise<void> {
  if (update.enabled !== undefined) {
    await writeRow(KEY_CONVERSATION_ENABLED, update.enabled);
  }

  if (update.baseUrl !== undefined) {
    await writeRow(KEY_CONVERSATION_BASE_URL, update.baseUrl.trim());
  }

  if (update.model !== undefined) {
    await writeRow(KEY_CONVERSATION_MODEL, update.model.trim());
  }

  if (update.systemPrompt !== undefined) {
    await writeRow(KEY_CONVERSATION_SYSTEM_PROMPT, update.systemPrompt.trim());
  }

  if (update.compileSystemPrompt !== undefined) {
    await writeRow(
      KEY_CONVERSATION_COMPILE_SYSTEM_PROMPT,
      update.compileSystemPrompt.trim(),
    );
  }

  if (update.reasoning !== undefined) {
    await writeRow(KEY_CONVERSATION_REASONING, update.reasoning);
  }

  if (update.apiKey !== undefined) {
    const trimmed = update.apiKey.trim();
    await writeRow(
      KEY_CONVERSATION_API_KEY_ENC,
      trimmed ? encrypt(trimmed) : "",
    );
  }

  cache = null;
}
