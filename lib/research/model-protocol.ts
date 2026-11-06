import { createParser } from "eventsource-parser";
import { ResearchError } from "./errors";

// Provider SDK payloads have heterogeneous nested shapes at this boundary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type JsonObject = Record<string, any>;
export function messagesToResponses(
  messages: JsonObject[],
  previousOutputs: JsonObject[] = [],
) {
  const input: JsonObject[] = [];
  for (const message of messages) {
    if (message.role === "tool") {
      input.push({
        type: "function_call_output",
        call_id: message.tool_call_id,
        output:
          typeof message.content === "string"
            ? message.content
            : JSON.stringify(message.content),
      });
      continue;
    }
    if (message.tool_calls?.length) {
      const callIds = new Set(
        message.tool_calls.map((call: JsonObject) => call.id),
      );
      const old = previousOutputs.find((output) =>
        output.output?.some(
          (item: JsonObject) =>
            item.type === "function_call" && callIds.has(item.call_id),
        ),
      );
      if (old)
        input.push(
          ...old.output.filter((item: JsonObject) => item.type === "reasoning"),
        );
      if (message.content)
        input.push({
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: String(message.content) }],
        });
      for (const call of message.tool_calls)
        input.push({
          type: "function_call",
          call_id: call.id,
          name: call.function.name,
          arguments: call.function.arguments,
        });
      continue;
    }
    const role = ["system", "developer", "assistant"].includes(message.role)
      ? message.role
      : "user";
    const content =
      typeof message.content === "string"
        ? [
            {
              type: role === "assistant" ? "output_text" : "input_text",
              text: message.content,
            },
          ]
        : (message.content ?? []).map((part: JsonObject) =>
            part.type === "image_url"
              ? { type: "input_image", image_url: part.image_url.url }
              : {
                  type: role === "assistant" ? "output_text" : "input_text",
                  text: String(part.text ?? ""),
                },
          );
    if (content.length) input.push({ type: "message", role, content });
  }
  return input;
}
export function researchResponsesBody(
  body: JsonObject,
  model: string,
  effort: string,
  previousOutputs: JsonObject[] = [],
) {
  const tools = (body.tools ?? []).map((tool: JsonObject) => {
    if (tool.type !== "function")
      throw new ResearchError(
        "UNSUPPORTED_TOOL",
        "研究任务只允许受控的自建工具",
      );
    const fn = tool.function ?? tool;
    return {
      type: "function",
      name: fn.name,
      description: fn.description,
      parameters: fn.parameters,
      strict: fn.strict ?? false,
    };
  });
  let toolChoice = body.tool_choice;
  if (toolChoice?.type === "function" && toolChoice.function)
    toolChoice = { type: "function", name: toolChoice.function.name };
  const format =
    body.response_format?.type === "json_schema"
      ? { type: "json_schema", ...body.response_format.json_schema }
      : body.response_format?.type === "json_object"
        ? { type: "json_object" }
        : body.text?.format;
  const guidance = (body.messages ?? []).filter((message: JsonObject) =>
    ["system", "developer"].includes(message.role),
  );
  const instructions = [
    ...(typeof body.instructions === "string" ? [body.instructions] : []),
    ...guidance.map((message: JsonObject) =>
      typeof message.content === "string"
        ? message.content
        : (message.content ?? [])
            .filter((part: JsonObject) => typeof part.text === "string")
            .map((part: JsonObject) => part.text)
            .join("\n"),
    ),
  ]
    .filter(Boolean)
    .join("\n\n");
  return {
    model,
    input: body.messages
      ? messagesToResponses(
          body.messages.filter(
            (message: JsonObject) =>
              !["system", "developer"].includes(message.role),
          ),
          previousOutputs,
        )
      : body.input,
    instructions: instructions || undefined,
    reasoning: { effort },
    tools,
    ...(tools.length ? { tool_choice: toolChoice ?? "auto" } : {}),
    ...(format ? { text: { format } } : {}),
    max_output_tokens: Math.min(
      16000,
      Math.max(
        256,
        Number(
          body.max_output_tokens ??
            body.max_completion_tokens ??
            body.max_tokens ??
            6000,
        ),
      ),
    ),
    stream: true,
    store: false,
    include: ["reasoning.encrypted_content"],
  };
}
export async function consumeResearchResponse(
  response: Response,
  onEvent: (event: JsonObject) => void | Promise<void>,
  signal?: AbortSignal,
) {
  if (!response.ok || !response.body)
    throw new ResearchError(
      "UPSTREAM_ERROR",
      `模型调用失败（HTTP ${response.status}）`,
      502,
      {
        httpStatus: response.status,
        retryable: [408, 429, 500, 502, 503, 504].includes(response.status),
      },
    );
  if (!response.headers.get("content-type")?.includes("text/event-stream"))
    throw new ResearchError("INVALID_STREAM", "模型未返回 SSE 流", 502);
  let completed: JsonObject | null = null;
  let fault: Error | null = null;
  const pending: JsonObject[] = [];
  const parser = createParser({
    onEvent(event) {
      if (event.data === "[DONE]") return;
      try {
        const value = JSON.parse(event.data);
        if (
          ["response.failed", "response.incomplete", "error"].includes(
            value.type,
          )
        ) {
          const rawReason = String(
            value.response?.incomplete_details?.reason ??
              value.response?.error?.code ??
              value.error?.code ??
              value.code ??
              "unknown",
          );
          const reason = /^[a-z0-9_]{1,80}$/i.test(rawReason)
            ? rawReason
            : "unknown";
          fault = new ResearchError(
            "UPSTREAM_INCOMPLETE",
            reason === "max_output_tokens"
              ? "模型达到单次输出上限，已有阶段结果已保留"
              : "模型响应未完成，已有阶段结果已保留",
            502,
            {
              reason,
              usage: value.response?.usage,
              retryable: ![
                "content_filter",
                "safety",
                "moderation",
                "invalid_api_key",
                "invalid_request_error",
                "context_length_exceeded",
                "model_not_found",
                "insufficient_quota",
              ].includes(reason),
            },
          );
          return;
        }
        if (value.type === "response.completed") completed = value.response;
        pending.push(value);
      } catch {
        fault = new ResearchError(
          "INVALID_STREAM",
          "模型返回了无效的流式数据",
          502,
        );
      }
    },
  });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      signal?.throwIfAborted();
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (error) {
        signal?.throwIfAborted();
        const code = (error as { cause?: { code?: unknown } })?.cause?.code;
        throw new ResearchError(
          "UPSTREAM_DISCONNECTED",
          "模型连接被中断，已完成材料已保留，可以继续当前阶段",
          502,
          {
            reason:
              typeof code === "string" && /^[A-Z0-9_]{1,80}$/.test(code)
                ? code
                : "transport_closed",
            retryable: false,
          },
        );
      }
      if (chunk.done) break;
      parser.feed(decoder.decode(chunk.value, { stream: true }));
      for (const event of pending.splice(0)) await onEvent(event);
      if (fault) throw fault;
      if (completed) break;
    }
    parser.feed(decoder.decode());
    for (const event of pending.splice(0)) await onEvent(event);
    if (fault) throw fault;
    if (!completed || (completed as JsonObject).status !== "completed")
      throw new ResearchError(
        "PREMATURE_EOF",
        "上游流提前断开，本阶段可以重试",
        502,
        { retryable: true },
      );
    if (
      !responseText(completed).trim() &&
      !(completed as JsonObject).output?.some(
        (item: JsonObject) => item.type === "function_call",
      )
    )
      throw new ResearchError(
        "EMPTY_MODEL_RESPONSE",
        "模型只返回了空白，未生成有效结果",
        502,
        { retryable: true, usage: (completed as JsonObject).usage },
      );
    return completed as JsonObject;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export function responseText(response: JsonObject) {
  return (response.output ?? [])
    .filter((item: JsonObject) => item.type === "message")
    .flatMap((item: JsonObject) => item.content ?? [])
    .filter((part: JsonObject) => part.type === "output_text")
    .map((part: JsonObject) => part.text)
    .join("");
}
