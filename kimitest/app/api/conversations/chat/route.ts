// 对话聊天后端：基于「对话模型」独立配置的多轮流式聊天（纯对话，不出图）。
// 设计要点：
//  - 配置来源 lib/ai-config 的 getConversationConfig()（DB 优先，env 兜底，含解密 key），仅服务端调用。
//  - 调用 OpenAI 兼容的 ${baseUrl}/v1/chat/completions，stream: true，逐 token 转发为 SSE。
//  - 支持多模态用户内容（文本 + image_url），按 OpenAI vision 格式透传。
//  - 无状态：不落库；消息持久化由前端通过既有 conversations 端点完成。
//  - 任何上游/网络错误都在流内以 `event: error` 输出后正常关闭，绝不向流外抛出。

import { z } from "zod";

import {
  getConversationConfig,
  getConversationPricing,
  getConversationSystemPrompt,
} from "@/lib/ai-config";
import { errorBody, fail, ok } from "@/lib/api-response";
import { userActionRateLimitResponse } from "@/lib/api-rate-limit";
import { authenticatedUser, checkSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { readJsonBodySafe } from "@/lib/request-body";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// 上游流式请求超时（含首字节与后续 token 之间的整体上限）。
const UPSTREAM_TIMEOUT_MS = 60_000;

const MAX_MESSAGES = 50;
const MAX_TEXT_LENGTH = 8_000;
const MAX_IMAGE_PARTS = 8;

// 多模态片段：文本 或 图片（data URL / 远程 URL）。
const textPartSchema = z.object({
  type: z.literal("text"),
  text: z.string().min(1).max(MAX_TEXT_LENGTH),
});

const imagePartSchema = z.object({
  type: z.literal("image_url"),
  image_url: z.object({
    url: z.string().min(1).max(2_000_000),
    detail: z.enum(["auto", "low", "high"]).optional(),
  }),
});

const contentPartSchema = z.discriminatedUnion("type", [
  textPartSchema,
  imagePartSchema,
]);

const messageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.union([
    z.string().min(1).max(MAX_TEXT_LENGTH),
    z
      .array(contentPartSchema)
      .min(1)
      .max(MAX_IMAGE_PARTS + 1)
      .refine(
        (parts) =>
          parts.filter((part) => part.type === "image_url").length <=
          MAX_IMAGE_PARTS,
        { message: `每条消息最多 ${MAX_IMAGE_PARTS} 张图片` },
      ),
  ]),
});

const chatSchema = z.object({
  messages: z.array(messageSchema).min(1).max(MAX_MESSAGES),
  reasoning: z.boolean().optional(),
});

type ChatMessage = z.infer<typeof messageSchema>;

// 上游 delta：兼容标准 content 与思考链 reasoning_content。
interface UpstreamDelta {
  content?: unknown;
  reasoning_content?: unknown;
}

function readDelta(payload: unknown): UpstreamDelta | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const choices = (payload as { choices?: unknown }).choices;

  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }

  const first = choices[0];

  if (typeof first !== "object" || first === null) {
    return null;
  }

  const delta = (first as { delta?: unknown }).delta;

  return typeof delta === "object" && delta !== null
    ? (delta as UpstreamDelta)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function GET(request: Request) {
  const sessionResult = await checkSession(request);

  if (sessionResult.status === "unavailable") {
    return fail("AUTH_UNAVAILABLE", "认证服务暂时不可用", { status: 503 });
  }

  if (sessionResult.status === "unauthenticated") {
    return fail("UNAUTHORIZED", "请先登录", { status: 401 });
  }

  return ok(await getConversationPricing());
}

