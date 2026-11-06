import { fail, ok } from "@/lib/api-response";
import { checkSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { postInclude, serializePostsForViewer } from "@/lib/inspiration";

export async function GET(request: Request) {
  const sessionResult = await checkSession(request);
  if (sessionResult.status !== "authenticated") return fail("UNAUTHORIZED", "请先登录", { status: 401 });
  const rows = await db.designPost.findMany({
    where: { authorId: sessionResult.user.id, deletedAt: null },
    include: postInclude,
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return ok({ items: await serializePostsForViewer(rows, sessionResult.user) });
}
