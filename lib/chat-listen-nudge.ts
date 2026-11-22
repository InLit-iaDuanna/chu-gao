import { getChatProfile } from "@/lib/chat-profiles";
import { consumeChatSse } from "@/lib/chat-responses-stream";
import { withModelCall, type ModelCallContext } from "@/lib/model-call-log";
import { providerError } from "@/lib/providers/diagnostics";
import {
  anthropicMessagesRequestBody,
  chatCompletionsRequestBody,
  chatEndpoint,
  readAnthropicStreamEvents,
  responsesRequestBody,
  type UpstreamChatMessage,
} from "@/lib/chat-upstream";
import { chatModelCallUsage } from "@/lib/chat-token-billing";
import { isListenSilence } from "@/lib/chat-conversation-mode";
import { callListenFlash } from "@/lib/chat-listen-flash";
import { logger } from "@/lib/logger";

/** What makes Xiie speak up while the user hesitates in 倾听. */
export type ListenNudgeReason = "stalled" | "rewriting";

/** At most this many recent messages, each clipped, go to the model. */
const NUDGE_HISTORY = 12;
const NUDGE_ITEM_CHARS = 600;
export const NUDGE_MAX_CHARS = 40;

export const LISTEN_NUDGE_PROMPT = `你在倾听模式里陪用户聊天：用户想一直说，你大多数时候只听。
现在用户停在输入框里有一阵子了，没有发出新内容（可能在犹豫怎么说，或者写了又删）。你看不到他正在写什么，也不要猜。
请轻轻提一嘴，帮他把话说下去：
- 只说一句，30 个汉字以内，口语，像朋友在旁边小声说的。
- 结合前面已经聊到的内容，不要泛泛地说“有什么想说的吗”。
- 可以降低门槛（比如不用想好再说、说一半也行），或者接住他上一句里没说完的点，给一个很小、好回答的切口。
- 不给建议，不下判断，不分析原因，不替任何人猜想法，不催促，不连问两个问题。
- 只输出这一句话本身，不加引号、表情和任何标记。`;

export function nudgeHistory(
  messages: { role: string; content: string }[],
): UpstreamChatMessage[] {
  const recent = messages
    .filter((message) => message.content.trim())
    .slice(-NUDGE_HISTORY)
    .map((message) => {
      const assistant = message.role.toLowerCase() === "assistant";
      const text = assistant && isListenSilence(message.content)
        ? "（安静地听着，没有开口）"
        : message.content.trim();
      return {
        role: assistant ? ("assistant" as const) : ("user" as const),
        content:
          text.length > NUDGE_ITEM_CHARS
            ? `${text.slice(0, NUDGE_ITEM_CHARS)}…`
            : text,
      };
    });
  // Upstreams want the history to open with the user.
  while (recent[0]?.role === "assistant") recent.shift();
  return recent;
}

export function nudgeInstruction(reason: ListenNudgeReason) {
  return `[系统提示：用户在输入框里${reason === "rewriting" ? "写了又删了好几次" : "停了半分钟没有发送"}。按倾听模式的要求，轻轻提一嘴。]`;
}

