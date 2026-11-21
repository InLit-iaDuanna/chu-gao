import {
  geminiUpstreamModel,
  LUNA_MODEL_ID,
  type ReasoningEffort,
} from "@/lib/chat-model-options";
import { readCitedResponse, type ChatSearchSource } from "@/lib/chat-search";

export function chatCompletionsRequestBody(
  model: string,
  messages: UpstreamChatMessage[],
  instructions: string,
  options: {
    effort?: ReasoningEffort;
    maxOutputTokens?: number;
    includeUsage?: boolean;
    tools?: readonly unknown[];
    toolChoice?: "auto";
  } = {},
) {
  return {
    model,
    messages: [{ role: "system", content: instructions }, ...messages],
    stream: true,
    ...(options.effort ? { reasoning_effort: options.effort } : {}),
    ...(options.maxOutputTokens ? { max_tokens: options.maxOutputTokens } : {}),
    ...(options.includeUsage
      ? { stream_options: { include_usage: true } }
      : {}),
    ...(options.tools?.length
      ? { tools: options.tools, tool_choice: options.toolChoice ?? "auto" }
      : {}),
  };
}

export interface AnthropicToolContinuation {
  callId: string;
  name: string;
  arguments: string;
  output: string;
  /**
   * Calls of the same upstream response share a round. Native replay puts a
   * round's tool_use blocks in one assistant message and their tool_result
   * blocks in the next user message, as the Messages API expects.
   */
  round?: number;
}

type ContentPart =
  | { type: "text"; text: string }
  | {
      type: "image_url";
      image_url: { url: string; detail?: "auto" | "low" | "high" };
    };

export interface UpstreamChatMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string | ContentPart[];
  tool_calls?: UpstreamFunctionToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface UpstreamFunctionToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

function anthropicContent(content: string | ContentPart[]) {
  if (typeof content === "string") return content;
  return content.map((part) => {
    if (part.type === "text") return part;
    const dataUrl = /^data:([^;,]+);base64,([\s\S]*)$/.exec(part.image_url.url);
    return {
      type: "image" as const,
      source: dataUrl
        ? { type: "base64" as const, media_type: dataUrl[1], data: dataUrl[2] }
        : { type: "url" as const, url: part.image_url.url },
    };
  });
}

function jsonObject(value: string) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

export function anthropicMessagesRequestBody(
  model: string,
  messages: UpstreamChatMessage[],
  instructions: string,
  effort: ReasoningEffort,
  options: {
    webSearch?: boolean;
    maxOutputTokens?: number;
    stream?: boolean;
    tools?: readonly unknown[];
    toolContinuations?: AnthropicToolContinuation[];
  } = {},
) {
  const input: Array<{
    role: "user" | "assistant";
    content: unknown;
  }> = messages.flatMap(
    (
      message,
    ): Array<{
      role: "user" | "assistant";
      content: unknown;
    }> => {
      if (message.role === "system") return [];
      if (message.role === "tool") {
        return [
          {
            role: "user" as const,
            content: [
              {
                type: "tool_result" as const,
                tool_use_id: message.tool_call_id ?? "unknown",
                content:
                  typeof message.content === "string"
                    ? message.content
                    : JSON.stringify(message.content ?? ""),
              },
            ],
          },
        ];
      }
      return [
        {
          role:
            message.role === "assistant"
              ? ("assistant" as const)
              : ("user" as const),
          content: anthropicContent(message.content),
        },
      ];
    },
  );
  // Native tool_use/tool_result replay whenever the request defines tools.
  // Without any tool definitions (the last request of a turn, which must
  // answer), tool_use/tool_result blocks are rejected or mishandled by
  // relays, so the exchange is replayed as text.
  const replayAsText = !options.tools?.length && !options.webSearch;
  const rounds: AnthropicToolContinuation[][] = [];
  for (const tool of options.toolContinuations ?? []) {
    const last = rounds.at(-1);
    if (
      last &&
      tool.round !== undefined &&
      last[0].round === tool.round
    )
      last.push(tool);
    else rounds.push([tool]);
  }
  const toolContinuations = rounds.flatMap(
    (round): Array<{ role: "user" | "assistant"; content: unknown }> =>
      replayAsText
        ? round.flatMap((tool) => [
            {
              role: "assistant" as const,
              content: `[已调用 ${tool.name}]\n${tool.arguments}`,
            },
            {
              role: "user" as const,
              content: `[${tool.name} 回执]\n${tool.output}\n请根据回执直接用文字回复用户，不要再调用工具，也不要检索。`,
            },
          ])
        : [
            {
              role: "assistant" as const,
              content: round.map((tool) => ({
                type: "tool_use" as const,
                id: tool.callId,
                name: tool.name,
                input: jsonObject(tool.arguments),
              })),
            },
            {
              role: "user" as const,
              content: round.map((tool) => ({
                type: "tool_result" as const,
                tool_use_id: tool.callId,
                content: tool.output,
              })),
            },
          ],
  );
  const tools = [
    ...(options.webSearch
      ? [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }]
      : []),
    ...(options.tools ?? []),
  ];
  return {
    model,
    system: instructions,
    messages: [...input, ...toolContinuations],
    max_tokens: options.maxOutputTokens ?? 16_384,
    ...(effort ? { output_config: { effort } } : {}),
    ...(tools.length ? { tools } : {}),
    stream: options.stream ?? true,
  };
}

