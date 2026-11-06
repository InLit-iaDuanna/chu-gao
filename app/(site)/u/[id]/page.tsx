import type { Metadata } from "next";

import { DesignerProfile } from "@/components/inspiration/DesignerProfile";
import { db } from "@/lib/db";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!process.env.DATABASE_URL) return { title: "设计师 · 灵感圈" };
  const user = await db.user.findUnique({ where: { id }, select: { name: true, email: true } }).catch(() => null);
  const name = user?.name?.trim() || user?.email?.split("@")[0];
  return { title: name ? `${name} · 灵感圈` : "设计师 · 灵感圈", description: name ? `查看 ${name} 在 Chūgǎo 灵感圈发布的设计洞察。` : undefined };
}

export default async function DesignerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DesignerProfile userId={id} />;
}
