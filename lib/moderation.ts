import {
  DEFAULT_BLOCKED_KEYWORDS,
  getSystemConfigValue,
} from "@/lib/system-config";

function normalizeKeywordList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export async function isPromptBlocked(prompt: string): Promise<boolean> {
  const enabled = await getSystemConfigValue("moderation.enabled");

  if (!enabled) {
    return false;
  }

  const configuredKeywords = normalizeKeywordList(
    await getSystemConfigValue("moderation.blockedKeywords"),
  );
  const keywords = Array.from(
    new Set([...DEFAULT_BLOCKED_KEYWORDS, ...configuredKeywords]),
  );
  const normalized = prompt.toLowerCase();

  return keywords.some((keyword) =>
    normalized.includes(keyword.trim().toLowerCase()),
  );
}
