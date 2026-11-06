import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
import { getLunaConfig } from "@/lib/luna-config";
import {
  REASONING_EFFORTS,
  type ReasoningEffort,
} from "@/lib/chat-model-options";
import {
  chatEndpoint,
  lunaRequestBody,
  readLunaStreamEvent,
} from "@/lib/chat-upstream";
import { db } from "@/lib/db";
import { ResponsesAccumulator } from "@/lib/chat-responses-stream";
import { getConversationSystemPrompt } from "@/lib/ai-config";
import { chatSystemInstructions } from "@/lib/chat-instructions";

// One real upstream request; never includes existing user conversations.
async function main() {
  const effort = process.argv[2] as ReasoningEffort;
  if (!REASONING_EFFORTS.includes(effort))
    throw new Error("Specify a reasoning effort.");
  const webSearch = process.argv.includes("--web");
  const chat = process.argv.includes("--chat");
  const jsonMode = process.argv.includes("--json");
  const modelOverride = process.argv
    .find((argument) => argument.startsWith("--model="))
    ?.slice("--model=".length);
  if (modelOverride && !/^[a-z\d._-]+$/i.test(modelOverride))
    throw new Error("Invalid model ID.");
  const temporaryConfig = process.argv.includes("--config-stdin")
    ? (JSON.parse(readFileSync(0, "utf8")) as {
        baseUrl?: unknown;
        apiKey?: unknown;
      })
    : null;
  if (
    temporaryConfig &&
    (typeof temporaryConfig.baseUrl !== "string" ||
      !temporaryConfig.baseUrl.startsWith("https://") ||
      typeof temporaryConfig.apiKey !== "string" ||
      !temporaryConfig.apiKey ||
      !modelOverride)
  )
    throw new Error("Temporary probe configuration is invalid.");
  const config = temporaryConfig
    ? {
        enabled: true,
        baseUrl: temporaryConfig.baseUrl as string,
        apiKey: temporaryConfig.apiKey as string,
        model: modelOverride!,
      }
    : await getLunaConfig();
  if (!config.enabled || !config.apiKey)
    throw new Error("Luna is unavailable.");
  if (process.argv.includes("--models")) {
    const filter =
      process.argv
        .find((argument) => argument.startsWith("--model-filter="))
        ?.slice("--model-filter=".length)
        .toLowerCase() ?? "luna";
    const response = await fetch(
      chatEndpoint(config.baseUrl, true).replace(/responses$/, "models"),
      {
        headers: { Authorization: `Bearer ${config.apiKey}` },
        signal: AbortSignal.timeout(30_000),
      },
    );
    const payload = (await response.json()) as {
      data?: Array<{ id?: string }>;
    };
    console.log(
      JSON.stringify({
        status: response.status,
        models: payload.data
          ?.map((model) => model.id)
          .filter(
            (id) => typeof id === "string" && id.toLowerCase().includes(filter),
          ),
      }),
    );
    if (!response.ok) process.exitCode = 1;
    return;
  }
  const apiKey = config.apiKey;
  const websitePrompt = process.argv.includes("--website-prompt");
  const instructions = [
    websitePrompt
      ? chatSystemInstructions(await getConversationSystemPrompt(), webSearch)
      : "你是功能验证助手，只需完成用户要求的短输出。",
    process.argv.includes("--strict-output")
      ? "本轮没有任何可执行工具，只能直接输出文字答复，不要调用任何工具。"
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const start = performance.now();
  const messages = [
    {
      role: "user" as const,
      content: webSearch
        ? "这是自建联网流式功能测试。实际联网核对 GitHub remarkjs/react-markdown 的仓库名称和主页链接，用两句中文回答并引用来源。"
        : websitePrompt
          ? "这是自建流式功能验证，不是真实用户历史。请直接给出五条咖啡店产品陈列建议，每条一句，约150个中文字，不需要前言或分析。"
          : "这是自建流式功能测试，不是真实用户对话。直接输出五行，每行一句关于海边咖啡店产品陈列的简短建议。总共约150个中文字，不要前言、不要分析、不要调用工具。",
    },
  ];
  const response = await fetch(chatEndpoint(config.baseUrl, !chat), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      Accept: jsonMode ? "application/json" : "text/event-stream",
      ...(process.argv.includes("--identity")
        ? { "Accept-Encoding": "identity" }
        : {}),
    },
    body: JSON.stringify({
      ...(chat
        ? {
            model: config.model,
            messages: [
              {
                role: "system",
                content: instructions,
              },
              ...messages,
            ],
            reasoning_effort: effort,
          }
        : lunaRequestBody(messages, instructions, effort, { webSearch })),
      ...(modelOverride ? { model: modelOverride } : {}),
      stream: !jsonMode,
      ...(process.argv.includes("--summary-auto")
        ? { reasoning: { effort, summary: "auto" } }
        : {}),
      ...(process.argv.includes("--web-minimal")
        ? { tool_choice: "auto", include: [] }
        : {}),
      ...(process.argv.includes("--codex-web")
        ? {
            tools: [{ type: "web_search", external_web_access: true }],
            tool_choice: "auto",
            parallel_tool_calls: true,
            include: ["reasoning.encrypted_content"],
          }
        : {}),
      ...(process.argv.includes("--bounded")
        ? { max_output_tokens: 4096 }
        : {}),
      ...(process.argv.includes("--web-preview")
        ? { tools: [{ type: "web_search_preview" }], tool_choice: "auto" }
        : {}),
      ...(process.argv.includes("--typed-input")
        ? {
            input: messages.map((message) => ({
              type: "message",
              role: message.role,
              content: [{ type: "input_text", text: message.content }],
            })),
          }
        : {}),
      ...(process.argv.includes("--no-tools")
        ? { tools: [], tool_choice: "none" }
        : {}),
      ...(process.argv.includes("--codex-wire")
        ? {
            instructions: undefined,
            input: [
              {
                type: "message",
                role: "developer",
                content: [{ type: "input_text", text: instructions }],
              },
              ...messages.map((message) => ({
                type: "message",
                role: message.role,
                content: [{ type: "input_text", text: message.content }],
              })),
            ],
            reasoning: { effort, context: "all_turns" },
            tool_choice: "auto",
            parallel_tool_calls: false,
            include: ["reasoning.encrypted_content"],
            text: { verbosity: "low" },
            tools: webSearch
              ? [{ type: "web_search", external_web_access: true }]
              : [],
          }
        : {}),
    }),
    signal: AbortSignal.timeout(240_000),
  });
  const elapsed = () => Math.round(performance.now() - start);
  const contentType = response.headers.get("content-type");
  console.log(
    JSON.stringify({
      event: "headers",
      effort,
      model: modelOverride ?? config.model,
      webSearch,
      status: response.status,
      contentType,
      requestId: response.headers.get("x-request-id"),
      ms: elapsed(),
    }),
  );
  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => null);
    const message =
      typeof payload?.error?.message === "string"
        ? payload.error.message
            .replaceAll(config.apiKey, "[REDACTED]")
            .replace(/sk-[a-z\d_-]+/gi, "[REDACTED]")
            .slice(0, 300)
        : null;
    console.log(
      JSON.stringify({ ok: false, status: response.status, message }),
    );
    process.exitCode = 1;
    return;
  }
  let firstTextMs: number | null = null;
  let lastTextMs: number | null = null;
  let deltas = 0;
  let characters = 0;
  let chunks = 0;
  let completed = false;
  let finalCharacters = 0;
  let searched = false;
  let failure: string | undefined;
  let observedPayload = false;
  const types: Record<string, number> = {};
  const rawResponse = new ResponsesAccumulator();
  let rawDeltaCharacters = 0;
  const consume = (payload: unknown) => {
    if (!chat) rawResponse.consume(payload);
    const raw = payload as {
      type?: string;
      response?: { incomplete_details?: { reason?: string } };
    };
    if (!observedPayload) {
      observedPayload = true;
      console.log(
        JSON.stringify({
          event: "payload_shape",
          keys: Object.keys(raw),
          type: raw.type,
          choices: Array.isArray((raw as { choices?: unknown }).choices),
          responseModel: (raw as { response?: { model?: unknown } }).response
            ?.model,
          responseFields: (raw as { response?: object }).response
            ? Object.keys((raw as { response: object }).response)
            : undefined,
          ms: elapsed(),
        }),
      );
    }
    if (raw.type) types[raw.type] = (types[raw.type] ?? 0) + 1;
    const errorRecord = raw as {
      error?: { message?: unknown; code?: unknown; type?: unknown };
      message?: unknown;
      code?: unknown;
      type?: unknown;
      response?: {
        error?: { message?: unknown; code?: unknown; type?: unknown };
      };
    };
    const upstreamError =
      errorRecord.error ??
      errorRecord.response?.error ??
      (raw.type === "error" ? errorRecord : undefined);
    if (upstreamError)
      console.log(
        JSON.stringify({
          event: "upstream_error",
          code: upstreamError.code,
          type: upstreamError.type,
          message:
            typeof upstreamError.message === "string"
              ? upstreamError.message
                  .replaceAll(apiKey, "[REDACTED]")
                  .replace(/sk-[a-z\d_-]+/gi, "[REDACTED]")
                  .replace(/https?:\/\/[^\s]+/gi, "[UPSTREAM]")
                  .slice(0, 300)
              : undefined,
          ms: elapsed(),
        }),
      );
    const event = chat
      ? (() => {
          const value = payload as {
            choices?: Array<{
              delta?: { content?: string };
              finish_reason?: string;
            }>;
          };
          const choice = value.choices?.[0];
          return {
            text: choice?.delta?.content,
            completed: choice?.finish_reason === "stop",
          } as ReturnType<typeof readLunaStreamEvent>;
        })()
      : readLunaStreamEvent(payload);
    if (event.searched) searched = true;
    if (typeof event.text === "string") rawDeltaCharacters += event.text.length;
    if (event.text?.trim()) {
      firstTextMs ??= elapsed();
      lastTextMs = elapsed();
      deltas += 1;
      characters += event.text.length;
      if (deltas === 1)
        console.log(
          JSON.stringify({ event: "first_text", effort, ms: firstTextMs }),
        );
    }
    if (event.error)
      failure = raw.response?.incomplete_details?.reason ?? event.error;
    if (event.completed) {
      completed = true;
      finalCharacters = event.finalText?.length ?? 0;
    }
  };
  if (contentType?.includes("application/json")) {
    consume({ type: "response.completed", response: await response.json() });
  } else {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const drain = (final = false) => {
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const data = frame
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (data && data !== "[DONE]") consume(JSON.parse(data));
      }
      if (final && buffer.trim()) {
        buffer += "\n\n";
        drain();
      }
    };
    try {
      while (true) {
        const part = await reader.read();
        if (part.value) chunks += 1;
        buffer += decoder.decode(part.value, { stream: !part.done });
        if (chunks === 1)
          console.log(
            JSON.stringify({
              event: "first_chunk",
              bytes: part.value?.length,
              hasFrameBoundary: /\r?\n\r?\n/.test(buffer),
              types: [...buffer.matchAll(/"type"\s*:\s*"([^\"]+)"/g)]
                .slice(0, 5)
                .map((match) => match[1]),
              ms: elapsed(),
            }),
          );
        drain(part.done);
        if (part.done || completed || failure) break;
      }
    } catch (error) {
      failure = error instanceof Error ? error.message : "Stream read failed";
    } finally {
      void reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }
  const totalMs = elapsed();
  const answerOk = jsonMode
    ? completed && !failure && finalCharacters > 0
    : completed &&
      !failure &&
      deltas > 1 &&
      characters > 0 &&
      firstTextMs !== null &&
      firstTextMs < totalMs;
  const ok = answerOk && (!webSearch || searched);
  console.log(
    JSON.stringify({
      ok,
      effort,
      model: modelOverride ?? config.model,
      webSearch,
      searched,
      totalMs,
      firstTextMs,
      lastTextMs,
      deltas,
      chunks,
      characters,
      completed,
      finalCharacters,
      rawDeltaCharacters,
      rawFinalCharacters: chat ? null : rawResponse.rawText.length,
      rawPartDiagnostics: chat ? null : rawResponse.partDiagnostics(),
      failure,
      types,
    }),
  );
  if (!ok) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Stream probe failed",
    );
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