export type ChatTransport =
  | "chat_completions_sse"
  | "responses_sse"
  | "anthropic_messages_sse";

export function chatEndpoint(
  baseUrl: string,
  transport: boolean | ChatTransport,
): string {
  const root = baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
  const path =
    transport === true
      ? "responses"
      : transport === "anthropic_messages_sse"
        ? "messages"
        : "chat/completions";
  return `${root}/v1/${path}`;
}

export function lunaRequestBody(
  messages: UpstreamChatMessage[],
  instructions: string,
  effort: ReasoningEffort,
  options: {
    webSearch?: boolean;
    maxOutputTokens?: number;
    stream?: boolean;
    promptCacheKey?: string;
    promptCacheOptions?: { mode: "implicit"; ttl: "30m" };
  } = {},
) {
  return responsesRequestBody(
    LUNA_MODEL_ID,
    messages,
    instructions,
    effort,
    options,
  );
}

export function responsesRequestBody(
  model: string,
  messages: UpstreamChatMessage[],
  instructions: string,
  effort: ReasoningEffort,
  options: {
    webSearch?: boolean;
    maxOutputTokens?: number;
    stream?: boolean;
    promptCacheKey?: string;
    promptCacheOptions?: { mode: "implicit"; ttl: "30m" };
    tools?: readonly unknown[];
    toolContinuations?: Array<{
      callId: string;
      name: string;
      arguments: string;
      output: string;
    }>;
  } = {},
) {
  const input: Array<Record<string, unknown>> = messages.flatMap(
    (message): Array<Record<string, unknown>> => {
      if (message.role === "tool") {
        return [
          {
            type: "function_call_output",
            call_id: message.tool_call_id ?? "unknown",
            output:
              typeof message.content === "string"
                ? message.content
                : JSON.stringify(message.content ?? ""),
          },
        ];
      }
      return [
        {
          type: "message",
          role: message.role,
          content:
            typeof message.content === "string"
              ? [
                  {
                    type:
                      message.role === "assistant"
                        ? "output_text"
                        : "input_text",
                    text: message.content,
                  },
                ]
              : (message.content ?? []).map((part) =>
                  part.type === "text"
                    ? {
                        type:
                          message.role === "assistant"
                            ? "output_text"
                            : "input_text",
                        text: part.text,
                      }
                    : {
                        type: "input_image",
                        image_url: part.image_url.url,
                        detail: part.image_url.detail ?? "auto",
                      },
                ),
        },
      ];
    },
  );
  const toolContinuations = (options.toolContinuations ?? []).flatMap(
    (tool) => [
      {
        type: "function_call",
        call_id: tool.callId,
        name: tool.name,
        arguments: tool.arguments,
      },
      {
        type: "function_call_output",
        call_id: tool.callId,
        output: tool.output,
      },
    ],
  );
  const tools = [
    ...(options.webSearch ? [{ type: "web_search" }] : []),
    ...(options.tools ?? []),
  ];
  return {
    model,
    instructions,
    input: [...input, ...toolContinuations],
    reasoning: { effort },
    ...(options.promptCacheKey
      ? { prompt_cache_key: options.promptCacheKey }
      : {}),
    ...(options.promptCacheOptions
      ? { prompt_cache_options: options.promptCacheOptions }
      : {}),
    ...(tools.length
      ? {
          tools,
          tool_choice: "auto",
          ...(options.webSearch ? { include: [] } : {}),
        }
      : {}),
    ...(options.maxOutputTokens
      ? { max_output_tokens: options.maxOutputTokens }
      : {}),
    stream: options.stream ?? true,
    store: false,
  };
}

export { geminiUpstreamModel };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function readLunaStreamEvent(payload: unknown): {
  text?: string;
  completed?: boolean;
  finalText?: string;
  searched?: boolean;
  sources?: ChatSearchSource[];
  status?: string;
  error?: string;
} {
  if (!isRecord(payload)) return {};
  if (payload.type === "response.web_search_call.completed") {
    return { searched: true, status: "正在整理检索结果…" };
  }
  if (
    payload.type === "response.output_item.done" &&
    isRecord(payload.item) &&
    payload.item.type === "web_search_call" &&
    payload.item.status === "completed"
  ) {
    return { searched: true };
  }
  if (payload.type === "response.output_item.added" && isRecord(payload.item)) {
    if (payload.item.type === "reasoning") return { status: "正在思考…" };
    if (payload.item.type === "web_search_call")
      return { status: "正在联网检索…" };
  }
  if (
    payload.type === "response.output_text.delta" ||
    payload.type === "response.refusal.delta"
  ) {
    return typeof payload.delta === "string" ? { text: payload.delta } : {};
  }
  if (payload.type === "response.completed") {
    const response = isRecord(payload.response) ? payload.response : {};
    if (
      response.error ||
      (response.status && response.status !== "completed")
    ) {
      return { error: "对话未能完成，请重试" };
    }
    const output = Array.isArray(response.output) ? response.output : [];
    return { completed: true, ...readCitedResponse(output) };
  }
  if (
    payload.type === "response.failed" ||
    payload.type === "response.incomplete" ||
    payload.type === "error" ||
    payload.error
  ) {
    return { error: "对话未能完成，请重试" };
  }
  return {};
}

