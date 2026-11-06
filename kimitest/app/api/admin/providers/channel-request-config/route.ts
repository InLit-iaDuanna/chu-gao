import { fail, ok } from "@/lib/api-response";
import { audit } from "@/lib/audit";
import {
  adminFailureResponse,
  authenticatedUser,
  checkSession,
} from "@/lib/auth";
import {
  DEFAULT_CHANNEL_REQUEST_CONFIG,
  getChannelRequestConfigMap,
  setChannelRequestConfig,
} from "@/lib/provider-channel-request-config";
import { readJsonBodySafe } from "@/lib/request-body";
import { channelRequestConfigPatchSchema } from "@/lib/validators";

// 渠道请求格式配置（按 baseUrl）。结构化字段 + 可选原始请求体模板。
export async function GET(request: Request) {
  const sessionResult = await checkSession(request);
  const failure = adminFailureResponse(sessionResult);

  if (failure) {
    return failure;
  }

  if (sessionResult.status !== "authenticated") {
    return fail("UNAUTHORIZED", "缺少管理员身份", { status: 401 });
  }

  if (!process.env.DATABASE_URL) {
    return fail("SERVICE_UNAVAILABLE", "渠道服务未配置数据库", { status: 503 });
  }

  return ok({ configs: await getChannelRequestConfigMap() });
}

export async function PATCH(request: Request) {
  const sessionResult = await checkSession(request);
  const failure = adminFailureResponse(sessionResult);

  if (failure) {
    return failure;
  }

  if (sessionResult.status !== "authenticated") {
    return fail("UNAUTHORIZED", "缺少管理员身份", { status: 401 });
  }

  if (!process.env.DATABASE_URL) {
    return fail("SERVICE_UNAVAILABLE", "渠道服务未配置数据库", { status: 503 });
  }

  const admin = authenticatedUser(sessionResult);
  const body = await readJsonBodySafe(request);

  if (!body.ok) {
    return body.response;
  }

  const parsed = channelRequestConfigPatchSchema.safeParse(body.data);

  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "渠道请求格式参数不合法", {
      status: 400,
      details: parsed.error.flatten(),
    });
  }

  const bodyTemplate = parsed.data.bodyTemplate?.trim()
    ? parsed.data.bodyTemplate
    : undefined;

  const configs = await setChannelRequestConfig(parsed.data.baseUrl, {
    sizes: parsed.data.sizes ?? [],
    quality: "auto",
    responseFormat:
      parsed.data.responseFormat ??
      DEFAULT_CHANNEL_REQUEST_CONFIG.responseFormat,
    bodyTemplate,
  });

  await audit({
    actorId: admin.id,
    action: "admin.channel_request_config.update",
    target: parsed.data.baseUrl,
    diff: {
      sizeCount: parsed.data.sizes?.length ?? 0,
      responseFormat: parsed.data.responseFormat,
      hasTemplate: Boolean(bodyTemplate),
    },
    request,
  });

  return ok({ configs });
}
