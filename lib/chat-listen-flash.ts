import { DEFAULT_DEEPSEEK_BASE_URL, getDeepSeekConfig } from "@/lib/ai-config";
import {
  parseReaction,
  reactMessages,
  type ListenReaction,
} from "@/lib/chat-listen-react";
import { withModelCall, type ModelCallContext } from "@/lib/model-call-log";
import { providerError } from "@/lib/providers/diagnostics";

/**
 * 倾听's quick voice: DeepSeek V4.1 Flash with thinking off answers one short
 * line in about a second, fast enough to react while the user pauses. It
 * reuses the DeepSeek key from the admin settings; the "enabled" switch there
 * belongs to the image prompt optimizer and is not needed here.
 */
export const LISTEN_FLASH_MODEL = "deepseek-flash";
const FLASH_TIMEOUT_MS = 6_000;

export type FlashMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export function flashEndpoint(baseUrl: string) {
  const base = (baseUrl.trim() || DEFAULT_DEEPSEEK_BASE_URL).replace(/\/+$/, "");
  return /\/v\d+$/.test(base)
    ? `${base}/chat/completions`
    : `${base}/v1/chat/completions`;
}

export function flashRequestBody(messages: FlashMessage[], maxTokens: number) {
  return {
    model: LISTEN_FLASH_MODEL,
    messages,
    max_tokens: maxTokens,
    temperature: 0.8,
    stream: false,
    // With thinking on, a small budget goes to a monologue and no answer.
    thinking: { type: "disabled" },
  };
}

/**
 * One short answer from Flash; null when no DeepSeek key is set. Upstream
 * errors throw, so callers can fall back.
 */
export async function callListenFlash(
  messages: FlashMessage[],
  options: {
    maxTokens: number;
    operation: string;
    logContext?: ModelCallContext;
    timeoutMs?: number;
  },
): Promise<string | null> {
  const config = await getDeepSeekConfig();
  if (!config.apiKey) return null;
  const apiKey = config.apiKey;
  const endpoint = flashEndpoint(config.baseUrl);
  const body = flashRequestBody(messages, options.maxTokens);
  return withModelCall<string>(
    {
      ...options.logContext,
      secrets: [apiKey],
      kind: "llm",
      operation: options.operation,
      modelId: LISTEN_FLASH_MODEL,
      providerName: "DeepSeek",
      endpoint,
      requestContent: body,
    },
    async (call) => {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(options.timeoutMs ?? FLASH_TIMEOUT_MS),
      });
      call.response(response);
      if (!response.ok)
        throw await providerError(response, "DeepSeek", "chat-completions", endpoint);
      const data = (await response.json()) as {
        choices?: { message?: { content?: unknown } }[];
      };
      call.usage(data);
      const content = data.choices?.[0]?.message?.content;
      return typeof content === "string" ? content.trim() : "";
    },
  );
}

/** Xiie's reaction to the line just said; null when Flash is not set up. */
export async function generateListenReaction(
  history: { role: string; content: string }[],
  lines: string[],
  logContext?: ModelCallContext,
  murmurs: string[] = [],
): Promise<{ reaction: ListenReaction; line: string | null } | null> {
  const text = await callListenFlash(reactMessages(history, lines, murmurs), {
    maxTokens: 24,
    operation: "chat.listen_react",
    logContext,
  });
  if (text === null) return null;
  const result = parseReaction(text);
  // Saying the same thing twice in one stretch sounds like a machine.
  return result.line && murmurs.includes(result.line)
    ? { ...result, line: null }
    : result;
}
