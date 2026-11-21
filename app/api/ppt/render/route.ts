// 对话里的演示文稿：用户在大纲卡片上选择制作方式。
// image = 整页设计图（服务端逐页出图，见 lib/ppt-deck）；code = 可编辑幻灯片（由对话模型排版）。

import { z } from "zod";

import { fail, ok } from "@/lib/api-response";
import { userActionRateLimitResponse } from "@/lib/api-rate-limit";
import { checkSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { DeckError, startDeckRender } from "@/lib/ppt-deck";
import { readJsonBodySafe } from "@/lib/request-body";

const renderSchema = z.object({
  id: z.string().min(1),
  mode: z.enum(["image", "code"]),
});

export async function POST(request: Request) {
  const sessionResult = await checkSession(request);
  if (sessionResult.status === "unavailable")
    return fail("AUTH_UNAVAILABLE", "认证服务暂时不可用", { status: 503 });
  if (sessionResult.status === "unauthenticated")
    return fail("UNAUTHORIZED", "请先登录", { status: 401 });

  const rateLimitFailure = await userActionRateLimitResponse(
    sessionResult.user.id,
    "ppt-render",
    process.env.RATE_LIMIT_PPT_PER_MIN,
    10,
  );
  if (rateLimitFailure) return rateLimitFailure;

  const body = await readJsonBodySafe(request);
  if (!body.ok) return body.response;
  const parsed = renderSchema.safeParse(body.data);
  if (!parsed.success)
    return fail("VALIDATION_ERROR", "参数不合法", {
      status: 400,
      details: parsed.error.flatten(),
    });

  try {
    await startDeckRender({
      userId: sessionResult.user.id,
      deckId: parsed.data.id,
      mode: parsed.data.mode,
    });
    return ok({ id: parsed.data.id, mode: parsed.data.mode });
  } catch (error) {
    if (error instanceof DeckError)
      return fail(error.code, error.message, { status: error.status });
    logger.error({ error }, "PPT render start failed.");
    return fail("INTERNAL_ERROR", "演示文稿没有开始制作，请稍后再试", {
      status: 500,
    });
  }
}
