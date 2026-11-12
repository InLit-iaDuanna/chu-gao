import { fail, ok } from "@/lib/api-response";
import { serializeAdminModelCall } from "@/lib/admin-model-call";
import { adminFailureResponse, checkSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { sanitizeCallContent } from "@/lib/model-call-log";
import { isRecord, parseModelCallContent } from "@/lib/model-call-content";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const failure = adminFailureResponse(await checkSession(request));
  if (failure) return failure;

  const { id } = await context.params;
  try {
    const item = await db.modelCallLog.findUnique({ where: { id } });
    if (!item) return fail("NOT_FOUND", "调用记录不存在", { status: 404 });

    const user = item.userId
      ? await db.user.findUnique({
          where: { id: item.userId },
          select: { email: true, name: true },
        })
      : null;

    const result = serializeAdminModelCall(item, user);

    if (item.generationId) {
      const generation = await db.generation.findUnique({
        where: { id: item.generationId },
        select: {
          prompt: true,
          negativePrompt: true,
          paramsRaw: true,
          referenceImageKeys: true,
          status: true,
          errorCode: true,
          errorMessage: true,
          _count: { select: { images: true } },
        },
      });
      if (generation) {
        result.requestContent ??=
          sanitizeCallContent({
            prompt: generation.prompt,
            negativePrompt: generation.negativePrompt,
            params: generation.paramsRaw,
            referenceImageKeys: generation.referenceImageKeys,
          }) ?? null;
        result.responseContent ??=
          sanitizeCallContent({
            status: generation.status,
            imageCount: generation._count.images,
            errorCode: generation.errorCode,
            errorMessage: generation.errorMessage,
          }) ?? null;
      }
    }

    if (item.chatAttemptId) {
      const attempt = await db.chatAttempt.findUnique({
        where: { id: item.chatAttemptId },
        select: {
          rawText: true,
          error: true,
          usage: true,
          turn: { select: { input: true, configSnapshot: true } },
        },
      });
      if (attempt) {
        const request = parseModelCallContent(result.requestContent);
        if (
          request.kind === "json" &&
          request.truncated &&
          isRecord(request.value) &&
          isRecord(attempt.turn.input) &&
          typeof attempt.turn.input.content === "string"
        ) {
          result.requestContent =
            sanitizeCallContent({
              ...request.value,
              latest_user_input: attempt.turn.input.content,
            }) ?? result.requestContent;
        }
        const response = parseModelCallContent(result.responseContent);
        if (
          attempt.rawText &&
          (response.kind === "empty" ||
            response.kind === "text" ||
            (response.kind === "json" && response.truncated))
        ) {
          result.responseContent =
            sanitizeCallContent({
              text: attempt.rawText,
              error: attempt.error,
              usage: attempt.usage,
            }) ?? null;
        }
        result.requestContent ??=
          sanitizeCallContent({
            input: attempt.turn.input,
            config: attempt.turn.configSnapshot,
          }) ?? null;
        result.responseContent ??=
          sanitizeCallContent({
            text: attempt.rawText,
            error: attempt.error,
            usage: attempt.usage,
          }) ?? null;
      }
    }

    return ok(result);
  } catch {
    return fail("INTERNAL_ERROR", "调用详情读取失败", { status: 500 });
  }
}
