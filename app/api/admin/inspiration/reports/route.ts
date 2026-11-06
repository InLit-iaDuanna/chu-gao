import { ContentReportStatus } from "@prisma/client";

import { fail, ok } from "@/lib/api-response";
import { adminFailureResponse, checkSession } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(request: Request) {
  const sessionResult = await checkSession(request);
  const failure = adminFailureResponse(sessionResult);
  if (failure) return failure;
  const params = new URL(request.url).searchParams;
  const requestedStatus = params.get("status") ?? ContentReportStatus.OPEN;
  const status = Object.values(ContentReportStatus).includes(
    requestedStatus as ContentReportStatus,
  )
    ? (requestedStatus as ContentReportStatus)
    : ContentReportStatus.OPEN;
  const parsedLimit = Number(params.get("limit") ?? 50);
  const take = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(Math.trunc(parsedLimit), 1), 100)
    : 50;
  const cursor = params.get("cursor");
  if (cursor && cursor.length > 160) {
    return fail("VALIDATION_ERROR", "分页游标不合法", { status: 400 });
  }
  const rows = await db.contentReport.findMany({
    where: { status },
    include: {
      post: {
        select: {
          id: true,
          title: true,
          authorNameSnapshot: true,
          status: true,
          deletedAt: true,
        },
      },
      comment: {
        select: {
          id: true,
          content: true,
          postId: true,
          authorNameSnapshot: true,
          deletedAt: true,
        },
      },
      reporter: { select: { id: true, name: true, email: true } },
      reviewer: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const items = rows.slice(0, take);
  return ok({
    items,
    nextCursor: rows.length > take ? items.at(-1)?.id ?? null : null,
  });
}
