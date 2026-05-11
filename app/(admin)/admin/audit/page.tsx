import { headers } from "next/headers";

import { DataTable } from "@/components/admin/DataTable";
import { requireAdminSessionFromHeaders } from "@/lib/auth";
import { db } from "@/lib/db";

async function getRows() {
  const admin = await requireAdminSessionFromHeaders(await headers());

  if (!admin || !process.env.DATABASE_URL) {
    return null;
  }

  try {
    const rows = await db.auditLog.findMany({
      include: {
        actor: {
          select: {
            email: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    return rows.map((row) => [
      row.createdAt.toLocaleString("zh-CN"),
      row.actor.email,
      row.action,
      row.target ?? "-",
      row.diff ? JSON.stringify(row.diff) : "-",
    ]);
  } catch {
    return null;
  }
}

export default async function AdminAuditPage() {
  const rows = await getRows();

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">审计</p>
        <h1 className="mt-2 text-3xl font-semibold">操作审计</h1>
      </div>
      {rows ? (
        <DataTable
          headers={["时间", "操作者", "动作", "目标", "差异"]}
          rows={rows}
        />
      ) : (
        <div className="surface-panel p-6 text-sm leading-6 text-text-muted">
          审计服务暂不可用，请确认数据库连接后刷新。
        </div>
      )}
    </div>
  );
}