export async function POST(request: Request) {
  // 1. 鉴权：要求已登录用户。
  const sessionResult = await checkSession(request);

  if (sessionResult.status === "unavailable") {
    return fail("AUTH_UNAVAILABLE", "认证服务暂时不可用", { status: 503 });
  }

  if (sessionResult.status === "unauthenticated") {
    return fail("UNAUTHORIZED", "请先登录", { status: 401 });
  }

  const user = authenticatedUser(sessionResult);
  const rateLimitFailure = await userActionRateLimitResponse(
    user.id,
    "conversation-chat",
    process.env.RATE_LIMIT_CONVERSATION_PER_MIN,
    20,
  );
  if (rateLimitFailure) return rateLimitFailure;

  // 2. 读取并校验请求体。
  const body = await readJsonBodySafe(request);

  if (!body.ok) {
    return body.response;
  }

  const parsed = chatSchema.safeParse(body.data);

  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "对话参数不合法", {
      status: 400,
      details: parsed.error.flatten(),
    });
  }

  // 3. 读取对话模型配置；未启用 / 无 key 视为服务不可用。
  const config = await getConversationConfig();

  if (!config.enabled || !config.apiKey) {
    return fail("SERVICE_UNAVAILABLE", "对话模型未配置", { status: 503 });
  }

  const systemPrompt = await getConversationSystemPrompt();
  const wantsReasoning = parsed.data.reasoning === true && config.reasoning;
  const pricing = await getConversationPricing();
  const chargedCredits = wantsReasoning
    ? pricing.reasoningCredits
    : pricing.standardCredits;
  let charge: { balance: number; usageLogId: string } | null = null;
  try {
    charge = await db.$transaction(async (tx) => {
      const debited = await tx.user.updateMany({
        where: { id: user.id, credits: { gte: chargedCredits } },
        data: { credits: { decrement: chargedCredits } },
      });

      if (debited.count === 0) {
        return null;
      }

      const [account, usageLog] = await Promise.all([
        tx.user.findUniqueOrThrow({
          where: { id: user.id },
          select: { credits: true },
        }),
        tx.usageLog.create({
          data: {
            userId: user.id,
            modelId: config.model,
            action: "conversation.chat",
            creditsDelta: -chargedCredits,
            metadata: {
              mode: wantsReasoning ? "reasoning" : "standard",
              chargedCredits,
            },
          },
          select: { id: true },
        }),
      ]);

      return { balance: account.credits, usageLogId: usageLog.id };
    });
  } catch (error) {
    logger.error({ error }, "Conversation billing failed.");
    return fail("SERVICE_UNAVAILABLE", "额度服务暂时不可用", { status: 503 });
  }

  if (!charge) {
    return fail(
      "INSUFFICIENT_CREDITS",
      `余额不足，本次需要 ${chargedCredits} 点`,
      {
        status: 402,
      },
    );
  }

  // 系统提示词置顶，随后透传用户/助手多轮消息（含多模态）。
  const upstreamMessages: Array<{
    role: ChatMessage["role"];
    content: ChatMessage["content"];
  }> = [
    { role: "system", content: systemPrompt },
    ...parsed.data.messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
  ];

  const url = `${config.baseUrl.replace(/\/+$/, "")}/v1/chat/completions`;
  const encoder = new TextEncoder();

  const sse = (event: string, data: unknown): Uint8Array =>
    encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  let cancelUpstream: (() => void) | null = null;
  let refundCanceledRequest: (() => Promise<void>) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), UPSTREAM_TIMEOUT_MS);

      let closed = false;
      let hasOutput = false;
      let refunded = false;
      let clientDisconnected = false;
      cancelUpstream = () => abort.abort();

      const safeEnqueue = (chunk: Uint8Array): boolean => {
        try {
          controller.enqueue(chunk);
          return true;
        } catch {
          return false;
        }
      };

      const finish = () => {
        if (closed) {
          return;
        }

        closed = true;
        clearTimeout(timeout);

        try {
          controller.close();
        } catch {
          // 客户端可能已断开。
        }
      };

      const emitError = (message: string) => {
        safeEnqueue(sse("error", errorBody("UPSTREAM_ERROR", message).error));
        finish();
      };

      const refundBeforeOutput = async (reason: string): Promise<void> => {
        if (refunded || hasOutput || chargedCredits === 0) {
          return;
        }

        try {
          const result = await db.$transaction(async (tx) => {
            const created = await tx.usageLog.createMany({
              data: [
                {
                  id: `conversation_refund_${charge.usageLogId}`,
                  userId: user.id,
                  modelId: config.model,
                  action: "conversation.refund",
                  creditsDelta: chargedCredits,
                  metadata: {
                    reason,
                    chargedUsageLogId: charge.usageLogId,
                  },
                },
              ],
              skipDuplicates: true,
            });

            const account =
              created.count > 0
                ? await tx.user.update({
                    where: { id: user.id },
                    data: { credits: { increment: chargedCredits } },
                    select: { credits: true },
                  })
                : await tx.user.findUniqueOrThrow({
                    where: { id: user.id },
                    select: { credits: true },
                  });

            return {
              balance: account.credits,
              newlyRefunded: created.count > 0,
            };
          });

          if (result.newlyRefunded) {
            safeEnqueue(
              sse("billing", {
                credits: chargedCredits,
                balance: result.balance,
                refunded: true,
              }),
            );
          }
          refunded = true;
        } catch (error) {
          logger.error(
            { error, usageLogId: charge.usageLogId },
            "Conversation refund failed.",
          );
        }
      };
      refundCanceledRequest = () =>
        refundBeforeOutput("client_disconnected_before_output");

      safeEnqueue(
        sse("billing", {
          credits: chargedCredits,
          balance: charge.balance,
          refunded: false,
        }),
      );

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.apiKey}`,
            Accept: "text/event-stream",
          },
          body: JSON.stringify({
            model: config.model,
            messages: upstreamMessages,
            stream: true,
            // DeepSeek 默认可能开启思考，必须显式传 enabled / disabled。
            thinking: { type: wantsReasoning ? "enabled" : "disabled" },
          }),
          signal: abort.signal,
        });

        if (!response.ok || !response.body) {
          let detail = `上游返回 ${response.status}`;

          try {
            const text = (await response.text()).slice(0, 240);
            if (text) {
              detail = `${detail}: ${text}`;
            }
          } catch {
            // 忽略读取错误正文失败。
          }

          logger.warn(
            { status: response.status },
            "Conversation upstream non-OK.",
          );
          await refundBeforeOutput("upstream_failed_before_output");
          emitError(detail);
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        // 逐行解析上游 SSE：`data: {...}`，以 `data: [DONE]` 结束。
        const handleDataLine = (payload: string): boolean => {
          const trimmed = payload.trim();

          if (!trimmed) {
            return true;
          }

          if (trimmed === "[DONE]") {
            return false;
          }

          let json: unknown;

          try {
            json = JSON.parse(trimmed);
          } catch {
            // 跳过无法解析的分片（如保活注释）。
            return true;
          }

          const delta = readDelta(json);

          if (!delta) {
            return true;
          }

          const reasoning = asString(delta.reasoning_content);
          if (wantsReasoning && reasoning) {
            hasOutput = true;
            if (!safeEnqueue(sse("reasoning", { content: reasoning }))) {
              clientDisconnected = true;
              abort.abort();
              return false;
            }
          }

          const content = asString(delta.content);
          if (content) {
            hasOutput = true;
            if (!safeEnqueue(sse("delta", { content }))) {
              clientDisconnected = true;
              abort.abort();
              return false;
            }
          }

          return true;
        };

        // 处理一段缓冲中的所有完整行，返回 false 表示应停止（[DONE] 或下游断开）。
        const drainBuffer = (final: boolean): boolean => {
          let newlineIndex = buffer.indexOf("\n");

          while (newlineIndex !== -1) {
            const rawLine = buffer.slice(0, newlineIndex).replace(/\r$/, "");
            buffer = buffer.slice(newlineIndex + 1);

            if (rawLine.startsWith("data:")) {
              if (!handleDataLine(rawLine.slice("data:".length))) {
                return false;
              }
            }

            newlineIndex = buffer.indexOf("\n");
          }

          if (final && buffer.startsWith("data:")) {
            const tail = buffer;
            buffer = "";
            if (!handleDataLine(tail.slice("data:".length))) {
              return false;
            }
          }

          return true;
        };

        let done = false;

        while (!done) {
          const { value, done: streamDone } = await reader.read();

          if (streamDone) {
            done = true;
            drainBuffer(true);
            break;
          }

          buffer += decoder.decode(value, { stream: true });

          if (!drainBuffer(false)) {
            done = true;
            break;
          }
        }

        try {
          await reader.cancel();
        } catch {
          // 忽略取消错误。
        }

        if (!hasOutput) {
          await refundBeforeOutput(
            clientDisconnected
              ? "client_disconnected_before_output"
              : "upstream_empty_response",
          );

          if (!clientDisconnected) {
            emitError("对话模型未返回有效内容，本次点数已退回");
          }
          return;
        }

        if (!closed && !clientDisconnected) {
          safeEnqueue(sse("done", {}));
          finish();
        }
      } catch (error) {
        const message =
          error instanceof Error && error.name === "AbortError"
            ? "对话请求超时"
            : error instanceof Error
              ? error.message.replace(/\s+/g, " ").slice(0, 240)
              : "对话请求失败";

        logger.warn({ error: message }, "Conversation chat stream failed.");
        await refundBeforeOutput(
          clientDisconnected
            ? "client_disconnected_before_output"
            : "upstream_failed_before_output",
        );
        if (!clientDisconnected) {
          emitError(message);
        }
      } finally {
        clearTimeout(timeout);
        cancelUpstream = null;
        refundCanceledRequest = null;
      }
    },
    async cancel() {
      cancelUpstream?.();
      await refundCanceledRequest?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
