const ANIMAL_CHANNEL_ALIASES = [
  "雪豹",
  "海豚",
  "雨燕",
  "赤狐",
  "山雀",
  "云鹿",
  "银鹭",
  "白鹤",
  "松貂",
  "岩羊",
  "蓝鲸",
  "金雕",
  "林鸮",
  "游隼",
  "锦鲤",
  "玄猫",
  "灰狼",
  "海獭",
  "灵猫",
  "北极狐",
  "月熊",
  "雪鸮",
  "红隼",
  "黑豹",
  "银狐",
  "鲸鲨",
  "白鲸",
  "朱鹮",
  "水獭",
  "云豹",
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
): string | null {
  const source = providerAccountName?.trim() || providerName?.trim();

  if (!source) {
    return null;
  }

  return ANIMAL_CHANNEL_ALIASES[
    hashChannelName(source) % ANIMAL_CHANNEL_ALIASES.length
  ];
}
