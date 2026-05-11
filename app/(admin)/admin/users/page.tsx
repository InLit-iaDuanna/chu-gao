import { headers } from "next/headers";
import Link from "next/link";

import { DataTable } from "@/components/admin/DataTable";
import { requireAdminSessionFromHeaders } from "@/lib/auth";
import { db } from "@/lib/db";

async function getRows() {
  const admin = await requireAdminSessionFromHeaders(await headers());

  if (!admin || !process.env.DATABASE_URL) {
    return null;
  }

  try {
    const users = await db.user.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        credits: true,
        dailyGenLimit: true,
        _count: {
          select: { generations: true },
        },
        generations: {
          where: { status: { in: ["PENDING", "RUNNING"] } },
          select: { id: true },
        },
        createdAt: true,
      },
      take: 100,
    });

    return users.map((user) => [
      user.email,
      user.name ?? "-",
      user.role,
      user.status,
      `${user.credits} 点`,
      `${user.generations.length} 活跃 / ${user._count.generations} 总`,
      `每日 ${user.dailyGenLimit}`,
      user.createdAt.toLocaleString("zh-CN"),
      <Link key={user.id} href={`/admin/users/${user.id}`} className="underline">
        查看
      </Link>,
    ]);
  } catch {
    return null;
  }
}

export default async function AdminUsersPage() {
  const rows = await getRows();

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">用户</p>
        <h1 className="mt-2 text-3xl font-semibold">用户管理</h1>
      </div>
      {rows ? (
        <DataTable
          headers={[
            "邮箱",
            "昵称",
            "角色",
            "状态",
            "余额",
            "任务",
            "限制",
            "注册时间",
            "操作",
          ]}
          rows={rows}
        />
      ) : (
        <div className="surface-panel p-6 text-sm leading-6 text-text-muted">
          用户服务暂不可用，请确认数据库连接后刷新。
        </div>
      )}
    </div>
  );
}
