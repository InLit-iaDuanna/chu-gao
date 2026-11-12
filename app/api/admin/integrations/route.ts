import { fail, ok } from "@/lib/api-response";
import { audit } from "@/lib/audit";
import {
  adminFailureResponse,
  authenticatedUser,
  checkSession,
} from "@/lib/auth";
import { getPptSystemPrompt, setPptSystemPrompt } from "@/lib/ai-config";
import { readJsonBodySafe } from "@/lib/request-body";
import { integrationsPatchSchema } from "@/lib/validators";

async function currentIntegrations() {
  const pptSystemPrompt = await getPptSystemPrompt();

  return { pptSystemPrompt };
}

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
    return fail("SERVICE_UNAVAILABLE", "配置服务未配置数据库", { status: 503 });
  }

  return ok(await currentIntegrations());
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
    return fail("SERVICE_UNAVAILABLE", "配置服务未配置数据库", { status: 503 });
  }

  const admin = authenticatedUser(sessionResult);
  const body = await readJsonBodySafe(request);

  if (!body.ok) {
    return body.response;
  }

  const parsed = integrationsPatchSchema.safeParse(body.data);

  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "集成配置参数不合法", {
      status: 400,
      details: parsed.error.flatten(),
    });
  }

  if (parsed.data.pptSystemPrompt !== undefined) {
    await setPptSystemPrompt(parsed.data.pptSystemPrompt);
  }

  // 审计不记录明文密钥，仅记录是否更新了密钥。
  await audit({
    actorId: admin.id,
    action: "admin.integrations.update",
    target: "ai-config",
    diff: {
      pptSystemPromptChanged: parsed.data.pptSystemPrompt !== undefined,
    },
    request,
  });

  return ok(await currentIntegrations());
}
