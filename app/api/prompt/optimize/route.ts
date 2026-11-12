// 提示词优化端点：把当前草稿用 Opus 5.5 润色成更具体的出图 prompt。
// 未配置 / 出错时本就回退原文，
// 因此本端点始终 200 返回 { prompt }，前端无感降级。

import { fail, ok } from "@/lib/api-response";
import { userActionRateLimitResponse } from "@/lib/api-rate-limit";
import { checkSession } from "@/lib/auth";
import {
  isPromptOptimizerConfigured,
  optimizeImagePrompt,
} from "@/lib/prompt-optimizer";
import { readJsonBodySafe } from "@/lib/request-body";
import { z } from "zod";

export const dynamic = "force-dynamic";

const optimizeSchema = z.object({
  prompt: z.string().trim().min(1).max(4000),
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
    "prompt-optimize",
    process.env.RATE_LIMIT_AI_TOOL_PER_MIN,
    20,
  );
  if (rateLimitFailure) return rateLimitFailure;

  const body = await readJsonBodySafe(request);

  if (!body.ok) {
    return body.response;
  }

  const parsed = optimizeSchema.safeParse(body.data);

  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "提示词不合法", {
      status: 400,
      details: parsed.error.flatten(),
    });
  }

  const optimized = await optimizeImagePrompt({
    logContext: {
      source: "web",
      userId: sessionResult.user.id,
      operation: "prompt.optimize",
    },
    fixedPrompt: "",
    variablePrompt: parsed.data.prompt,
  });

  return ok({
    prompt: optimized,
    // 告知前端是否真正经过了 Opus 优化（否则为原样回退）。
    optimized: await isPromptOptimizerConfigured(),
  });
}
