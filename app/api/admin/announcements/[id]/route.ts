import { fail, ok } from "@/lib/api-response";
import {
  displayModeToDb,
  serializeAnnouncement,
  toneToDb,
} from "@/lib/announcements";
import { audit } from "@/lib/audit";
import {
  adminFailureResponse,
  authenticatedUser,
  checkSession,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { readJsonBodySafe } from "@/lib/request-body";
import { announcementPatchSchema } from "@/lib/validators";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const sessionResult = await checkSession(request);
  const { id } = await context.params;
  const failure = adminFailureResponse(sessionResult);

  if (failure) {
    return failure;
  }

  if (sessionResult.status !== "authenticated") {
    return fail("UNAUTHORIZED", "缺少管理员身份", { status: 401 });
  }

  if (!process.env.DATABASE_URL) {
    return fail("SERVICE_UNAVAILABLE", "公告服务未配置数据库", { status: 503 });
  }

  const admin = authenticatedUser(sessionResult);
  const body = await readJsonBodySafe(request);

  if (!body.ok) {
    return body.response;
  }

  const parsed = announcementPatchSchema.safeParse(body.data);

  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "公告参数不合法", {
      status: 400,
      details: parsed.error.flatten(),
    });
  }

  const existing = await db.announcement.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!existing) {
    return fail("NOT_FOUND", "公告不存在", { status: 404 });
  }

  const input = parsed.data;

  try {
    const row = await db.announcement.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.tone !== undefined ? { tone: toneToDb(input.tone) } : {}),
        ...(input.displayMode !== undefined
          ? { displayMode: displayModeToDb(input.displayMode) }
          : {}),
        ...(input.linkLabel !== undefined
          ? { linkLabel: input.linkLabel || null }
          : {}),
        ...(input.linkUrl !== undefined
          ? { linkUrl: input.linkUrl || null }
          : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.startsAt !== undefined
          ? { startsAt: input.startsAt ? new Date(input.startsAt) : null }
          : {}),
        ...(input.endsAt !== undefined
          ? { endsAt: input.endsAt ? new Date(input.endsAt) : null }
          : {}),
      },
    });

    await audit({
      actorId: admin.id,
      action: "admin.announcement.update",
      target: id,
      diff: input as Record<string, unknown>,
      request,
    });

    return ok(serializeAnnouncement(row));
  } catch (error) {
    return fail("INTERNAL_ERROR", "公告更新失败", {
      status: 500,
      details: error instanceof Error ? error.message : "unknown",
    });
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const sessionResult = await checkSession(request);
  const { id } = await context.params;
  const failure = adminFailureResponse(sessionResult);

  if (failure) {
    return failure;
  }

  if (sessionResult.status !== "authenticated") {
    return fail("UNAUTHORIZED", "缺少管理员身份", { status: 401 });
  }

  if (!process.env.DATABASE_URL) {
    return fail("SERVICE_UNAVAILABLE", "公告服务未配置数据库", { status: 503 });
  }

  const admin = authenticatedUser(sessionResult);

  const existing = await db.announcement.findUnique({
    where: { id },
    select: { id: true, title: true },
  });

  if (!existing) {
    return fail("NOT_FOUND", "公告不存在", { status: 404 });
  }

  try {
    await db.announcement.delete({ where: { id } });

    await audit({
      actorId: admin.id,
      action: "admin.announcement.delete",
      target: id,
      diff: { title: existing.title },
      request,
    });

    return ok({ id });
  } catch (error) {
    return fail("INTERNAL_ERROR", "公告删除失败", {
      status: 500,
      details: error instanceof Error ? error.message : "unknown",
    });
  }
}
