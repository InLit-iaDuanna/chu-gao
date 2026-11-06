import { fail, ok } from "@/lib/api-response";
import { db } from "@/lib/db";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const root = await db.designPost.findFirst({ where: { id, status: "PUBLISHED", deletedAt: null }, select: { id: true, title: true, derivedFromPostId: true } });
  if (!root) return fail("NOT_FOUND", "帖子不存在", { status: 404 });
  const nodes = new Map<string, { id: string; title: string; authorName: string; shape: string; discipline: string }>();
  const edges: Array<{ from: string; to: string }> = [];
  let frontier = [root.id];
  for (let depth = 0; depth < 4 && frontier.length; depth += 1) {
    const rows = await db.designPost.findMany({
      where: { OR: [{ id: { in: frontier } }, { derivedFromPostId: { in: frontier } }], status: "PUBLISHED", deletedAt: null },
      select: { id: true, title: true, authorNameSnapshot: true, shape: true, discipline: true, derivedFromPostId: true },
      take: 200,
    });
    const next: string[] = [];
    for (const row of rows) {
      nodes.set(row.id, { id: row.id, title: row.title, authorName: row.authorNameSnapshot, shape: row.shape, discipline: row.discipline });
      if (row.derivedFromPostId) edges.push({ from: row.derivedFromPostId, to: row.id });
      if (!frontier.includes(row.id)) next.push(row.id);
    }
    frontier = next;
  }
  return ok({ rootId: root.id, nodes: Array.from(nodes.values()), edges });
}
