import { PostStatus } from "@prisma/client";

import { ok } from "@/lib/api-response";
import { adminFailureResponse, checkSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { postInclude, serializePost } from "@/lib/inspiration";

export async function GET(request: Request) {
  const sessionResult = await checkSession(request);
  const failure = adminFailureResponse(sessionResult);
  if (failure) return failure;
  const params = new URL(request.url).searchParams;
  const requestedStatus = params.get("status") ?? PostStatus.PENDING;
  const selected = Object.values(PostStatus).includes(requestedStatus as PostStatus)
    ? (requestedStatus as PostStatus)
    : PostStatus.PENDING;
  const query = params.get("q")?.trim().slice(0, 120);
  const rows = await db.designPost.findMany({
    where: {
      status: selected,
      deletedAt: null,
      ...(query
        ? {
            OR: [
              { title: { contains: query, mode: "insensitive" } },
              { story: { contains: query, mode: "insensitive" } },
              { authorNameSnapshot: { contains: query, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: postInclude,
    orderBy:
      selected === PostStatus.HIDDEN
        ? [{ hiddenAt: "desc" }, { createdAt: "desc" }]
        : [{ createdAt: "desc" }, { id: "desc" }],
    take: 100,
  });
  return ok({
    items: rows.map((row) => ({
      ...serializePost(
        row,
        sessionResult.status === "authenticated" ? sessionResult.user : null,
      ),
      trustTier: row.trustTier,
      rankScore: row.rankScore,
      moderationNote: row.moderationNote,
      hiddenAt: row.hiddenAt?.toISOString() ?? null,
    })),
  });
}
