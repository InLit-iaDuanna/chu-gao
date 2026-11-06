import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { db } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import { getChatProfile } from "@/lib/chat-profiles";
import { chatEndpoint } from "@/lib/chat-upstream";
import {
  activeResearchAttempt,
  waitForResearchCall,
  finishResearchCall,
} from "./budget";
import {
  consumeResearchResponse,
  researchResponsesBody,
  type JsonObject,
  responseText,
} from "./model-protocol";
import { ResearchError } from "./errors";
import { researchEvent } from "./service";
import { boundedResearchCallTrace, type ResearchCallTrace } from "./call-trace";
import type { ResearchPlan } from "./types";

function retryableModelFailure(error: unknown) {
  if (!(error instanceof ResearchError) || error.details?.retryable === false)
    return false;
  if (error.code === "UPSTREAM_ERROR")
    return [429, 500, 502, 503, 504].includes(
      Number(error.details?.httpStatus),
    );
  return (
    error.code === "UPSTREAM_INCOMPLETE" &&
    ["server_error", "rate_limit_exceeded", "overloaded_error"].includes(
      String(error.details?.reason),
    )
  );
}

export async function researchModelCall(
  attemptId: string,
  requestBody: JsonObject,
  onEvent: (event: JsonObject) => void | Promise<void>,
  externalSignal?: AbortSignal,
  trace?: ResearchCallTrace,
  // Application policy, never forwarded as a model parameter or inferred from
  // diagnostic trace hints. Existing callers retain at most three attempts.
  options: { maxAttempts?: number } = {},
) {
  const maxAttempts =
    options.maxAttempts === undefined ? 3 : options.maxAttempts;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3)
    throw new ResearchError(
      "INVALID_MODEL_RETRY_POLICY",
      "模型调用尝试次数必须为 1 至 3 的整数",
      400,
    );
  for (let number = 1; ; number++) {
    externalSignal?.throwIfAborted();
    let hasOutput = false;
    try {
      return await researchModelCallOnce(
        attemptId,
        requestBody,
        (event) => {
          if (
            ([
              "response.output_text.delta",
              "response.output_text.done",
              "response.function_call_arguments.delta",
              "response.function_call_arguments.done",
            ].includes(event.type) &&
              String(
                event.delta ?? event.text ?? event.arguments ?? "",
              ).trim()) ||
            event.item?.type === "function_call" ||
            responseText({ output: [event.item ?? {}] }).trim()
          )
            hasOutput = true;
          return onEvent(event);
        },
        externalSignal,
        trace,
      );
    } catch (error) {
      // A confirmed failure is not an unknown network outcome. Never replay
      // partial answers or tools, and keep framework/SDK retries disabled.
      if (
        number >= maxAttempts ||
        hasOutput ||
        externalSignal?.aborted ||
        !retryableModelFailure(error)
      )
        throw error;
      const {
        stage: { task },
      } = await activeResearchAttempt(attemptId);
      const plan = task.plan as unknown as ResearchPlan;
      const delayMs = 1000 * 2 ** number;
      if (
        task.llmCalls >= plan.limits.llm ||
        (task.deadlineAt && task.deadlineAt.getTime() <= Date.now() + delayMs)
      )
        throw error;
      await researchEvent(
        task.id,
        "call.retry_scheduled",
        {
          attemptId,
          retry: number,
          delayMs,
          message: `模型服务暂时异常，${delayMs / 1000} 秒后自动重试（${number}/${maxAttempts - 1}）`,
          code: error instanceof ResearchError ? error.code : null,
          reason:
            error instanceof ResearchError
              ? (error.details?.reason ?? error.details?.httpStatus ?? null)
              : null,
        },
        task.executionToken!,
      );
      await delay(delayMs, undefined, { signal: externalSignal });
    }
  }
}

