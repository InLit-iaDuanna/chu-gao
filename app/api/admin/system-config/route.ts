import { fail, ok } from "@/lib/api-response";
import { audit } from "@/lib/audit";
import {
  adminFailureResponse,
  authenticatedUser,
  checkSession,
} from "@/lib/auth";
import type { SystemConfigKey } from "@/lib/system-config";
import {
  listRequiredSystemConfigEntries,
  setSystemConfigValue,
  SystemConfigUnavailableError,
} from "@/lib/system-config";
import { systemConfigPatchSchema } from "@/lib/validators";

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
    return fail("SERVICE_UNAVAILABLE", "系统配置服务未配置数据库", {
      status: 503,
    });
  }

  try {
    return ok(await listRequiredSystemConfigEntries());
  } catch (error) {
    if (error instanceof SystemConfigUnavailableError) {
      return fail("SERVICE_UNAVAILABLE", "系统配置服务未配置数据库", {
        status: 503,
      });
    }

    throw error;
  }
}

export async function PATCH(request: Request) {
  const sessionResult = await checkSession(request);
  const failure = adminFailureResponse(sessionResult);

  if (failure) {
    return failure;
  }

  if (!process.env.DATABASE_URL) {
    return fail("SERVICE_UNAVAILABLE", "系统配置服务未配置数据库", {
      status: 503,
    });
  }

  const admin = authenticatedUser(sessionResult);

  const json = (await request.json()) as unknown;
  const parsed = systemConfigPatchSchema.safeParse(json);

  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "系统配置参数不合法", {
      status: 400,
      details: parsed.error.flatten(),
    });
  }

  try {
    await setSystemConfigValue(
      parsed.data.key as SystemConfigKey,
      parsed.data.value,
    );
  } catch (error) {
    if (error instanceof SystemConfigUnavailableError) {
      return fail("SERVICE_UNAVAILABLE", "系统配置服务未配置数据库", {
        status: 503,
      });
    }

    throw error;
  }

  await audit({
    actorId: admin.id,
    action: "admin.system_config.update",
    target: parsed.data.key,
    diff: {
      value: parsed.data.value,
    },
    request,
  });

  return ok({
    key: parsed.data.key,
    value: parsed.data.value,
  });
}
