import { z } from "zod";

import { fail, ok } from "@/lib/api-response";
import { checkSession } from "@/lib/auth";
import {
  compilePromptFallback,
  trimConversationMessages,
  type CompiledConversationPrompt,
  type ConversationMessage,
} from "@/lib/conversation";
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

function extractOutputText(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) {
    return "";
  }

  const maybeOutputText = (payload as { output_text?: unknown }).output_text;

  if (typeof maybeOutputText === "string") {
    return maybeOutputText;
  }

  const output = (payload as { output?: unknown }).output;

  if (!Array.isArray(output)) {
    return "";
  }

  return output
    .flatMap((item) => {
      if (typeof item !== "object" || item === null) {
        return [];
      }

      const content = (item as { content?: unknown }).content;

      if (!Array.isArray(content)) {
        return [];
      }

      return content.flatMap((part) => {
        if (typeof part !== "object" || part === null) {
          return [];
        }

        const text = (part as { text?: unknown }).text;

        return typeof text === "string" ? [text] : [];
      });
    })
    .join("\n");
}

function parseJsonObject(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);

    if (!match) {
      throw new Error("compiler returned non-json response");
    }

    return JSON.parse(match[0]);
  }
}

function toCompiledPrompt(value: unknown): CompiledConversationPrompt {
  const parsed = z
    .object({
      prompt: z.string().min(1).max(4000),
      assistantMessage: z.string().min(1).max(400),
      shouldGenerate: z.boolean().default(true),
    })
    .parse(value);

  const compiler = process.env.CONVERSATION_COMPILER_MODEL ?? "gpt-5.5";

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

async function compileWithGpt55({
  messages,
  modelId,
  params,
}: {
  messages: ConversationMessage[];
  modelId: string;
  params?: Record<string, unknown>;
}): Promise<CompiledConversationPrompt> {
  const apiKey = process.env.OPENAI_API_KEY ?? process.env.IMAGE2_API_KEY;
  const trimmedMessages = trimConversationMessages(messages, {
    maxMessages: 40,
    maxContentLength: 1200,
  });

  if (!apiKey) {
    return compilePromptFallback(trimmedMessages, "OPENAI_API_KEY_MISSING");
  }

  const model = await getConfiguredModel(modelId);

  if (!model) {
    throw new Error("UNKNOWN_MODEL");
  }

  const response = await fetchWithTimeout(
    `${process.env.OPENAI_BASE_URL ?? "https://api.openai.com"}/v1/responses`,
    {
      method: "POST",
      timeoutMs: Number(process.env.CONVERSATION_COMPILER_TIMEOUT_MS ?? 20_000),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.CONVERSATION_COMPILER_MODEL ?? "gpt-5.5",
        reasoning: {
          effort: process.env.CONVERSATION_COMPILER_REASONING ?? "low",
        },
        text: {
          verbosity: "low",
          format: {
            type: "json_schema",
            name: "compiled_image_prompt",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["prompt", "assistantMessage", "shouldGenerate"],
              properties: {
                prompt: {
                  type: "string",
                  minLength: 1,
                  maxLength: 4000,
                },
                assistantMessage: {
                  type: "string",
                  minLength: 1,
                  maxLength: 400,
                },
                shouldGenerate: {
                  type: "boolean",
                },
              },
            },
          },
        },
        input: [
          {
            role: "system",
            content:
              "你是 Chūgǎo Studio 的图像创作上下文编译器。根据多轮对话，把用户最新意图和历史上下文整理成一个可直接传给图像生成模型的中文 prompt。输出必须符合 JSON schema。",
          },
          {
            role: "user",
            content: JSON.stringify({
              outputSchema: {
                prompt: "最终出图 prompt，必须完整、自包含，不超过 4000 字",
                assistantMessage: "给用户看的短回复，不超过 80 字",
                shouldGenerate:
                  "如果信息足够生成则 true；如果需要先追问则 false",
              },
              targetModel: model,
              currentParams: params,
              messages: trimmedMessages,
            }),
          },
        ],
      }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `compiler error: ${response.status} ${await response.text()}`,
    );
  }

  const payload = await response.json();
  const text = extractOutputText(payload);

  return toCompiledPrompt(parseJsonObject(text));
}

export async function POST(request: Request) {
  const sessionResult = await checkSession(request);

  if (sessionResult.status === "unavailable") {
    return fail("AUTH_UNAVAILABLE", "认证服务暂时不可用", { status: 503 });
  }

  if (sessionResult.status === "unauthenticated") {
    return fail("UNAUTHORIZED", "请先登录", { status: 401 });
  }

  const json = (await request.json()) as unknown;
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
    return ok(
      await compileWithGpt55({
        ...parsed.data,
        modelId: parsed.data.modelId,
        messages,
      }),
    );
  } catch (error) {
    const fallbackReason = compilerErrorMessage(error);

    logger.warn(
      {
        error: fallbackReason,
        modelId: parsed.data.modelId,
        compiler: process.env.CONVERSATION_COMPILER_MODEL ?? "gpt-5.5",
      },
      "Conversation compiler failed; falling back to local prompt compilation.",
    );

    return ok(compilePromptFallback(messages, fallbackReason));
  }
}
