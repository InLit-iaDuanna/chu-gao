import { fail, ok } from "@/lib/api-response";
import {
  listAllAnnouncements,
  serializeAnnouncement,
  toneToDb,
  displayModeToDb,
} from "@/lib/announcements";
import { audit } from "@/lib/audit";
import {
  adminFailureResponse,
  authenticatedUser,
  checkSession,
} from "@/lib/auth";
import { db } from "@/lib/db";
import { readJsonBodySafe } from "@/lib/request-body";
import { announcementCreateSchema } from "@/lib/validators";

export async function GET(request: Request) {
  const sessionResult = await checkSession(request);
  const failure = adminFailureResponse(sessionResult);

  if (failure) {
    return failure;
  }

  if (!process.env.DATABASE_URL) {
    return fail("SERVICE_UNAVAILABLE", "公告服务未配置数据库", { status: 503 });
  }

  try {
    return ok(await listAllAnnouncements());
  } catch (error) {
    return fail("INTERNAL_ERROR", "公告列表读取失败", {
      status: 500,
      details: error instanceof Error ? error.message : "unknown",
    });
  }
}

export async function POST(request: Request) {
  const sessionResult = await checkSession(request);
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

  const parsed = announcementCreateSchema.safeParse(body.data);

  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "公告参数不合法", {
      status: 400,
      details: parsed.error.flatten(),
    });
  }

  try {
    const row = await db.announcement.create({
      data: {
        title: parsed.data.title,
        body: parsed.data.body,
        tone: toneToDb(parsed.data.tone),
        displayMode: displayModeToDb(parsed.data.displayMode),
        linkLabel: parsed.data.linkLabel || null,
        linkUrl: parsed.data.linkUrl || null,
        enabled: parsed.data.enabled,
        startsAt: parsed.data.startsAt ? new Date(parsed.data.startsAt) : null,
        endsAt: parsed.data.endsAt ? new Date(parsed.data.endsAt) : null,
        createdBy: admin.id,
      },
    });

    await audit({
      actorId: admin.id,
      action: "admin.announcement.create",
      target: row.id,
      diff: {
        title: row.title,
        tone: row.tone,
        displayMode: row.displayMode,
        enabled: row.enabled,
      },
      request,
    });

    return ok(serializeAnnouncement(row), { status: 201 });
  } catch (error) {
    return fail("INTERNAL_ERROR", "公告创建失败", {
      status: 500,
      details: error instanceof Error ? error.message : "unknown",
    });
  }
}
