import { fail, ok } from "@/lib/api-response";
import { checkSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { isDatabaseUnavailableError } from "@/lib/service-errors";

export async function DELETE(request: Request) {
  const sessionResult = await checkSession(request);

  if (sessionResult.status === "unavailable") {
    return fail("AUTH_UNAVAILABLE", "认证服务暂时不可用", { status: 503 });
  }

  if (sessionResult.status === "unauthenticated") {
    return fail("UNAUTHORIZED", "请先登录", { status: 401 });
  }

  if (!process.env.DATABASE_URL) {
    return fail("SERVICE_UNAVAILABLE", "历史服务未配置数据库", {
      status: 503,
    });
  }

  try {
    const session = sessionResult.user;
    const now = new Date();
    const [conversations, generations] = await db.$transaction([
      db.conversation.updateMany({
        where: {
          userId: session.id,
          archivedAt: null,
        },
        data: {
          archivedAt: now,
        },
      }),
      db.generation.updateMany({
        where: {
          userId: session.id,
          deletedAt: null,
        },
        data: {
          deletedAt: now,
        },
      }),
    ]);

    return ok({
      conversations: conversations.count,
      generations: generations.count,
    });
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      return fail("SERVICE_UNAVAILABLE", "历史服务暂时不可用", {
        status: 503,
      });
    }

    throw error;
  }
}
