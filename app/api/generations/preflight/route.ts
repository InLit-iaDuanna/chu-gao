import { z } from "zod";

import { fail, ok } from "@/lib/api-response";
import { checkSession } from "@/lib/auth";
import { assertProviderAvailable } from "@/lib/providers";
import { isDatabaseUnavailableError } from "@/lib/service-errors";
import { getModel } from "@/lib/models/registry";
import { readJsonBodySafe } from "@/lib/request-body";

const requestSchema = z
  .object({
    modelIds: z.array(z.string().trim().min(1).max(128)).min(1).max(16),
  })
  .strict();

export async function POST(request: Request) {
  const session = await checkSession(request);
  if (session.status === "unavailable")
    return fail("AUTH_UNAVAILABLE", "认证服务暂时不可用", { status: 503 });
  if (session.status === "unauthenticated")
    return fail("UNAUTHORIZED", "请先登录", { status: 401 });
  if (!process.env.DATABASE_URL)
    return fail("SERVICE_UNAVAILABLE", "生成服务未配置数据库", { status: 503 });

  const body = await readJsonBodySafe(request);
  if (!body.ok) return body.response;
  const parsed = requestSchema.safeParse(body.data);
  if (!parsed.success)
    return fail("VALIDATION_ERROR", "路由预检查参数不合法", { status: 400 });

  const modelIds = [...new Set(parsed.data.modelIds)];
  const availableModelIds: string[] = [];
  const unavailableModelIds: string[] = [];

  try {
    for (const modelId of modelIds) {
      if (!getModel(modelId)) {
        unavailableModelIds.push(modelId);
        continue;
      }
      try {
        await assertProviderAvailable(modelId);
        availableModelIds.push(modelId);
      } catch (error) {
        if (isDatabaseUnavailableError(error)) throw error;
        unavailableModelIds.push(modelId);
      }
    }
  } catch (error) {
    if (isDatabaseUnavailableError(error))
      return fail("SERVICE_UNAVAILABLE", "生成服务暂时不可用", { status: 503 });
    throw error;
  }

  return ok({
    selectedModelId: availableModelIds[0] ?? null,
    availableModelIds,
    unavailableModelIds,
  });
}
