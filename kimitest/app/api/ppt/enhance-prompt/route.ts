import { z } from "zod";

import { fail, ok } from "@/lib/api-response";
import { userActionRateLimitResponse } from "@/lib/api-rate-limit";
import { checkSession } from "@/lib/auth";
import { enhanceSlidePrompt } from "@/lib/deepseek";
import { readJsonBodySafe } from "@/lib/request-body";

export const dynamic = "force-dynamic";

const enhancePromptSchema = z.object({
  prompt: z.string().trim().min(1).max(4000),
  theme: z.string().trim().min(1).max(120),
  slideType: z.enum([
    "title",
    "content",
    "section",
    "closing",
    "image",
    "quote",
    "two-column",
  ]),
});

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
    "ppt-enhance",
    process.env.RATE_LIMIT_AI_TOOL_PER_MIN,
    20,
  );
  if (rateLimitFailure) return rateLimitFailure;

  const body = await readJsonBodySafe(request);

  if (!body.ok) {
    return body.response;
  }

  const parsed = enhancePromptSchema.safeParse(body.data);

  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "提示词增强参数不合法", {
      status: 400,
      details: parsed.error.flatten(),
    });
  }

  const enhancedPrompt = await enhanceSlidePrompt(parsed.data);

  return ok({ enhancedPrompt });
}
