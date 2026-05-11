import { fail, ok } from "@/lib/api-response";
import { audit } from "@/lib/audit";
import {
  adminFailureResponse,
  authenticatedUser,
  checkSession,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { adminDeleteGenerationsSchema } from "@/lib/validators";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const sessionResult = await checkSession(request);
  const { id } = await context.params;
  const failure = adminFailureResponse(sessionResult);

  if (failure) {
    return failure;
  }

  if (!process.env.DATABASE_URL) {
    return fail("SERVICE_UNAVAILABLE", "任务服务未配置数据库", { status: 503 });
  }

  const json = (await request.json()) as unknown;
  const parsed = adminDeleteGenerationsSchema.safeParse(json);

  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "删除参数不合法", {
      status: 400,
      details: parsed.error.flatten(),
    });
  }

  if (parsed.data.mode === "beforeDate" && !parsed.data.beforeDate) {
    return fail("VALIDATION_ERROR", "缺少截止时间", { status: 400 });
  }

  const deleted = await db.generation.updateMany({
    where: {
      userId: id,
      deletedAt: null,
      ...(parsed.data.mode === "failed" ? { status: "FAILED" } : {}),
      ...(parsed.data.mode === "beforeDate"
        ? { createdAt: { lt: new Date(parsed.data.beforeDate as string) } }
        : {}),
    },
    data: { deletedAt: new Date() },
  });
  const admin = authenticatedUser(sessionResult);

  await audit({
    actorId: admin.id,
    action: "admin.user.generations_soft_delete",
    target: id,
    diff: { ...parsed.data, count: deleted.count },
    request,
  });

  return ok({ deleted: deleted.count });
}
