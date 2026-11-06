import { z } from "zod";

import {
  getConversationCompileSystemPrompt,
  getConversationConfig,
} from "@/lib/ai-config";
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
import { isDeepSeekConfigured, optimizeImagePrompt } from "@/lib/deepseek";
import { fetchWithTimeout } from "@/lib/http";
import { logger } from "@/lib/logger";
import { getConfiguredModel } from "@/lib/models/runtime-config";

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

// 提取 OpenAI 兼容 chat/completions 的助手文本内容。
function extractChatContent(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) {
    return "";
  }

  const choices = (payload as { choices?: unknown }).choices;

  if (!Array.isArray(choices) || choices.length === 0) {
    return "";
  }

  const message = (choices[0] as { message?: { content?: unknown } }).message;
  const content = message?.content;

  return typeof content === "string" ? content : "";
}

function parseJsonObject(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // 容错：剥离 ```json ``` 代码块后再尝试，最后退而求其次截取第一个 {...}。
    const fenced = text
      .replace(/```json\s*/gi, "")
      .replace(/```/g, "")
      .trim();

    try {
      return JSON.parse(fenced);
    } catch {
      const match = fenced.match(/\{[\s\S]*\}/);

      if (!match) {
        throw new Error("compiler returned non-json response");
      }

      return JSON.parse(match[0]);
    }
  }
}

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

// 用「对话模型」（DeepSeek 兼容）把多轮对话编译成出图 prompt。
// 系统提示词 = 后台「出图提示词编译指令」。未配置 / 出错时由上层回退本地拼接。
async function compileWithConversationModel({
  messages,
  modelId,
  params,
}: {
  messages: ConversationMessage[];
  modelId: string;
  params?: Record<string, unknown>;
}): Promise<CompiledConversationPrompt | null> {
  const config = await getConversationConfig();

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

  const response = await fetchWithTimeout(url, {
    method: "POST",
    timeoutMs: Number(process.env.CONVERSATION_COMPILER_TIMEOUT_MS ?? 20_000),
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.6,
      max_tokens: 1200,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPayload },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(
      `compiler error: ${response.status} ${(await response.text()).slice(0, 240)}`,
    );
  }

  const payload = await response.json();
  const text = extractChatContent(payload);

  if (!text.trim()) {
    throw new Error("compiler returned empty content");
  }

  return toCompiledPrompt(parseJsonObject(text), config.model);
}

// 把对话渲染成一段可供 DeepSeek 优化的文本。
function renderConversation(messages: ConversationMessage[]): string {
  return messages
    .filter((message) => message.content.trim())
    .map(
      (message) =>
        `${message.role === "user" ? "用户" : "助手"}：${message.content.trim()}`,
    )
    .join("\n");
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
    const compiled = await compileWithConversationModel({
      modelId: parsed.data.modelId,
      messages,
      params: parsed.data.params,
    });

    // 1) 对话模型已配置 → 直接用其编译结果。
    if (compiled) {
      return ok(compiled);
    }

    // 2) 退而求其次：若配置了 DeepSeek，则用其把整段对话优化成出图 prompt。
    if (await isDeepSeekConfigured()) {
      const optimized = await optimizeImagePrompt({
        fixedPrompt: "",
        variablePrompt: renderConversation(messages),
      });
      if (optimized.trim()) {
        return ok({
          prompt: optimized.trim(),
          assistantMessage: "已根据对话整理出图提示词。",
          shouldGenerate: true,
          compiler: "deepseek",
        } satisfies CompiledConversationPrompt);
      }
    }

    // 3) 都未配置 → 本地拼接回退（不算错误）。
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
