import type { Metadata } from "next";

import { PostDetail } from "@/components/inspiration/PostDetail";
import { db } from "@/lib/db";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!process.env.DATABASE_URL) return { title: "灵感详情 · Chūgǎo" };
  const post = await db.designPost.findFirst({ where: { id, status: "PUBLISHED", deletedAt: null }, select: { title: true, story: true, authorNameSnapshot: true } }).catch(() => null);
  if (!post) return { title: "灵感详情 · Chūgǎo" };
  return {
    title: `${post.title} · 灵感圈`,
    description: post.story?.slice(0, 160) || `${post.authorNameSnapshot} 在 Chūgǎo 灵感圈发布的设计讨论。`,
    openGraph: { title: post.title, description: post.story?.slice(0, 160) || "跨学科设计灵感交流" },
  };
}

export default async function InspirationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PostDetail postId={id} />;
}
