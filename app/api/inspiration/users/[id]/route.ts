import { fail, ok } from "@/lib/api-response";
import { checkSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { DISCIPLINE_LABELS, postInclude, serializePostsForViewer } from "@/lib/inspiration";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sessionResult = await checkSession(request);
  const viewer = sessionResult.status === "authenticated" ? sessionResult.user : null;
  const user = await db.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      avatarKey: true,
      bio: true,
      designerTitle: true,
      designerLocation: true,
      designerWebsite: true,
      designDisciplines: true,
      createdAt: true,
    },
  });
  if (!user) return fail("NOT_FOUND", "设计师不存在", { status: 404 });
  const [posts, followers, following, followed] = await Promise.all([
    db.designPost.findMany({
      where: { authorId: id, status: "PUBLISHED", deletedAt: null },
      include: postInclude,
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      take: 60,
    }),
    db.userFollow.count({ where: { targetType: "USER", targetKey: id } }),
    db.userFollow.count({ where: { followerId: id } }),
    viewer
      ? db.userFollow.findUnique({ where: { followerId_targetType_targetKey: { followerId: viewer.id, targetType: "USER", targetKey: id } } })
      : null,
  ]);
  return ok({
    user: {
      id: user.id,
      name: user.name?.trim() || user.email.split("@")[0],
      avatarUrl: user.avatarKey ? `/api/inspiration/users/${user.id}/avatar` : null,
      bio: user.bio,
      designerTitle: user.designerTitle,
      designerLocation: user.designerLocation,
      designerWebsite: user.designerWebsite,
      designDisciplines: user.designDisciplines.map((value) => ({ value, label: DISCIPLINE_LABELS[value] })),
      joinedAt: user.createdAt.toISOString(),
      followerCount: followers,
      followingCount: following,
      isFollowing: Boolean(followed),
      isSelf: viewer?.id === user.id,
    },
    posts: await serializePostsForViewer(posts, viewer),
  });
}
