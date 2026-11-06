import { ResponsesAccumulator } from "@/lib/chat-responses-stream";
import type { ChatSearchSource } from "@/lib/chat-search";
import type { UpstreamChatMessage } from "@/lib/chat-upstream";

export const CHAT_AUTO_RETRY_LIMIT = 2;

export function canRetryChatResponse(input: {
  aborted: boolean;
  retries: number;
  state: ResponsesAccumulator;
  reason?: string;
}) {
  if (
    input.aborted ||
    input.retries >= CHAT_AUTO_RETRY_LIMIT ||
    input.state.terminal === "completed" ||
    input.state.orderedParts().some((part) => part.type === "refusal")
  )
    return false;
  const error = input.state.error;
  const detail = [
    error?.code,
    error?.type,
    error?.message,
    error?.reason,
    input.reason,
  ]
    .filter((value) => typeof value === "string")
    .join(" ");
  if (
    /moderation|unsafe|content_filter|policy|invalid_|unsupported|unauthori[sz]ed|forbidden|quota|insufficient/i.test(
      detail,
    )
  )
    return false;
  if (input.state.terminal === "incomplete")
    return (
      /max_output_tokens|max_tokens|length/.test(detail) &&
      Boolean(input.state.rawText.trim())
    );
  if (!input.state.terminal && !input.reason) return true;
  return /Unable to forward upstream stream|upstream_http_(429|500|502|503|504)\b|HTTP_(429|500|502|503|504)\b|server_error|overloaded|rate_limit|headers_timeout|Upstream byte idle timeout|fetch failed|terminated|ECONNRESET|ETIMEDOUT|UND_ERR_/i.test(
    detail,
  );
}

export function waitForChatRecovery(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const stopped = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", stopped);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", stopped);
      resolve();
    }, ms);
    signal.addEventListener("abort", stopped, { once: true });
    if (signal.aborted) stopped();
  });
}

function continuationTail(prefix: string) {
  return prefix.slice(
    Math.max(prefix.lastIndexOf("\n") + 1, prefix.length - 512),
  );
}

export function appendContinuation(prefix: string, suffix: string) {
  if (!prefix) return suffix;
  if (!suffix) return prefix;
  if (suffix.startsWith(prefix)) return suffix;
  const tail = continuationTail(prefix);
  if (tail) {
    const replay = suffix.replace(/^\r?\n/, "");
    if (tail.startsWith(replay)) return prefix;
    if (replay.startsWith(tail)) return prefix + replay.slice(tail.length);
  }
  for (
    let overlap = Math.min(512, prefix.length, suffix.length);
    overlap >= 32;
    overlap--
  )
    if (prefix.endsWith(suffix.slice(0, overlap)))
      return prefix + suffix.slice(overlap);
  return prefix + suffix;
}

export function continuationMessages(
  messages: UpstreamChatMessage[],
  prefix: string,
): UpstreamChatMessage[] {
  if (!prefix.trim()) return messages;
  const tail = continuationTail(prefix);
  return [
    ...messages,
    { role: "assistant", content: prefix },
    {
      role: "user",
      content:
        "The connection was interrupted. Continue the same answer. Do not repeat earlier complete lines, summarize, restart or add a preface. Preserve the existing language, formatting, open Markdown code fence or HTML structure, and complete the original request." +
        (tail
          ? ` The last line was cut mid-line. Begin your output by copying the following unfinished fragment EXACTLY, then finish that same line before proceeding. Do not skip it, add a newline before it, or include these markers.\n<unfinished_fragment>\n${tail}\n</unfinished_fragment>`
          : " Start at the next line after the saved answer."),
    },
  ];
}

export class ChatResponseRecovery {
  state = new ResponsesAccumulator();
  prefix = "";
  private retainedSources: ChatSearchSource[] = [];
  private retainedItems: ReturnType<
    ResponsesAccumulator["checkpoint"]
  >["items"] = [];
  private retainedParts: ReturnType<
    ResponsesAccumulator["checkpoint"]
  >["parts"] = [];
  readonly retries: Array<{
    number: number;
    reason: string;
    prefixCharacters: number;
    usage: Record<string, unknown> | null;
    responseId: string | null;
  }> = [];

  get text() {
    return appendContinuation(
      this.prefix,
      this.state.finalText ?? this.state.rawText,
    );
  }
  get sources() {
    return [
      ...new Map(
        [...this.retainedSources, ...this.state.sources].map((source) => [
          source.url,
          source,
        ]),
      ).values(),
    ];
  }
  get searched() {
    return (
      this.state.searched ||
      this.retainedItems.some(
        (item) =>
          item.type === "web_search_call" && item.status === "completed",
      )
    );
  }

  checkpoint() {
    const current = this.state.checkpoint();
    if (!this.retries.length) return current;
    const offset = this.retainedItems.reduce(
      (max, item) => Math.max(max, item.outputIndex + 1),
      0,
    );
    const id = (value: string) => `recovery-${this.retries.length}:${value}`;
    return {
      ...current,
      items: [
        ...this.retainedItems,
        ...current.items.map((item) => ({
          ...item,
          itemId: id(item.itemId),
          outputIndex: item.outputIndex + offset,
        })),
      ],
      parts: [
        ...this.retainedParts,
        ...current.parts.map((part) => ({
          ...part,
          itemId: id(part.itemId),
          outputIndex: part.outputIndex + offset,
          annotations: part.annotations.map((annotation) => ({
            ...annotation,
            itemId: id(part.itemId),
            outputIndex: part.outputIndex + offset,
          })),
        })),
      ],
      recovery: {
        used: this.retries.length,
        limit: CHAT_AUTO_RETRY_LIMIT,
        continuing: Boolean(this.prefix),
        attempts: this.retries,
      },
    };
  }

  restart(reason: string) {
    const checkpoint = this.checkpoint();
    this.prefix = this.text;
    this.retainedSources = this.sources;
    this.retainedItems = checkpoint.items;
    this.retainedParts = checkpoint.parts;
    this.retries.push({
      number: this.retries.length + 1,
      reason,
      prefixCharacters: this.prefix.length,
      usage: this.state.usage,
      responseId: this.state.responseId,
    });
    this.state = new ResponsesAccumulator();
    this.state.activity = "retrying";
    return this.state;
  }
}
