import { z } from "zod";

import { checkSession } from "@/lib/auth";
import { creativeAssistantEnabled } from "@/lib/creative-config";
import {
  requestStructuredVision,
  toVisionImagePart,
} from "@/lib/creative-vision";
import { creativeBriefSchema } from "@/lib/creative-brief";
import { fail, ok } from "@/lib/api-response";
import { userActionRateLimitResponse } from "@/lib/api-rate-limit";
import { db } from "@/lib/db";
import { readJsonBodySafe } from "@/lib/request-body";
import { readPrivateStorageKey } from "@/lib/storage";

const inputSchema = z.object({
  generationId: z.string().min(1).max(128),
  imageId: z.string().min(1).max(128),
  brief: creativeBriefSchema,
});

const outputSchema = z.object({
  status: z.enum(["pass", "review", "fail"]),
  score: z.number().int().min(0).max(100),
  summary: z.string().min(1).max(800),
  findings: z.array(z.string().min(1).max(240)).max(8).default([]),
});

export async function POST(request: Request) {
  if (!creativeAssistantEnabled())
    return fail("FEATURE_DISABLED", "辅助创作暂未开放", { status: 503 });

  const session = await checkSession(request);
  if (session.status !== "authenticated") {
    return fail(
      session.status === "unavailable" ? "AUTH_UNAVAILABLE" : "UNAUTHORIZED",
      "请重新登录后重试",
      { status: session.status === "unavailable" ? 503 : 401 },
    );
  }

  const limited = await userActionRateLimitResponse(
    session.user.id,
    "creative-check",
    process.env.RATE_LIMIT_AI_TOOL_PER_MIN,
    6,
  );
  if (limited) return limited;

  const body = await readJsonBodySafe(request);
  if (!body.ok) return body.response;
  const parsed = inputSchema.safeParse(body.data);
  if (!parsed.success)
    return fail("VALIDATION_ERROR", "质量检查参数不正确", { status: 400 });

  try {
    const image = await db.generatedImage.findFirst({
      where: {
        id: parsed.data.imageId,
        generationId: parsed.data.generationId,
        generation: { userId: session.user.id, deletedAt: null },
      },
      select: { storageKey: true },
    });
    if (!image)
      return fail("NOT_FOUND", "这张结果图片不存在或不可用", { status: 404 });

    const part = await toVisionImagePart(
      await readPrivateStorageKey(image.storageKey),
    );
    const result = await requestStructuredVision({
      logContext: {
        source: "web",
        userId: session.user.id,
        generationId: parsed.data.generationId,
        imageId: parsed.data.imageId,
        operation: "creative.check",
      },
      images: [part],
      systemPrompt: `你是图像创作 Agent 的结果验收工具。根据用户方案检查这张生成结果。只检查方案中明确的主体、保持不变、本次修改、排除内容和风格；无法从单张图确认的内容标记为 review，不要凭审美臆测。严格输出 JSON：{"status":"pass|review|fail","score":0,"summary":"不超过800字","findings":["具体发现"]}。有明确违反排除内容或本次修改失败时用 fail；信息不足但没有明确错误时用 review；主要要求都满足时用 pass。不要输出 Markdown。`,
      userText: `请验收这张结果图。用户方案如下：\n${JSON.stringify(parsed.data.brief)}`,
      schema: outputSchema,
    });
    return ok({
      ...result,
      generationId: parsed.data.generationId,
      imageId: parsed.data.imageId,
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "VISION_UNAVAILABLE") {
      return fail("VISION_UNAVAILABLE", "当前辅助模型不支持图片质量检查", {
        status: 503,
      });
    }
    if (code === "REFERENCE_TOO_LARGE") {
      return fail("VISION_ANALYSIS_FAILED", "结果图片暂时无法读取", {
        status: 503,
      });
    }
    return fail(
      "VISION_ANALYSIS_FAILED",
      "自动质量检查暂时失败，可以稍后重试",
      {
        status: 503,
      },
    );
  }
}
