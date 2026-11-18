import type { ChatSearchSource } from "@/lib/chat-search";

/**
 * Web search for the Chat Completions models (Opus).
 *
 * Sol and Luna get search from the Responses API itself. The Opus relay has no
 * such tool, so the application runs the search and hands the model a compact
 * digest of what came back. Measured on the relay (2026-11-13): it does search
 * the live web, results are usable for news and facts, and weak for shopping or
 * entertainment queries — hence the honesty clause in the output.
 */

// The relay answers a tool literally named "web_search" itself with canned
// search text, so the application tool uses a name it leaves alone.
export const CHAT_SEARCH_TOOL_NAME = "search_web";
/** At most this many searches in one turn; each is a paid relay request. */
export const CHAT_SEARCH_LIMIT = 2;

export const CHAT_SEARCH_TOOL_DESCRIPTION =
  "联网检索最新信息。用户问到近期事件、实时数据、价格、版本、政策，或你拿不准的事实时用；常识、创作和纯推理的问题不必检索。query 写关键词，不要整句。返回若干来源和摘录，但摘录可能不准确；没有可用结果时如实说明，不要编造。";

export const CHAT_SEARCH_TOOL = {
  type: "function",
  function: {
    name: CHAT_SEARCH_TOOL_NAME,
    description: CHAT_SEARCH_TOOL_DESCRIPTION,
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "检索关键词，像人在搜索框里输入的那样：2~8 个词，可以是中文或英文，不要带引号、句子或标点堆叠。需要多角度时换一组词再搜一次。",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
} as const;

/** Anthropic Messages shape of the same tool, for relay chat models. */
export const CHAT_SEARCH_ANTHROPIC_TOOL = {
  name: CHAT_SEARCH_TOOL_NAME,
  description: CHAT_SEARCH_TOOL_DESCRIPTION,
  input_schema: CHAT_SEARCH_TOOL.function.parameters,
} as const;

export interface ChatSearchOutcome {
  ok: boolean;
  sources: ChatSearchSource[];
  /** What the model reads: sources plus excerpts, or why there is nothing. */
  output: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toSource(value: unknown): ChatSearchSource | null {
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
    const title =
      typeof value.title === "string" && value.title.trim()
        ? value.title.trim().replace(/\s+/g, " ").slice(0, 160)
        : url.hostname;
    return { url: url.href, title };
  } catch {
    return null;
  }
}

/** Pull sources and excerpt text out of one /v1/messages answer. */
export function readSearchAnswer(payload: unknown) {
  const content = record(payload) && Array.isArray(payload.content)
    ? payload.content
    : [];
  const sources: ChatSearchSource[] = [];
  const excerpts: string[] = [];
  for (const block of content) {
    if (!record(block)) continue;
    if (block.type === "web_search_tool_result") {
      const items = Array.isArray(block.content) ? block.content : [];
      for (const item of items) {
        const parsed = toSource(item);
        if (!parsed || sources.some((known) => known.url === parsed.url))
          continue;
        if (sources.length >= 6) break;
        sources.push(parsed);
      }
    } else if (block.type === "text" && typeof block.text === "string") {
      excerpts.push(block.text);
    }
  }
  const text = excerpts
    .join("\n")
    .split("\n")
    .filter((line) => !/^I'll search for /.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 2_400);
  return { sources, text };
}

const HONESTY =
  "以上是检索到的外部资料，可能过时、重复或与问题无关。只引用确实相关的内容，正文里用 [标题](链接) 标注来源；没有一个相关的话，直接说明没有找到可靠来源，不要编造。";

export function chatSearchToolOutput(
  query: string,
  { sources, text }: { sources: ChatSearchSource[]; text: string },
) {
  const lines = [`[联网检索结果] 查询：${query}`];
  if (sources.length) {
    lines.push(
      "来源：",
      ...sources.map((item, index) => `${index + 1}. ${item.title} | ${item.url}`),
    );
  }
  if (text) lines.push("摘录：", text);
  lines.push(HONESTY);
  return lines.join("\n");
}

function messagesEndpoint(baseUrl: string) {
  const root = baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
  return `${root}/v1/messages`;
}

/**
 * Run one search on the relay and return what the model should read. Never
 * throws: a failed search is reported to the model, which can still answer.
 */
export async function runChatSearchTool(
  rawQuery: string,
  options: {
    baseUrl: string;
    apiKey: string;
    model: string;
    signal?: AbortSignal;
    timeoutMs?: number;
  },
): Promise<ChatSearchOutcome> {
  const query = rawQuery.trim().replace(/\s+/g, " ").slice(0, 200);
  if (query.length < 2)
    return {
      ok: false,
      sources: [],
      output: "[联网检索结果] 检索词太短，没有执行。请用两三个关键词重新检索，或直接回答用户。",
    };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetch(messagesEndpoint(options.baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": options.apiKey,
        authorization: `Bearer ${options.apiKey}`,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: options.model,
        max_tokens: 1_200,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 1 }],
        messages: [{ role: "user", content: query }],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return {
        ok: false,
        sources: [],
        output: `[联网检索结果] 检索没有成功（HTTP ${response.status}${detail ? `：${detail.slice(0, 160)}` : ""}）。如实告诉用户这次没能联网，不要编造结果。`,
      };
    }
    const payload: unknown = await response.json().catch(() => null);
    const answer = readSearchAnswer(payload);
    if (!answer.sources.length && !answer.text)
      return {
        ok: false,
        sources: [],
        output:
          "[联网检索结果] 没有找到任何相关结果。如实告诉用户没有搜到，不要编造来源或链接。",
      };
    return {
      ok: true,
      sources: answer.sources,
      output: chatSearchToolOutput(query, answer),
    };
  } catch (error) {
    const aborted =
      error instanceof Error && (error.name === "AbortError" || controller.signal.aborted);
    return {
      ok: false,
      sources: [],
      output: aborted
        ? "[联网检索结果] 检索超时，没有拿到结果。如实告诉用户这次没能联网，需要的话直接回答。"
        : "[联网检索结果] 检索出错，没有拿到结果。如实告诉用户这次没能联网，需要的话直接回答。",
    };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}
