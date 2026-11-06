import type { MetadataRoute } from "next";

import { db } from "@/lib/db";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = (process.env.NEXT_PUBLIC_APP_URL ?? "https://chugao.art").replace(/\/$/, "");
  const base: MetadataRoute.Sitemap = [
    { url: origin, changeFrequency: "weekly", priority: 1 },
    { url: `${origin}/inspiration`, changeFrequency: "daily", priority: 0.9 },
    { url: `${origin}/inspiration/daily`, changeFrequency: "daily", priority: 0.8 },
  ];
  if (!process.env.DATABASE_URL) return base;
  try {
    const posts = await db.designPost.findMany({
      where: { status: "PUBLISHED", deletedAt: null },
      select: { id: true, updatedAt: true, authorId: true },
      orderBy: { publishedAt: "desc" },
      take: 5_000,
    });
    const users = Array.from(new Set(posts.map((post) => post.authorId).filter((id): id is string => Boolean(id))));
    return [
      ...base,
      ...posts.map((post) => ({ url: `${origin}/inspiration/${post.id}`, lastModified: post.updatedAt, changeFrequency: "weekly" as const, priority: 0.7 })),
      ...users.map((id) => ({ url: `${origin}/u/${id}`, changeFrequency: "weekly" as const, priority: 0.5 })),
    ];
  } catch {
    return base;
  }
}
