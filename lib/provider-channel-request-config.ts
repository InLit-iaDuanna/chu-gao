// 渠道请求格式配置：按渠道 baseUrl 在 SystemConfig 中存储「结构化字段 + 可选原始请求体模板」。
// 沿用渠道显示名的存储模式（SystemConfig 单键 + baseUrl 映射），免数据库迁移。
// 读取仅服务端使用；对外不暴露明文（本身不含密钥）。

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import {
  IMAGE_SIZE_OPTIONS,
  RESPONSE_FORMAT_OPTIONS,
} from "@/lib/models/options";
import type {
  ImageQuality,
  ImageSize,
  ResponseFormat,
} from "@/lib/models/types";
import { normalizeProviderChannelBaseUrl } from "@/lib/provider-channels";

export const CHANNEL_REQUEST_CONFIG_KEY = "provider.channelRequestConfig";

export interface ChannelRequestConfig {
  supportsGif?: boolean;
  // 该渠道允许的出图尺寸（8 个的子集）；空数组 = 全部允许。
  sizes: ImageSize[];
  // 出图质量（当前仅 auto）。
  quality: ImageQuality;
  // 该渠道默认返回格式。
  responseFormat: ResponseFormat;
  // 可选：原始请求体模板（JSON 字符串，支持 {model}/{prompt}/{size}/{quality}/
  // {response_format}/{n}/{output_format}/{background} 占位符）。留空 = 用结构化字段自动拼。
  bodyTemplate?: string;
}

export const DEFAULT_CHANNEL_REQUEST_CONFIG: ChannelRequestConfig = {
  sizes: [],
  quality: "auto",
  responseFormat: "b64_json",
};

const SIZE_SET = new Set<string>(IMAGE_SIZE_OPTIONS);
const RESPONSE_FORMAT_SET = new Set<string>(RESPONSE_FORMAT_OPTIONS);

export type ChannelRequestConfigMap = Record<string, ChannelRequestConfig>;

function parseConfig(value: unknown): ChannelRequestConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_CHANNEL_REQUEST_CONFIG };
  }

  const record = value as Record<string, unknown>;
  const sizes = Array.isArray(record.sizes)
    ? record.sizes.filter(
        (item, index, arr): item is ImageSize =>
          typeof item === "string" &&
          SIZE_SET.has(item) &&
          arr.indexOf(item) === index,
      )
    : [];
  const responseFormat =
    typeof record.responseFormat === "string" &&
    RESPONSE_FORMAT_SET.has(record.responseFormat)
      ? (record.responseFormat as ResponseFormat)
      : DEFAULT_CHANNEL_REQUEST_CONFIG.responseFormat;
  const bodyTemplate =
    typeof record.bodyTemplate === "string" && record.bodyTemplate.trim()
      ? record.bodyTemplate
      : undefined;

  return {
    sizes,
    supportsGif: record.supportsGif === true,
    quality: "auto",
    responseFormat,
    bodyTemplate,
  };
}

function parseMap(value: unknown): ChannelRequestConfigMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .map(([baseUrl, config]) => {
      const normalized = normalizeProviderChannelBaseUrl(baseUrl);
      return normalized ? ([normalized, parseConfig(config)] as const) : null;
    })
    .filter((entry): entry is readonly [string, ChannelRequestConfig] =>
      Boolean(entry),
    );

  return Object.fromEntries(entries);
}

let cache: { expiresAt: number; map: ChannelRequestConfigMap } | null = null;

export function invalidateChannelRequestConfigCache(): void {
  cache = null;
}

export async function getChannelRequestConfigMap(): Promise<ChannelRequestConfigMap> {
  if (cache && cache.expiresAt > Date.now()) {
    return cache.map;
  }

  if (!process.env.DATABASE_URL) {
    return {};
  }

  const row = await db.systemConfig.findUnique({
    where: { key: CHANNEL_REQUEST_CONFIG_KEY },
    select: { value: true },
  });
  const map = parseMap(row?.value);

  cache = { expiresAt: Date.now() + 60_000, map };
  return map;
}

export async function getChannelRequestConfig(
  baseUrl?: string | null,
): Promise<ChannelRequestConfig> {
  const normalized = normalizeProviderChannelBaseUrl(baseUrl);

  if (!normalized) {
    return { ...DEFAULT_CHANNEL_REQUEST_CONFIG };
  }

  const map = await getChannelRequestConfigMap();
  return map[normalized] ?? { ...DEFAULT_CHANNEL_REQUEST_CONFIG };
}

export async function providerSupportsGif(baseUrl: string): Promise<boolean> {
  return (await getChannelRequestConfig(baseUrl)).supportsGif === true;
}

export async function setChannelRequestConfig(
  baseUrl: string,
  config: ChannelRequestConfig,
): Promise<ChannelRequestConfigMap> {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is required to update channel request config.",
    );
  }

  const normalized = normalizeProviderChannelBaseUrl(baseUrl);

  if (!normalized) {
    throw new Error("Invalid channel baseUrl.");
  }

  const current = await getChannelRequestConfigMap();
  const next: ChannelRequestConfigMap = {
    ...current,
    [normalized]: parseConfig(config),
  };

  const jsonValue = next as unknown as Prisma.InputJsonValue;

  await db.systemConfig.upsert({
    where: { key: CHANNEL_REQUEST_CONFIG_KEY },
    create: { key: CHANNEL_REQUEST_CONFIG_KEY, value: jsonValue },
    update: { value: jsonValue },
  });

  invalidateChannelRequestConfigCache();
  return next;
}

// 用请求值渲染原始模板。占位符以 {key} 形式出现在 JSON 文本中；
// 替换后做一次 JSON.parse。解析失败返回 null，由调用方回退结构化拼装。
export function renderBodyTemplate(
  template: string,
  vars: Record<string, string | number>,
): Record<string, unknown> | null {
  let rendered = template;

  for (const [key, value] of Object.entries(vars)) {
    const token = `{${key}}`;
    const replacement =
      typeof value === "number"
        ? String(value)
        : JSON.stringify(value).slice(1, -1);
    rendered = rendered.split(token).join(replacement);
  }

  try {
    const parsed = JSON.parse(rendered) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