function searchSources(value: unknown) {
  return Array.isArray(value)
    ? value.filter(
        (item) =>
          isRecord(item) &&
          typeof item.url === "string" &&
          typeof item.title === "string",
      )
    : [];
}

/** Convert Anthropic Messages SSE into the internal Responses event shape. */
export function readAnthropicStreamEvents(payload: unknown): unknown[] {
  if (!isRecord(payload) || typeof payload.type !== "string") return [];
  const type = payload.type;
  if (type === "message_start") {
    const message = isRecord(payload.message) ? payload.message : {};
    return [
      {
        type: "response.created",
        response: {
          id: message.id,
          status: "in_progress",
          usage: message.usage,
        },
      },
    ];
  }
  if (type === "content_block_start") {
    const index = typeof payload.index === "number" ? payload.index : 0;
    const block = isRecord(payload.content_block) ? payload.content_block : {};
    const id =
      typeof block.id === "string" ? block.id : `anthropic-block-${index}`;
    if (block.type === "text")
      return [
        {
          type: "response.output_item.added",
          output_index: index,
          item: { id, type: "message", role: "assistant" },
        },
      ];
    if (block.type === "thinking")
      return [
        {
          type: "response.output_item.added",
          output_index: index,
          item: { id, type: "reasoning" },
        },
      ];
    if (block.type === "tool_use") {
      // Short arguments arrive complete on the start block, with no deltas.
      const input = isRecord(block.input) ? block.input : null;
      return [
        {
          type: "response.output_item.added",
          output_index: index,
          item: {
            id,
            call_id: id,
            name: block.name,
            type: "function_call",
          },
        },
        ...(input && Object.keys(input).length
          ? [
              {
                type: "response.function_call_arguments.done",
                output_index: index,
                call_id: id,
                arguments: JSON.stringify(input),
              },
            ]
          : []),
      ];
    }
    if (block.type === "server_tool_use")
      return [
        {
          type: "response.web_search_call.searching",
          output_index: index,
          item_id: id,
          action: {
            type: "search",
            query: isRecord(block.input) ? block.input.query : undefined,
          },
        },
      ];
    if (block.type === "web_search_tool_result")
      return [
        {
          type: "response.web_search_call.completed",
          output_index: index,
          item_id:
            typeof payload.tool_use_id === "string"
              ? payload.tool_use_id
              : typeof block.tool_use_id === "string"
                ? block.tool_use_id
                : id,
          action: { type: "search", sources: searchSources(block.content) },
        },
      ];
    if (block.type === "web_search_tool_result_error")
      return [
        {
          type: "response.web_search_call.failed",
          output_index: index,
          item_id:
            typeof payload.tool_use_id === "string" ? payload.tool_use_id : id,
        },
      ];
    return [];
  }
  if (type === "content_block_delta") {
    const index = typeof payload.index === "number" ? payload.index : 0;
    const delta = isRecord(payload.delta) ? payload.delta : {};
    if (delta.type === "text_delta" && typeof delta.text === "string")
      return [
        {
          type: "response.output_text.delta",
          output_index: index,
          content_index: 0,
          delta: delta.text,
        },
      ];
    if (
      delta.type === "input_json_delta" &&
      typeof delta.partial_json === "string"
    )
      return [
        {
          type: "response.function_call_arguments.delta",
          output_index: index,
          delta: delta.partial_json,
        },
      ];
    return [];
  }
  if (type === "message_delta") {
    const delta = isRecord(payload.delta) ? payload.delta : {};
    const stopReason = delta.stop_reason;
    return [
      {
        type: "response.completed",
        response: {
          status: stopReason === "max_tokens" ? "incomplete" : "completed",
          usage: payload.usage,
        },
      },
    ];
  }
  if (type === "error") {
    const error = isRecord(payload.error) ? payload.error : {};
    return [
      {
        type: "response.failed",
        error: {
          type: typeof error.type === "string" ? error.type : "upstream_error",
          code: typeof error.code === "string" ? error.code : undefined,
          message:
            typeof error.message === "string"
              ? error.message.slice(0, 400)
              : "Anthropic 上游请求失败",
        },
      },
    ];
  }
  return [];
}
