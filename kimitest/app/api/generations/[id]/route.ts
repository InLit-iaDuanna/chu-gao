import { fail, ok } from "@/lib/api-response";
import { checkSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { serializeGeneration } from "@/lib/generations";
import { getProviderChannelDisplayNameMap } from "@/lib/provider-channel-config";
import { isDatabaseUnavailableError } from "@/lib/service-errors";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const sessionResult = await checkSession(request);
  const { id } = await context.params;

  if (!process.env.DATABASE_URL) {
    return fail("SERVICE_UNAVAILABLE", "生成服务未配置数据库", { status: 503 });
  }

  if (sessionResult.status === "unavailable") {
    return fail("AUTH_UNAVAILABLE", "认证服务暂时不可用", { status: 503 });
  }

  if (sessionResult.status === "unauthenticated") {
    return fail("UNAUTHORIZED", "请先登录", { status: 401 });
  }

  try {
    const session = sessionResult.user;
    const generation = await db.generation.findFirst({
      where: {
        id,
        userId: session.id,
        deletedAt: null,
      },
      include: {
        images: true,
        provider: {
          select: {
            id: true,
            name: true,
          },
        },
        providerAccount: {
          select: {
            id: true,
            name: true,
            baseUrl: true,
          },
        },
      },
    });

    if (!generation) {
      return fail("NOT_FOUND", "任务不存在", { status: 404 });
    }

    const displayNameMap = await getProviderChannelDisplayNameMap();

    return ok(serializeGeneration(generation, { displayNameMap }));
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      return fail("SERVICE_UNAVAILABLE", "生成服务暂时不可用", { status: 503 });
    }

    throw error;
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const sessionResult = await checkSession(request);
  const { id } = await context.params;

  if (sessionResult.status === "unavailable") {
    return fail("AUTH_UNAVAILABLE", "认证服务暂时不可用", { status: 503 });
  }

  if (sessionResult.status === "unauthenticated") {
    return fail("UNAUTHORIZED", "请先登录", { status: 401 });
  }

  if (!process.env.DATABASE_URL) {
    return fail("SERVICE_UNAVAILABLE", "生成服务未配置数据库", { status: 503 });
  }

  try {
    const session = sessionResult.user;
    const generation = await db.generation.findFirst({
      where: {
        id,
        userId: session.id,
        deletedAt: null,
      },
      select: {
        id: true,
      },
    });

    if (!generation) {
      return fail("NOT_FOUND", "任务不存在", { status: 404 });
    }

    await db.generation.update({
      where: { id },
      data: {
        deletedAt: new Date(),
      },
    });

    return ok({ deleted: true });
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      return fail("SERVICE_UNAVAILABLE", "生成服务暂时不可用", { status: 503 });
    }

    throw error;
  }
}
