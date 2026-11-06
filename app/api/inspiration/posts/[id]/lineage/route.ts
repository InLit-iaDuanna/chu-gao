import { fail, ok } from "@/lib/api-response";
import { db } from "@/lib/db";

const lineageSelect = {
  id: true,
  title: true,
  authorNameSnapshot: true,
  shape: true,
  discipline: true,
  derivedFromPostId: true,
} as const;

interface LineageNodeRow {
  id: string;
  title: string;
  authorNameSnapshot: string;
  shape: string;
  discipline: string;
  derivedFromPostId: string | null;
}

function serializeNode(row: LineageNodeRow) {
  return {
    id: row.id,
    title: row.title,
    authorName: row.authorNameSnapshot,
    shape: row.shape,
    discipline: row.discipline,
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const current = await db.designPost.findFirst({
    where: { id, status: "PUBLISHED", deletedAt: null },
    select: lineageSelect,
  });
  if (!current)
    return fail("NOT_FOUND", "帖子不存在", { status: 404 });

  // First find the oldest visible ancestor so opening any node in a branch
  // yields the same complete tree instead of treating that node as a root.
  let treeRoot = current;
  const ancestorIds = new Set([current.id]);
  for (let depth = 0; depth < 8 && treeRoot.derivedFromPostId; depth += 1) {
    const parent = await db.designPost.findFirst({
      where: {
        id: treeRoot.derivedFromPostId,
        status: "PUBLISHED",
        deletedAt: null,
      },
      select: lineageSelect,
    });
    if (!parent || ancestorIds.has(parent.id)) break;
    ancestorIds.add(parent.id);
    treeRoot = parent;
  }

  const nodes = new Map<string, ReturnType<typeof serializeNode>>([
    [treeRoot.id, serializeNode(treeRoot)],
  ]);
  const edgeKeys = new Set<string>();
  const edges: Array<{ from: string; to: string }> = [];
  const expanded = new Set<string>();
  let frontier = [treeRoot.id];

  for (let depth = 0; depth < 8 && frontier.length; depth += 1) {
    const parentIds = [...new Set(frontier)].filter(
      (nodeId) => !expanded.has(nodeId),
    );
    if (!parentIds.length) break;
    parentIds.forEach((nodeId) => expanded.add(nodeId));

    const children = await db.designPost.findMany({
      where: {
        derivedFromPostId: { in: parentIds },
        status: "PUBLISHED",
        deletedAt: null,
      },
      select: lineageSelect,
      orderBy: [{ publishedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      take: 200,
    });

    const next: string[] = [];
    for (const child of children) {
      nodes.set(child.id, serializeNode(child));
      if (child.derivedFromPostId) {
        const edgeKey = `${child.derivedFromPostId}:${child.id}`;
        if (!edgeKeys.has(edgeKey)) {
          edgeKeys.add(edgeKey);
          edges.push({ from: child.derivedFromPostId, to: child.id });
        }
      }
      if (!expanded.has(child.id)) next.push(child.id);
    }
    frontier = next;
  }

  return ok({ rootId: treeRoot.id, nodes: [...nodes.values()], edges });
}
