import { getSystemConfigValue } from "@/lib/system-config";

export async function isPromptBlocked(prompt: string): Promise<boolean> {
  const enabled = await getSystemConfigValue("moderation.enabled");

  if (!enabled) {
    return false;
  }

  const keywords = await getSystemConfigValue("moderation.blockedKeywords");
  const normalized = prompt.toLowerCase();

  return keywords.some((keyword) => normalized.includes(keyword.toLowerCase()));
}
