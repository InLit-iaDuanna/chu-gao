import {
  parseDeckBlock,
  type DeckBlock,
} from "./chat-interactive-blocks";

interface MessageLike {
  role: string;
  content: string;
  chatStatus?: string | null;
}

const DECK_FENCE = /```chugao-deck[^\S\n]*\n([\s\S]*?)\n?```/g;
const HTML_FENCE = /```html[^\S\n]*\n([\s\S]*?)(?:\n```|$)/gi;

/** The outline card a reply showed for this deck id. */
export function findDeckOutline(
  messages: readonly MessageLike[],
  deckId: string,
): { outline: DeckBlock; index: number } | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role !== "assistant" || !message.content.includes("chugao-deck"))
      continue;
    for (const match of message.content.matchAll(DECK_FENCE)) {
      const outline = parseDeckBlock(match[1]);
      if (outline?.id === deckId) return { outline, index };
    }
  }
  return null;
}

/** The last html fence in a reply, including one still being streamed. */
export function lastHtmlBlock(content: string): string | null {
  let last: string | null = null;
  for (const match of content.matchAll(HTML_FENCE)) last = match[1];
  return last?.trim() ? last : null;
}

/**
 * The newest HTML the assistant wrote after the outline, until a newer
 * outline replaces it. That is the editable deck in code mode.
 */
export function findDeckHtml(
  messages: readonly MessageLike[],
  outlineIndex: number,
): { source: string; streaming: boolean } | null {
  for (let index = messages.length - 1; index > outlineIndex; index--) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    if (message.content.includes("chugao-deck")) return null;
    const source = lastHtmlBlock(message.content);
    if (source)
      return {
        source,
        streaming: ["queued", "running"].includes(message.chatStatus ?? ""),
      };
  }
  return null;
}
