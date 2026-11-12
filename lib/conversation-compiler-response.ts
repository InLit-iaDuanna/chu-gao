type CompilerField = "prompt" | "assistantMessage" | "shouldGenerate";

const QUOTED_FIELD_PATTERN =
  /(["'])(prompt|assistantMessage|shouldGenerate)\1\s*:/g;
const UNQUOTED_FIELD_PATTERN =
  /\b(prompt|assistantMessage|shouldGenerate)\s*:/g;

function responseCandidates(text: string): string[] {
  const trimmed = text.trim();
  const candidates = [trimmed];
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  if (unfenced !== trimmed) {
    candidates.push(unfenced);
  }

  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");

  if (start >= 0 && end > start) {
    const objectText = unfenced.slice(start, end + 1).trim();
    if (!candidates.includes(objectText)) {
      candidates.push(objectText);
    }
  }

  return candidates;
}

function decodeLooseString(value: string): string {
  let decoded = "";

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if (character !== "\\") {
      decoded += character;
      continue;
    }

    const next = value[index + 1];
    if (!next) {
      decoded += "\\";
      continue;
    }

    const escapes: Record<string, string> = {
      '"': '"',
      "'": "'",
      "\\": "\\",
      "/": "/",
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
    };

    if (
      next === "u" &&
      /^[0-9a-f]{4}$/i.test(value.slice(index + 2, index + 6))
    ) {
      decoded += String.fromCharCode(
        Number.parseInt(value.slice(index + 2, index + 6), 16),
      );
      index += 5;
      continue;
    }

    decoded += escapes[next] ?? next;
    index += 1;
  }

  return decoded;
}

function parseLooseCompilerObject(
  source: string,
): Record<string, unknown> | null {
  const quotedMatches = [...source.matchAll(QUOTED_FIELD_PATTERN)].map(
    (match) => ({
      field: match[2] as CompilerField,
      start: match.index ?? 0,
      valueStart: (match.index ?? 0) + match[0].length,
    }),
  );
  const matches = quotedMatches.length
    ? quotedMatches
    : [...source.matchAll(UNQUOTED_FIELD_PATTERN)].map((match) => ({
        field: match[1] as CompilerField,
        start: match.index ?? 0,
        valueStart: (match.index ?? 0) + match[0].length,
      }));

  if (!matches.length) {
    return null;
  }

  const value: Record<string, unknown> = {};

  for (const [index, match] of matches.entries()) {
    const nextStart = matches[index + 1]?.start ?? source.length;
    let raw = source.slice(match.valueStart, nextStart).trim();
    raw = raw.replace(/[,}\s]+$/g, "").trim();

    if (match.field === "shouldGenerate") {
      const booleanMatch = raw.match(/^(?:["']?)(true|false)(?:["']?)$/i);
      if (booleanMatch) {
        value[match.field] = booleanMatch[1].toLowerCase() === "true";
      }
      continue;
    }

    if (
      (raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"))
    ) {
      raw = raw.slice(1, -1);
    } else if (raw.startsWith('"') || raw.startsWith("'")) {
      raw = raw.slice(1);
    }

    value[match.field] = decodeLooseString(raw.trim());
  }

  return typeof value.prompt === "string" &&
    typeof value.assistantMessage === "string"
    ? value
    : null;
}

export function parseCompilerResponse(text: string): unknown {
  let lastError: unknown = new Error("compiler returned non-json response");

  for (const candidate of responseCandidates(text)) {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      lastError = error;
      const recovered = parseLooseCompilerObject(candidate);
      if (recovered) {
        return recovered;
      }
    }
  }

  throw lastError;
}

export function extractChatContent(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) {
    return "";
  }

  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return "";
  }

  const message = (choices[0] as { message?: { content?: unknown } }).message;
  const content = message?.content;

  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => {
      if (typeof part !== "object" || part === null) {
        return "";
      }
      const textPart = (part as { text?: unknown }).text;
      return typeof textPart === "string" ? textPart : "";
    })
    .join("");
}
