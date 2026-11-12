export interface StructuredChatMemory {
  version: 1;
  goals: string[];
  facts: string[];
  constraints: string[];
  decisions: string[];
  references: string[];
  pending: string[];
}

function cleanMemoryItems(value: unknown) {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 32)
    : [];
}

export function parseStructuredChatMemory(
  value: unknown,
): StructuredChatMemory | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (source.version !== 1) return null;
  return {
    version: 1,
    goals: cleanMemoryItems(source.goals),
    facts: cleanMemoryItems(source.facts),
    constraints: cleanMemoryItems(source.constraints),
    decisions: cleanMemoryItems(source.decisions),
    references: cleanMemoryItems(source.references),
    pending: cleanMemoryItems(source.pending),
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
