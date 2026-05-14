import {
  normalizeProviderChannelBaseUrl,
} from "@/lib/provider-channels";

const AQUATIC_CHANNEL_ALIASES = [
  "海豚",
  "蓝鲸",
  "白鲸",
  "海獭",
  "鲸鲨",
  "锦鲤",
  "水獭",
  "海马",
  "飞鱼",
  "海豹",
  "章鱼",
  "海狮",
  "海象",
  "珊瑚",
  "水母",
  "海燕",
  "鳐鱼",
  "河豚",
  "海鸥",
  "青鳗",
] as const;

const TERRESTRIAL_CHANNEL_ALIASES = [
  "雪豹",
  "赤狐",
  "灰狼",
  "云豹",
  "月熊",
  "岩羊",
  "松貂",
  "灵猫",
  "北极狐",
  "黑豹",
  "银狐",
  "山雀",
  "雨燕",
  "白鹤",
  "金雕",
  "林鸮",
  "游隼",
  "朱鹮",
  "云鹿",
  "玄猫",
] as const;

function hashChannelName(value: string): number {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return Math.abs(hash >>> 0);
}

export function publicChannelAlias(
  providerAccountName?: string | null,
  providerName?: string | null,
  baseUrl?: string | null,
): string | null {
  const source = providerAccountName?.trim() || providerName?.trim();

  if (!source) {
    return null;
  }

  const normalizedBaseUrl = normalizeProviderChannelBaseUrl(baseUrl);
  const aliasPool =
    normalizedBaseUrl === "https://lucen.cc"
      ? AQUATIC_CHANNEL_ALIASES
      : normalizedBaseUrl === "https://api.xpzhao.top"
        ? TERRESTRIAL_CHANNEL_ALIASES
        : [...AQUATIC_CHANNEL_ALIASES, ...TERRESTRIAL_CHANNEL_ALIASES];

  return aliasPool[
    hashChannelName(`${source}:${normalizedBaseUrl ?? ""}`) % aliasPool.length
  ];
}
