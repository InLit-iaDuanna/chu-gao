/**
 * Interactive fenced blocks appended by the chat agent's terminal tools.
 *
 * ```chugao-ask   {"question","options":[{label,description?}],"multiple"}
 * ```chugao-next  {"options":[string]}
 * ```chugao-deck  {"id","title","style","slides":[{title,points,visual?}]}
 *
 * Pure helpers shared by rendering, copying and previews. Invalid blocks are
 * removed without being shown; unclosed blocks (while streaming or after a
 * truncated preview) are hidden from the opening fence to the end.
 *
 * A listen-mode reply that is only the silence marker has an empty body and
 * `listening: true`.
 */

import { LISTEN_SILENCE_MARKER } from "@/lib/chat-conversation-mode";

export interface AskOption {
  label: string;
  description?: string;
}

export interface AskBlock {
  question: string;
  options: AskOption[];
  multiple: boolean;
}

export interface NextBlock {
  options: string[];
}

export interface DeckBlockSlide {
  title: string;
  points: string[];
  visual?: string;
}

export interface DeckBlock {
  id: string;
  title: string;
  style: string;
  slides: DeckBlockSlide[];
}

export interface InteractiveBlocks {
  /** Content with every interactive block (valid, invalid or unclosed) removed. */
  body: string;
  ask?: AskBlock;
  next?: NextBlock;
  deck?: DeckBlock;
  /** True when an unclosed or partially typed interactive fence was hidden. */
  incomplete: boolean;
  /** 倾听: the assistant chose not to speak this turn. */
  listening?: boolean;
}

export const ASK_LANGUAGE = "chugao-ask";
export const NEXT_LANGUAGE = "chugao-next";
export const DECK_LANGUAGE = "chugao-deck";
export const ASK_ANSWER_SEPARATOR = "、";

const LIMITS = {
  question: 200,
  askOptionsMin: 2,
  askOptionsMax: 4,
  label: 40,
  description: 80,
  nextOptionsMin: 1,
  nextOptionsMax: 3,
  nextOption: 30,
} as const;

/** Length in code points, so emoji or rare CJK count as one character. */
function length(value: string): number {
  return Array.from(value).length;
}

function boundedText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && length(text) <= max ? text : null;
}

