import { LUNA_MODEL_ID, type ReasoningEffort } from "@/lib/chat-model-options";
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

export function chatEndpoint(baseUrl: string, responses: boolean): string {
  const root = baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
  return `${root}/v1/${responses ? "responses" : "chat/completions"}`;
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