/** One clean sentence, or null when the model said nothing usable. */
export function cleanNudge(text: string): string | null {
  const line = text
    .replace(/\[\[[^\]]*\]\]/g, "")
    .trim()
    .split(/\n+/)[0]
    ?.replace(/^["“”'「」\s]+|["“”'「」\s]+$/g, "");
  if (!line) return null;
  return line.length > NUDGE_MAX_CHARS
    ? `${line.slice(0, NUDGE_MAX_CHARS)}…`
    : line;
}

/** The sent history with the hesitation note on the user's last turn. */
export function nudgeInput(
  messages: { role: string; content: string }[],
  reason: ListenNudgeReason,
): UpstreamChatMessage[] {
  const history = nudgeHistory(messages);
  const note = nudgeInstruction(reason);
  const last = history.at(-1);
  // Keep the note attached to the last real message when the user spoke last.
  if (last?.role === "user")
    return [
      ...history.slice(0, -1),
      { role: "user", content: `${String(last.content)}\n\n${note}` },
    ];
  return [...history, { role: "user", content: note }];
}

const record = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export async function generateListenNudge(
  modelId: string,
  messages: { role: string; content: string }[],
  reason: ListenNudgeReason,
  logContext?: ModelCallContext,
): Promise<string | null> {
  const input = nudgeInput(messages, reason);
  // Flash answers in about a second; the main model is the fallback.
  try {
    const quick = await callListenFlash(
      [
        { role: "system", content: LISTEN_NUDGE_PROMPT },
        ...input.map((message) => ({
          role: message.role === "assistant" ? ("assistant" as const) : ("user" as const),
          content: String(message.content),
        })),
      ],
      { maxTokens: 80, operation: "chat.listen_nudge", logContext },
    );
    const line = quick === null ? null : cleanNudge(quick);
    if (line) return line;
  } catch (error) {
    logger.warn(
      { errorName: error instanceof Error ? error.name : "unknown" },
      "Listen nudge on Flash failed; using the chat model",
    );
  }
  const config = await getChatProfile(modelId);
  if (!config.enabled || !config.apiKey) return null;
  const apiKey = config.apiKey;
  const transport = config.transport;
  const body =
    transport === "responses_sse"
      ? responsesRequestBody(config.model, input, LISTEN_NUDGE_PROMPT, "low", {
          stream: true,
          maxOutputTokens: 1_024,
        })
      : transport === "anthropic_messages_sse"
        ? anthropicMessagesRequestBody(
            config.model,
            input,
            LISTEN_NUDGE_PROMPT,
            "low",
            { stream: true, maxOutputTokens: 1_024 },
          )
        : chatCompletionsRequestBody(config.model, input, LISTEN_NUDGE_PROMPT, {
            effort: "low",
            maxOutputTokens: 1_024,
            includeUsage: true,
          });
  const endpoint = chatEndpoint(config.baseUrl, transport);
  const signal = AbortSignal.timeout(30_000);
  return withModelCall<string | null>(
    {
      ...logContext,
      secrets: [apiKey],
      kind: "llm",
      operation: "chat.listen_nudge",
      modelId: config.model,
      providerName: modelId,
      endpoint,
      requestContent: body,
    },
    async (call) => {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          "Accept-Encoding": "identity",
          ...(transport === "anthropic_messages_sse"
            ? { "anthropic-version": "2023-06-01" }
            : {}),
        },
        body: JSON.stringify(body),
        signal,
      });
      call.response(response);
      if (!response.ok)
        throw await providerError(
          response,
          modelId,
          transport === "anthropic_messages_sse"
            ? "anthropic-messages"
            : transport === "responses_sse"
              ? "responses"
              : "chat-completions",
          endpoint,
        );
      if (!response.body) throw new Error("Nudge requires a stream");
      let text = "";
      let usage: Record<string, unknown> | null = null;
      const noteUsage = (value: unknown) => {
        const next = record(value);
        if (next && Object.keys(next).length)
          usage = { ...(usage ?? {}), ...next };
      };
      await consumeChatSse(
        response.body,
        async (value) => {
          const payload = record(value);
          if (!payload || payload.error) throw new Error("Nudge failed");
          if (payload.usage) noteUsage(payload.usage);
          if (record(payload.response)?.usage)
            noteUsage(record(payload.response)!.usage);
          if (record(payload.message)?.usage)
            noteUsage(record(payload.message)!.usage);
          const events =
            transport === "anthropic_messages_sse"
              ? readAnthropicStreamEvents(payload)
              : [payload];
          for (const event of events) {
            const item = record(event);
            if (!item) continue;
            if (transport === "chat_completions_sse") {
              const choice = record(
                (Array.isArray(item.choices) ? item.choices : [])[0],
              );
              const delta = record(choice?.delta);
              if (typeof delta?.content === "string") text += delta.content;
              if (choice?.finish_reason != null) return false;
              continue;
            }
            if (
              item.type === "response.output_text.delta" &&
              typeof item.delta === "string"
            )
              text += item.delta;
            if (
              ["response.failed", "response.incomplete", "error"].includes(
                String(item.type),
              )
            )
              throw new Error("Nudge failed");
            if (item.type === "response.completed") return false;
          }
          if (text.length > 400) return false;
        },
        { signal, idleMs: 30_000 },
      );
      if (usage)
        call.usage("tokenPricing" in config ? chatModelCallUsage(usage) : usage);
      return cleanNudge(text);
    },
  );
}
