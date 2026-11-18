export interface StructuredChatMemory {
  version: 1;
  goals: string[];
  facts: string[];
  constraints: string[];
  decisions: string[];
  references: string[];
  pending: string[];
}

/**
 * Code-side forgetting (OpenHands/Goose style): the model is asked to prune,
 * but dedupe and per-section caps are enforced here so incremental memories
 * cannot grow without bound. Lists are oldest-first, so caps keep the tail.
 */
const SECTION_LIMITS = {
  goals: 8,
  facts: 24,
  constraints: 16,
  decisions: 16,
  references: 12,
  pending: 6,
} as const;
const MAX_ITEM_CHARS = 200;

function cleanMemoryItems(value: unknown, limit: number) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const items: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const text = item.trim();
    const key = text.replace(/[\s\p{P}]+/gu, "").toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    items.push(
      text.length > MAX_ITEM_CHARS ? `${text.slice(0, MAX_ITEM_CHARS)}…` : text,
    );
  }
  return items.slice(-limit);
}

export function parseStructuredChatMemory(
  value: unknown,
): StructuredChatMemory | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (source.version !== 1) return null;
  return {
    version: 1,
    goals: cleanMemoryItems(source.goals, SECTION_LIMITS.goals),
    facts: cleanMemoryItems(source.facts, SECTION_LIMITS.facts),
    constraints: cleanMemoryItems(
      source.constraints,
      SECTION_LIMITS.constraints,
    ),
    decisions: cleanMemoryItems(source.decisions, SECTION_LIMITS.decisions),
    references: cleanMemoryItems(
      source.references,
      SECTION_LIMITS.references,
    ),
    pending: cleanMemoryItems(source.pending, SECTION_LIMITS.pending),
  };
}

export function normalizeStructuredChatMemory(text: string): string {
  try {
    const memory = parseStructuredChatMemory(JSON.parse(text));
    return memory ? JSON.stringify(memory) : text.trim();
  } catch {
    return text.trim();
  }
}

export function renderStructuredChatMemory(text: string): string {
  let memory: StructuredChatMemory | null = null;
  try {
    memory = parseStructuredChatMemory(JSON.parse(text));
  } catch {
    /* Existing snapshots may contain the previous plain-text summary. */
  }
  if (!memory) return text;
  const labels: Array<[keyof Omit<StructuredChatMemory, "version">, string]> = [
    ["goals", "目标"],
    ["facts", "事实"],
    ["constraints", "约束"],
    ["decisions", "决定"],
    ["references", "参考图"],
    ["pending", "待处理"],
  ];
  const sections = labels
    .filter(([key]) => memory![key].length)
    .map(
      ([key, label]) =>
        label + "：\n" + memory![key].map((item) => "- " + item).join("\n"),
    );
  return sections.length ? sections.join("\n") : "暂无结构化记忆";
}
