import { z } from "zod";

import { userActionRateLimitResponse } from "@/lib/api-rate-limit";
import { fail, ok } from "@/lib/api-response";
import {
  authenticatedUser,
  checkSession,
  sessionFailureResponse,
} from "@/lib/auth";
import {
  ChatContextError,
  compactChatContext,
  getChatContextStatus,
} from "@/lib/chat-context";
import { LUNA_MODEL_ID, SOL_MODEL_ID } from "@/lib/chat-model-options";
import { readJsonBodySafe } from "@/lib/request-body";
import { isDatabaseUnavailableError } from "@/lib/service-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const conversationIdSchema = z.string().trim().min(1).max(128);
const modelIdSchema = z.enum(["default", LUNA_MODEL_ID, SOL_MODEL_ID]);
const compactSchema = z
  .object({
    conversationId: conversationIdSchema,
    modelId: modelIdSchema,
  })
  .strict();
const privateHeaders = { "Cache-Control": "private, no-store" };

function contextFailure(error: unknown) {
  if (error instanceof ChatContextError) {
    return fail(error.code, error.message, {
      status: error.statusCode,
      headers: privateHeaders,
      details: error.contextStatus,
    });
  }
  return fail(
    "SERVICE_UNAVAILABLE",
    isDatabaseUnavailableError(error)
      ? "对话数据库暂时不可用"
      : "上下文服务暂时不可用",
    { status: 503, headers: privateHeaders },
  );
}

export async function GET(request: Request) {
  const session = await checkSession(request);
  const failure = sessionFailureResponse(session);
  if (failure) return failure;
  const userId = authenticatedUser(session).id;
  const parsed = conversationIdSchema.safeParse(
    new URL(request.url).searchParams.get("conversationId"),
  );
  if (!parsed.success)
    return fail("VALIDATION_ERROR", "缺少有效的对话 ID", { status: 400 });
  const modelId = new URL(request.url).searchParams.get("modelId");
  const model = modelIdSchema.optional().safeParse(modelId ?? undefined);
  if (!model.success)
    return fail("VALIDATION_ERROR", "不支持的对话模型", {
      status: 400,
      headers: privateHeaders,
    });
  const limited = await userActionRateLimitResponse(
    userId,
    "conversation-context-status",
    undefined,
    60,
  );
  if (limited) return limited;
  try {
    return ok(
      await (model.data
        ? getChatContextStatus(userId, parsed.data, model.data)
        : getChatContextStatus(userId, parsed.data)),
      {
        headers: privateHeaders,
      },
    );
  } catch (error) {
    return contextFailure(error);
  }
}

export async function POST(request: Request) {
  const session = await checkSession(request);
  const failure = sessionFailureResponse(session);
  if (failure) return failure;
  const userId = authenticatedUser(session).id;
  const body = await readJsonBodySafe(request);
  if (!body.ok) return body.response;
  const parsed = compactSchema.safeParse(body.data);
  if (!parsed.success)
    return fail("VALIDATION_ERROR", "上下文压缩参数不合法", { status: 400 });
  const limited = await userActionRateLimitResponse(
    userId,
    "conversation-context-compact",
    undefined,
    2,
  );
  if (limited) return limited;
  try {
    return ok(
      await compactChatContext({
        userId,
        ...parsed.data,
        signal: request.signal,
      }),
      { headers: privateHeaders },
    );
  } catch (error) {
    return contextFailure(error);
  }
}
