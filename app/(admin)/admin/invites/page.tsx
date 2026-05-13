import { headers } from "next/headers";

import { InviteCodeCreateForm } from "@/components/admin/AdminForms";
import { DataTable } from "@/components/admin/DataTable";
import { requireAdminSessionFromHeaders } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

async function getRows() {
  const admin = await requireAdminSessionFromHeaders(await headers());

  if (!admin || !process.env.DATABASE_URL) {
    return null;
  }

  try {
    const invites = await db.inviteCode.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    return invites.map((invite) => [
      invite.code,
      invite.usedCount,
      invite.maxUses,
      invite.initialCredits,
      invite.expiresAt?.toLocaleString("zh-CN") ?? "长期",
      invite.revokedAt
        ? "已撤销"
        : invite.expiresAt && invite.expiresAt <= new Date()
          ? "已过期"
          : "可用",
      invite.note ?? "-",
    ]);
  } catch {
    return null;
  }
}

export default async function AdminInvitesPage() {
  const rows = await getRows();

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">邀请码</p>
        <h1 className="mt-2 text-3xl font-semibold">批量邀请码</h1>
      </div>
      <InviteCodeCreateForm />
      {rows ? (
        <DataTable
          headers={[
            "邀请码",
            "已用",
            "总次数",
            "初始点数",
            "过期时间",
            "状态",
            "备注",
          ]}
          rows={rows}
        />
      ) : (
        <div className="surface-panel p-6 text-sm leading-6 text-text-muted">
          邀请码服务暂不可用，请确认数据库连接后刷新。
        </div>
      )}
    </div>
  );
}