async function researchModelCallOnce(
  attemptId: string,
  requestBody: JsonObject,
  onEvent: (event: JsonObject) => void | Promise<void>,
  externalSignal?: AbortSignal,
  trace?: ResearchCallTrace,
) {
  const { call, task } = await waitForResearchCall(
    attemptId,
    "llm",
    requestBody,
    externalSignal,
  );
  const abort = new AbortController();
  const stop = () => abort.abort();
  externalSignal?.addEventListener("abort", stop, { once: true });
  const idleTimeout = ["xhigh", "max", "ultra"].includes(task.reasoningEffort)
    ? 480000
    : 240000;
  const hardDeadline = Math.min(
    Date.now() + idleTimeout * 2,
    task.deadlineAt?.getTime() ?? Infinity,
  );
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const armTimeout = () => {
    clearTimeout(timeout);
    timeout = setTimeout(
      () =>
        abort.abort(
          new ResearchError(
            "MODEL_CALL_TIMEOUT",
            Date.now() >= hardDeadline
              ? "模型调用达到总执行时限，已有阶段资料已保存"
              : "模型长时间没有有效输出，已有阶段资料已保存",
            504,
          ),
        ),
      Math.min(idleTimeout, Math.max(1, hardDeadline - Date.now())),
    );
  };
  armTimeout();
  const checking = setInterval(() => {
    void activeResearchAttempt(attemptId).catch(stop);
  }, 1500);
  try {
    if (externalSignal?.aborted) abort.abort();
    const profile = await getChatProfile(task.modelId);
    if (!profile.enabled || !profile.apiKey)
      throw new ResearchError("MODEL_UNAVAILABLE", "研究模型尚未配置", 503);
    const modelSnapshot = (
      task.configSnapshot as {
        modelSnapshot?: { baseUrl: string; model: string };
      }
    ).modelSnapshot;
    if (
      modelSnapshot &&
      (modelSnapshot.baseUrl !== profile.baseUrl ||
        modelSnapshot.model !== profile.model)
    )
      throw new ResearchError(
        "MODEL_CONFIG_CHANGED",
        "模型地址或模型配置已改变，请基于已有成果创建新任务",
        409,
      );
    const previous = await db.researchCall.findMany({
      where: { attemptId, continuationEnc: { not: null }, status: "completed" },
      orderBy: { startedAt: "asc" },
      take: 100,
      select: { continuationEnc: true },
    });
    const outputs = previous.map((item) =>
      JSON.parse(decrypt(item.continuationEnc!)),
    );
    const body = researchResponsesBody(
      requestBody,
      profile.model,
      task.reasoningEffort,
      outputs,
    );
    const serialized = JSON.stringify(body);
    await researchEvent(
      task.id,
      "call.trace",
      {
        attemptId,
        callId: call.id,
        ...boundedResearchCallTrace(trace),
        upstreamRequestHash: createHash("sha256")
          .update(serialized)
          .digest("hex"),
        requestBytes: Buffer.byteLength(serialized, "utf8"),
        protocol: "responses_http_sse",
      },
      task.executionToken!,
    );
    const response = await fetch(chatEndpoint(profile.baseUrl, true), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${profile.apiKey}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "Accept-Encoding": "identity",
      },
      body: serialized,
      signal: abort.signal,
    });
    const result = await consumeResearchResponse(
      response,
      (event) => {
        // Transport heartbeats must not extend the budget; real output may.
        if (
          [
            "response.output_text.delta",
            "response.function_call_arguments.delta",
          ].includes(event.type) &&
          String(event.delta ?? "").trim()
        )
          armTimeout();
        return onEvent(event);
      },
      abort.signal,
    );
    await finishResearchCall(call.id, {
      usage: result.usage,
      continuationEnc: encrypt(JSON.stringify({ output: result.output ?? [] })),
    });
    await researchEvent(
      task.id,
      "call.completed",
      { attemptId, callId: call.id, kind: "llm" },
      task.executionToken!,
    ).catch(() => {});
    return result;
  } catch (error) {
    const failure =
      abort.signal.aborted && abort.signal.reason instanceof ResearchError
        ? abort.signal.reason
        : error;
    await finishResearchCall(call.id, {
      usage:
        failure instanceof ResearchError ? failure.details?.usage : undefined,
      errorCode:
        failure instanceof ResearchError
          ? failure.code
          : abort.signal.aborted
            ? "CALL_INTERRUPTED"
            : "MODEL_CALL_FAILED",
    });
    await researchEvent(
      task.id,
      "call.failed",
      {
        attemptId,
        callId: call.id,
        code:
          failure instanceof ResearchError ? failure.code : "MODEL_CALL_FAILED",
        reason:
          failure instanceof ResearchError
            ? (failure.details?.reason ?? null)
            : null,
      },
      task.executionToken!,
    ).catch(() => {});
    throw failure;
  } finally {
    clearInterval(checking);
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", stop);
  }
}
export async function chatCompatibleResearchResponse(
  attemptId: string,
  body: JsonObject,
  signal: AbortSignal,
  trace?: ResearchCallTrace,
) {
  const id = `chatcmpl-${randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  const chunk = (delta: unknown, finish_reason: string | null = null) => ({
    id,
    object: "chat.completion.chunk",
    created,
    model: body.model,
    choices: [{ index: 0, delta, finish_reason }],
  });
  if (!body.stream) {
    const result = await researchModelCall(
      attemptId,
      body,
      () => {},
      signal,
      trace,
    );
    const tools = (result.output ?? [])
      .filter((item: JsonObject) => item.type === "function_call")
      .map((item: JsonObject) => ({
        id: item.call_id,
        type: "function",
        function: { name: item.name, arguments: item.arguments },
      }));
    return Response.json({
      id,
      object: "chat.completion",
      created,
      model: body.model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: responseText(result) || null,
            ...(tools.length ? { tool_calls: tools } : {}),
          },
          finish_reason: tools.length ? "tool_calls" : "stop",
        },
      ],
      usage: result.usage
        ? {
            ...result.usage,
            prompt_tokens: result.usage.input_tokens,
            completion_tokens: result.usage.output_tokens,
            total_tokens: result.usage.total_tokens,
          }
        : undefined,
    });
  }
  const encoder = new TextEncoder();
  const cancelled = new AbortController();
  let open = true;
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (value: unknown) => {
        if (open)
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(value)}\n\n`),
          );
      };
      const toolIndices = new Map<string, number>();
      const toolArguments = new Map<string, string>();
      let streamedText = "";
      // Keep SDK idle timers alive during reasoning without inventing reply text.
      const heartbeat = setInterval(() => emit(chunk({})), 15000);
      try {
        emit(chunk({ role: "assistant" }));
        const result = await researchModelCall(
          attemptId,
          body,
          (event) => {
            if (event.type === "response.output_text.delta") {
              streamedText += event.delta;
              emit(chunk({ content: event.delta }));
            }
            if (
              event.type === "response.output_item.added" &&
              event.item?.type === "function_call"
            ) {
              const index = toolIndices.size;
              toolIndices.set(event.item.id, index);
              emit(
                chunk({
                  tool_calls: [
                    {
                      index,
                      id: event.item.call_id,
                      type: "function",
                      function: { name: event.item.name, arguments: "" },
                    },
                  ],
                }),
              );
            }
            if (event.type === "response.function_call_arguments.delta") {
              toolArguments.set(
                event.item_id,
                (toolArguments.get(event.item_id) ?? "") + event.delta,
              );
              emit(
                chunk({
                  tool_calls: [
                    {
                      index: toolIndices.get(event.item_id) ?? 0,
                      function: { arguments: event.delta },
                    },
                  ],
                }),
              );
            }
          },
          AbortSignal.any([signal, cancelled.signal]),
          trace,
        );
        const finalText = responseText(result);
        if (finalText !== streamedText) {
          // Some compatible upstreams omit initial whitespace in their final
          // snapshot. Keep the published bytes and align only the missing suffix.
          const prefix = finalText.startsWith(streamedText)
            ? streamedText
            : streamedText.trimStart();
          if (!finalText.startsWith(prefix))
            throw new ResearchError(
              "DIVERGENT_OUTPUT",
              "模型最终文本与流式文本不一致",
              502,
            );
          emit(chunk({ content: finalText.slice(prefix.length) }));
        }
        for (const tool of (result.output ?? []).filter(
          (item: JsonObject) => item.type === "function_call",
        )) {
          if (!toolIndices.has(tool.id)) {
            const index = toolIndices.size;
            toolIndices.set(tool.id, index);
            emit(
              chunk({
                tool_calls: [
                  {
                    index,
                    id: tool.call_id,
                    type: "function",
                    function: { name: tool.name, arguments: tool.arguments },
                  },
                ],
              }),
            );
          } else {
            const prefix = toolArguments.get(tool.id) ?? "";
            if (tool.arguments && tool.arguments !== prefix) {
              if (!tool.arguments.startsWith(prefix))
                throw new ResearchError(
                  "DIVERGENT_TOOL_OUTPUT",
                  "模型工具参数流不一致",
                  502,
                );
              emit(
                chunk({
                  tool_calls: [
                    {
                      index: toolIndices.get(tool.id),
                      function: {
                        arguments: tool.arguments.slice(prefix.length),
                      },
                    },
                  ],
                }),
              );
            }
          }
        }
        emit(
          chunk(
            {},
            (result.output ?? []).some(
              (item: JsonObject) => item.type === "function_call",
            )
              ? "tool_calls"
              : "stop",
          ),
        );
        if (body.stream_options?.include_usage)
          emit({
            id,
            object: "chat.completion.chunk",
            created,
            model: body.model,
            choices: [],
            usage: result.usage
              ? {
                  ...result.usage,
                  prompt_tokens: result.usage.input_tokens,
                  completion_tokens: result.usage.output_tokens,
                }
              : null,
          });
        if (open) controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (error) {
        if (
          error instanceof ResearchError &&
          ["DIVERGENT_OUTPUT", "DIVERGENT_TOOL_OUTPUT"].includes(error.code)
        )
          await activeResearchAttempt(attemptId)
            .then((active) =>
              researchEvent(
                active.stage.taskId,
                "call.stream_failed",
                { attemptId, code: error.code, message: error.message },
                active.stage.task.executionToken!,
              ),
            )
            .catch(() => {});
        if (open)
          emit({
            error: {
              code:
                error instanceof ResearchError
                  ? error.code
                  : "MODEL_CALL_FAILED",
              message:
                error instanceof ResearchError
                  ? error.message
                  : "研究模型调用中断",
            },
          });
      } finally {
        clearInterval(heartbeat);
        if (open) {
          open = false;
          controller.close();
        }
      }
    },
    cancel() {
      open = false;
      cancelled.abort();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