function parseJson(source: string): unknown {
  try {
    return JSON.parse(source);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseAskBlock(source: string): AskBlock | null {
  const data = parseJson(source);
  if (!isRecord(data)) return null;
  const question = boundedText(data.question, LIMITS.question);
  if (!question) return null;
  if (data.multiple !== undefined && typeof data.multiple !== "boolean")
    return null;
  const raw = data.options;
  if (
    !Array.isArray(raw) ||
    raw.length < LIMITS.askOptionsMin ||
    raw.length > LIMITS.askOptionsMax
  )
    return null;
  const options: AskOption[] = [];
  for (const item of raw) {
    if (!isRecord(item)) return null;
    const label = boundedText(item.label, LIMITS.label);
    if (!label) return null;
    let description: string | undefined;
    if (item.description !== undefined && item.description !== null) {
      if (typeof item.description !== "string") return null;
      const text = item.description.trim();
      if (length(text) > LIMITS.description) return null;
      description = text || undefined;
    }
    options.push(description ? { label, description } : { label });
  }
  return { question, options, multiple: data.multiple === true };
}

export function parseNextBlock(source: string): NextBlock | null {
  const data = parseJson(source);
  if (!isRecord(data)) return null;
  const raw = data.options;
  if (
    !Array.isArray(raw) ||
    raw.length < LIMITS.nextOptionsMin ||
    raw.length > LIMITS.nextOptionsMax
  )
    return null;
  const options: string[] = [];
  for (const item of raw) {
    const text = boundedText(item, LIMITS.nextOption);
    if (!text) return null;
    options.push(text);
  }
  return { options };
}

export function parseDeckBlock(source: string): DeckBlock | null {
  const data = parseJson(source);
  if (!isRecord(data)) return null;
  const id = boundedText(data.id, 64);
  if (!id || !Array.isArray(data.slides)) return null;
  const slides: DeckBlockSlide[] = [];
  for (const item of data.slides.slice(0, 30)) {
    if (!isRecord(item)) return null;
    const title = boundedText(item.title, 80);
    if (!title) return null;
    const points = Array.isArray(item.points)
      ? item.points
          .map((point) => boundedText(point, 120))
          .filter((point): point is string => Boolean(point))
          .slice(0, 8)
      : [];
    const visual = boundedText(item.visual, 160) ?? undefined;
    slides.push(visual ? { title, points, visual } : { title, points });
  }
  if (!slides.length) return null;
  return {
    id,
    title: boundedText(data.title, 80) ?? slides[0].title,
    style: boundedText(data.style, 600) ?? "",
    slides,
  };
}

const LANGUAGE = "chugao-(?:ask|next|deck)";
/** A complete block: opening fence, body, and a closing fence of the same kind at least as long. */
const CLOSED_BLOCK = new RegExp(
  "(^|\\n)[ \\t]{0,3}(`{3,}|~{3,})[ \\t]*(" +
    LANGUAGE +
    ")[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n[ \\t]{0,3}\\2(?:`*|~*)[ \\t]*(?=\\r?\\n|$)",
  "g",
);
/** An opening fence whose closing fence has not arrived (yet). */
const OPEN_FENCE = new RegExp(
  "(^|\\n)[ \\t]{0,3}(?:`{3,}|~{3,})[ \\t]*" + LANGUAGE + "(?![\\w-])",
);
/** A trailing line that may still become an interactive fence while streaming. */
const PARTIAL_FENCE = /(^|\n)[ \t]{0,3}(?:`{3,}|~{3,})[ \t]*([\w-]+)$/;

function isPartialLanguage(value: string): boolean {
  return [ASK_LANGUAGE, NEXT_LANGUAGE, DECK_LANGUAGE].some(
    (language) => language.startsWith(value) && value.length >= 1,
  );
}

export function parseInteractiveBlocks(
  content: string,
  options: { streaming?: boolean } = {},
): InteractiveBlocks {
  const trimmed = content.trim();
  if (trimmed === LISTEN_SILENCE_MARKER)
    return { body: "", incomplete: false, listening: true };
  // While streaming, never flash the marker as it is typed.
  if (
    options.streaming &&
    trimmed.startsWith("[[") &&
    LISTEN_SILENCE_MARKER.startsWith(trimmed)
  )
    return { body: "", incomplete: true };
  if (!content.includes("chugao-") && !options.streaming)
    return { body: content, incomplete: false };
  let ask: AskBlock | null = null;
  let next: NextBlock | null = null;
  let deck: DeckBlock | null = null;
  let changed = false;
  let body = "";
  let cursor = 0;
  // The first valid block of each kind wins; every block is removed either way.
  for (const match of content.matchAll(CLOSED_BLOCK)) {
    const [whole, lead, , language, source] = match;
    const start = match.index ?? 0;
    body += content.slice(cursor, start) + lead;
    cursor = start + whole.length;
    changed = true;
    if (language === ASK_LANGUAGE) ask = ask ?? parseAskBlock(source);
    else if (language === DECK_LANGUAGE) deck = deck ?? parseDeckBlock(source);
    else next = next ?? parseNextBlock(source);
  }
  body += content.slice(cursor);
  let incomplete = false;
  const open = OPEN_FENCE.exec(body);
  if (open) {
    body = body.slice(0, open.index + open[1].length);
    changed = true;
    incomplete = true;
  } else if (options.streaming) {
    const partial = PARTIAL_FENCE.exec(body);
    if (partial && isPartialLanguage(partial[2])) {
      body = body.slice(0, partial.index + partial[1].length);
      changed = true;
      incomplete = true;
    }
  }
  if (changed) body = body.replace(/\s+$/, "");
  return {
    body,
    ...(ask ? { ask } : {}),
    ...(next ? { next } : {}),
    ...(deck ? { deck } : {}),
    incomplete,
  };
}

/** Content for copy, edit and previews: interactive blocks removed. */
export function stripInteractiveBlocks(content: string): string {
  return parseInteractiveBlocks(content).body;
}

/** Which options a later user reply selected, if it exactly matches one or a joined set. */
export function selectedAskOptions(
  ask: AskBlock,
  answer: string | null | undefined,
): Set<string> {
  const text = answer?.trim();
  const labels = new Set(ask.options.map((option) => option.label));
  if (!text) return new Set();
  if (labels.has(text)) return new Set([text]);
  if (!ask.multiple) return new Set();
  const parts = text.split(ASK_ANSWER_SEPARATOR).map((part) => part.trim());
  return parts.length > 1 && parts.every((part) => labels.has(part))
    ? new Set(parts)
    : new Set();
}

/** The text sent for a multiple-choice answer, in the card's option order. */
export function joinAskAnswer(ask: AskBlock, selected: Iterable<string>): string {
  const chosen = new Set(selected);
  return ask.options
    .filter((option) => chosen.has(option.label))
    .map((option) => option.label)
    .join(ASK_ANSWER_SEPARATOR);
}
