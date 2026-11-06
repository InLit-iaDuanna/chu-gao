export interface ChatSearchSource {
  url: string;
  title: string;
}

export class ChatSearchUnavailableError extends Error {
  constructor() {
    super("联网检索未能完成，请稍后重试");
    this.name = "ChatSearchUnavailableError";
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function source(value: unknown): ChatSearchSource | null {
  if (!record(value) || typeof value.url !== "string") return null;
  try {
    const url = new URL(value.url);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.href.length > 2048
    )
      return null;
    return {
      url: url.href.replaceAll("(", "%28").replaceAll(")", "%29"),
      title:
        typeof value.title === "string" && value.title.trim()
          ? value.title.trim().slice(0, 240)
          : url.hostname,
    };
  } catch {
    return null;
  }
}

const escapeLabel = (value: string) => value.replace(/[\\[\]\n\r]/g, " ");

export function appendSearchSources(text: string, sources: ChatSearchSource[]) {
  if (!text.trim() || !sources.length) return text;
  const footer =
    "\n\n### 参考来源\n" +
    sources
      .map(
        (item, index) =>
          `${index + 1}. [${escapeLabel(item.title)}](${item.url})`,
      )
      .join("\n");
  return text.endsWith(footer) ? text : text + footer;
}

export function readCitedResponse(output: unknown[]) {
  const sources: ChatSearchSource[] = [];
  const register = (value: unknown) => {
    const parsed = source(value);
    if (!parsed) return null;
    let index = sources.findIndex((item) => item.url === parsed.url);
    if (index < 0) {
      if (sources.length >= 12) return null;
      index = sources.push(parsed) - 1;
    }
    return { index: index + 1, source: sources[index] };
  };
  const searchCalls = output.filter(
    (item) => record(item) && item.type === "web_search_call",
  );
  const parts: string[] = [];
  for (const item of output) {
    if (
      !record(item) ||
      item.type !== "message" ||
      !Array.isArray(item.content)
    )
      continue;
    for (const part of item.content) {
      if (!record(part)) continue;
      if (part.type === "refusal" && typeof part.refusal === "string") {
        parts.push(part.refusal);
        continue;
      }
      if (part.type !== "output_text" || typeof part.text !== "string")
        continue;
      const text = part.text;
      const annotations = Array.isArray(part.annotations)
        ? part.annotations
        : [];
      const citations = annotations
        .flatMap((annotation) => {
          if (!record(annotation) || annotation.type !== "url_citation")
            return [];
          const registered = register(annotation);
          if (!registered) return [];
          const start = annotation.start_index;
          const end = annotation.end_index;
          if (
            typeof start !== "number" ||
            typeof end !== "number" ||
            !Number.isInteger(start) ||
            !Number.isInteger(end) ||
            start < 0 ||
            end < start ||
            end > text.length
          )
            return [];
          return [{ start, end, ...registered }];
        })
        .sort((a, b) => b.start - a.start);
      let formatted = text;
      let boundary = text.length;
      for (const citation of citations) {
        if (citation.end > boundary) continue;
        const original = text.slice(citation.start, citation.end);
        const marker = `[${citation.index}](${citation.source.url})`;
        const replacement = /[\uE200-\uE2FF]/u.test(original)
          ? marker
          : original.includes(citation.source.url)
            ? original
            : `${original} ${marker}`;
        formatted =
          formatted.slice(0, citation.start) +
          replacement +
          formatted.slice(citation.end);
        boundary = citation.start;
      }
      parts.push(formatted);
    }
  }
  if (!sources.length) {
    for (const item of searchCalls) {
      if (
        !record(item) ||
        !record(item.action) ||
        !Array.isArray(item.action.sources)
      )
        continue;
      for (const candidate of item.action.sources) register(candidate);
    }
  }
  return {
    finalText: appendSearchSources(parts.join(""), sources),
    ...(sources.length ? { sources } : {}),
    ...(searchCalls.length
      ? {
          searched: searchCalls.some(
            (item) => record(item) && item.status === "completed",
          ),
        }
      : {}),
  };
}
