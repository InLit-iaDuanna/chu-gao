import { createHash } from "node:crypto";

import { estimateTextTokens } from "@/lib/chat-context-summary";
import {
  ChatContextError,
  type ChatContextManifest,
  type ChatContextManifestData,
  type Immutable,
} from "@/lib/chat-context-types";

export function contextSourceHash(value: unknown): string {
  const ordered = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(ordered);
    if (input && typeof input === "object") {
      return Object.fromEntries(
        Object.entries(input)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, item]) => [key, ordered(item)]),
      );
    }
    return input;
  };
  return chatRequestHash(JSON.stringify(ordered(value)));
}

/** A string is already serialized wire JSON; objects use JSON.stringify once. */
export function chatRequestHash(body: unknown): string {
  const serialized = typeof body === "string" ? body : JSON.stringify(body);
  if (!serialized) throw new Error("INVALID_CHAT_REQUEST_BODY");
  return createHash("sha256").update(serialized).digest("hex");
}

export function immutableContextManifest<T extends object>(
  value: T,
): Immutable<T> {
  const copy = structuredClone(value);
  const freeze = (item: unknown) => {
    if (!item || typeof item !== "object" || Object.isFrozen(item)) return;
    Object.values(item).forEach(freeze);
    Object.freeze(item);
  };
  freeze(copy);
  return copy as Immutable<T>;
}

/** Count the actual payload's instructions, tools, text and images, not base64 bytes. */
export function estimateChatRequestTokens(body: unknown): number {
  const parsed: unknown = typeof body === "string" ? JSON.parse(body) : body;
  const count = (value: unknown): number => {
    if (typeof value === "string") return estimateTextTokens(value);
    if (Array.isArray(value))
      return value.reduce((total, item) => total + count(item), 0);
    if (!value || typeof value !== "object") return 0;
    const object = value as Record<string, unknown>;
    if (object.type === "input_image" || object.type === "image_url") {
      const image = object.image_url;
      const detail =
        typeof image === "object" && image !== null
          ? (image as Record<string, unknown>).detail
          : object.detail;
      return detail === "low" ? 256 : 1_200;
    }
    return (
      8 +
      Object.values(object).reduce<number>(
        (total, item) => total + count(item),
        0,
      )
    );
  };
  return count(parsed);
}

/** Call with the body actually sent, then record this manifest on the active attempt. */
export function finalizeChatContextManifest(
  manifest: ChatContextManifest,
  body: unknown,
  profileVersion = manifest.profileVersion,
): ChatContextManifest {
  const estimatedTokens = estimateChatRequestTokens(body);
  if (estimatedTokens > manifest.budgetTokens)
    throw new ChatContextError(
      "CHAT_CONTEXT_TOO_LARGE",
      "实际请求超出应用发送预算，原始消息已保留",
      413,
    );
  return immutableContextManifest({
    ...manifest,
    estimatedTokens,
    profileVersion,
    requestHash: chatRequestHash(body),
  } as ChatContextManifestData);
}
