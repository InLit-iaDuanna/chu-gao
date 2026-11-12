import { jsonrepair } from "jsonrepair";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface ModelCallSseFrame {
  event: string;
  data: string;
  value: JsonValue | null;
  done: boolean;
}

export type ParsedModelCallContent =
  | { kind: "empty"; raw: string; value: null }
  | {
      kind: "json";
      raw: string;
      value: JsonValue;
      recovered: boolean;
      truncated: boolean;
    }
  | { kind: "sse"; raw: string; frames: ModelCallSseFrame[] }
  | { kind: "text"; raw: string; value: string };

export function isRecord(value: unknown): value is {
  [key: string]: JsonValue;
} {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Old logs removed escaped quotes after pretty-printing JSON. Each string is
// still on one physical line, so repair those values before closing cut JSON.
function restoreLegacyQuotedLines(raw: string): string {
  return raw
    .split("\n")
    .map((line) => {
      let match = line.match(/^(\s*"[^"\n]+"\s*:\s*")([\s\S]*)$/);
      if (!match) {
        if (/^\s*"[^"\n]+"\s*:/.test(line)) return line;
        match = line.match(/^(\s*")([\s\S]*)$/);
      }
      if (!match) return line;
      let body = match[2];
      const ending = body.match(/"(,?)\s*$/);
      if (ending) body = body.slice(0, -ending[0].length);
      let escaped = "";
      let slashes = 0;
      for (const character of body) {
        if (character === '"' && slashes % 2 === 0) escaped += "\\";
        escaped += character;
        slashes = character === "\\" ? slashes + 1 : 0;
      }
      if (!ending && slashes % 2 === 1) escaped = escaped.slice(0, -1);
      return match[1] + escaped + '"' + (ending?.[1] ?? "");
    })
    .join("\n");
}

function jsonResult(
  raw: string,
  value: JsonValue,
  recovered: boolean,
  legacyTruncated = false,
) {
  const metadata = isRecord(value) && isRecord(value._log) ? value._log : null;
  return {
    kind: "json" as const,
    raw,
    value,
    recovered: recovered || metadata?.recovered === true,
    truncated: metadata?.truncated === true || (recovered && legacyTruncated),
  };
}

export function parseModelCallContent(
  input: string | null | undefined,
): ParsedModelCallContent {
  const raw = input?.trim() ?? "";
  if (!raw) return { kind: "empty", raw, value: null };

  try {
    let value = JSON.parse(raw) as JsonValue;
    for (let depth = 0; depth < 2 && typeof value === "string"; depth++) {
      if (!/^[{\[]/.test(value.trim())) break;
      try {
        value = JSON.parse(value) as JsonValue;
      } catch {
        break;
      }
    }
    return jsonResult(raw, value, false);
  } catch {
    if (/^[{\[]/.test(raw)) {
      for (const candidate of [restoreLegacyQuotedLines(raw), raw]) {
        try {
          return jsonResult(
            raw,
            JSON.parse(jsonrepair(candidate)),
            true,
            input?.length === 24_000 && !/[}\]]$/.test(raw),
          );
        } catch {
          // Leave unrecognized records as text instead of guessing HTML.
        }
      }
    }
  }

  if (/^(?:data|event):/m.test(raw)) {
    const frames: ModelCallSseFrame[] = [];
    for (const block of raw.replace(/\r\n?/g, "\n").split(/\n{2,}/)) {
      const data = block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n")
        .trim();
      if (!data) continue;
      const parsed = data === "[DONE]" ? null : parseModelCallContent(data);
      frames.push({
        event: block.match(/^event:\s*(.*)$/m)?.[1]?.trim() || "message",
        data,
        value: parsed?.kind === "json" ? parsed.value : null,
        done: data === "[DONE]",
      });
    }
    if (frames.length) return { kind: "sse", raw, frames };
  }
  return { kind: "text", raw, value: input ?? "" };
}
