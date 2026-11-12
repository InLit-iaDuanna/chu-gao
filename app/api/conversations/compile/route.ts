import { z } from "zod";

import { getConversationCompileSystemPrompt } from "@/lib/ai-config";
import { fail, ok } from "@/lib/api-response";
import { userActionRateLimitResponse } from "@/lib/api-rate-limit";
import { readJsonBodySafe } from "@/lib/request-body";
import { checkSession } from "@/lib/auth";
import {
  compilePromptFallback,
  trimConversationMessages,
  type CompiledConversationPrompt,
  type ConversationMessage,
} from "@/lib/conversation";
import { getOpusConfig } from "@/lib/opus-config";
import { fetchWithTimeout } from "@/lib/http";
import { logger } from "@/lib/logger";
import { getConfiguredModel } from "@/lib/models/runtime-config";
import { withModelCall, type ModelCallContext } from "@/lib/model-call-log";
import { providerError } from "@/lib/providers/diagnostics";
import { OPUS_MODEL_ID } from "@/lib/chat-model-options";
import {
  extractChatContent,
  parseCompilerResponse,
} from "@/lib/conversation-compiler-response";

const messageSchema = z.object({
  id: z.string().optional(),
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(4000),
  generationId: z.string().optional(),
  createdAt: z.string().optional(),
});

const compileSchema = z.object({
  modelId: z.string().min(1),
  messages: z.array(messageSchema).min(1).max(80),
  params: z
    .object({
      aspectRatio: z.string().optional(),
      resolution: z.string().optional(),
      n: z.number().int().optional(),
      outputFormat: z.string().optional(),
      background: z.string().optional(),
      outputCompression: z.number().int().optional(),
    })
    .optional(),
});

function toCompiledPrompt(
  value: unknown,
  compiler: string,
): CompiledConversationPrompt {
  const parsed = z
    .object({
      prompt: z.string().min(1).max(4000),
      assistantMessage: z.string().min(1).max(400),
      shouldGenerate: z.boolean().default(true),
    })
    .parse(value);

  return {
    ...parsed,
    compiler,
  };
}

function compilerErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.replace(/\s+/g, " ").slice(0, 240);
  }

  return String(error).slice(0, 240);
}

// 用 Opus 5.5 把多轮对话编译成出图 prompt。
// 系统提示词 = 后台「出图提示词编译指令」。未配置 / 出错时由上层回退本地拼接。
async function compileWithOpusModel({
  messages,
  modelId,
  params,
  logContext,
}: {
  messages: ConversationMessage[];
  modelId: string;
  params?: Record<string, unknown>;
  logContext?: ModelCallContext;
}): Promise<CompiledConversationPrompt | null> {
  const config = await getOpusConfig();

  // 未启用 / 无 key：返回 null，让上层走本地回退。
  if (!config.enabled || !config.apiKey) {
    return null;
  }

  const trimmedMessages = trimConversationMessages(messages, {
    maxMessages: 40,
    maxContentLength: 1200,
  });

  const model = await getConfiguredModel(modelId);

  if (!model) {
    throw new Error("UNKNOWN_MODEL");
  }

  const systemPrompt = await getConversationCompileSystemPrompt();
  const url = `${config.baseUrl.replace(/\/+$/, "")}/v1/chat/completions`;

  const userPayload = JSON.stringify({
    outputSchema: {
      prompt: "最终出图 prompt，必须完整、自包含，不超过 4000 字",
      assistantMessage: "给用户看的短回复，不超过 80 字",
      shouldGenerate: "信息足够生成则 true；需要先追问则 false",
    },
    targetModel: { id: model.id, displayName: model.displayName },
    currentParams: params,
    messages: trimmedMessages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
  });

  const requestBody = {
    model: config.model,
    reasoning_effort: "low",
    temperature: 0,
    max_tokens: 1200,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPayload },
    ],
  };

  return withModelCall(
    {
      ...logContext,
      secrets: [config.apiKey],
      kind: "llm",
      operation: "prompt.compile",
      modelId: config.model,
      providerName: "Opus 5.5",
      endpoint: url,
      requestContent: requestBody,
    },
    async (call) => {
      const response = await fetchWithTimeout(url, {
        method: "POST",
        timeoutMs: Number(
          process.env.CONVERSATION_COMPILER_TIMEOUT_MS ?? 20_000,
        ),
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      call.response(response);
      if (!response.ok)
        throw await providerError(
          response,
          "Opus 5.5",
          "chat-completions",
          url,
        );

      const payload = await response.json();
      call.usage(payload);
      const text = extractChatContent(payload);

      if (!text.trim()) {
        throw new Error("compiler returned empty content");
      }

      return toCompiledPrompt(parseCompilerResponse(text), OPUS_MODEL_ID);
    },
  );
}

export async function POST(request: Request) {
  const sessionResult = await checkSession(request);

  if (sessionResult.status === "unavailable") {
    return fail("AUTH_UNAVAILABLE", "认证服务暂时不可用", { status: 503 });
  }

  if (sessionResult.status === "unauthenticated") {
    return fail("UNAUTHORIZED", "请先登录", { status: 401 });
  }

  const rateLimitFailure = await userActionRateLimitResponse(
    sessionResult.user.id,
    "conversation-compile",
    process.env.RATE_LIMIT_AI_TOOL_PER_MIN,
    20,
  );
  if (rateLimitFailure) return rateLimitFailure;

  const body = await readJsonBodySafe(request);

  if (!body.ok) {
    return body.response;
  }

  const json = body.data;
  const parsed = compileSchema.safeParse(json);

  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "对话参数不合法", {
      status: 400,
      details: parsed.error.flatten(),
    });
  }

  if (!(await getConfiguredModel(parsed.data.modelId))) {
    return fail("MODEL_NOT_AVAILABLE", "当前模型不可用", { status: 404 });
  }

  const messages = trimConversationMessages(parsed.data.messages, {
    maxMessages: 40,
    maxContentLength: 1200,
  });

  try {
    const compiled = await compileWithOpusModel({
      modelId: parsed.data.modelId,
      messages,
      params: parsed.data.params,
      logContext: { source: "web", userId: sessionResult.user.id },
    });

    // 1) Opus 5.5 已配置 → 直接用其编译结果。
    if (compiled) {
      return ok(compiled);
    }

    // 2) 未配置 Opus → 本地拼接回退（不算错误）。
    return ok(compilePromptFallback(messages, "NO_COMPILER_MODEL_CONFIGURED"));
  } catch (error) {
    const fallbackReason = compilerErrorMessage(error);

    logger.warn(
      {
        error: fallbackReason,
        modelId: parsed.data.modelId,
      },
      "Conversation compiler failed; falling back to local prompt compilation.",
    );

    return ok(compilePromptFallback(messages, fallbackReason));
  }
}
