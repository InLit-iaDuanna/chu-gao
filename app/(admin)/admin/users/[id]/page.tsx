import Link from "next/link";

import {
  AdminCreditForm,
  AdminDangerActions,
  AdminPasswordResetForm,
  AdminUserProfileForm,
} from "@/components/admin/AdminForms";
import { DataTable } from "@/components/admin/DataTable";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

async function getUser(id: string) {
  if (!process.env.DATABASE_URL) {
    return null;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [user, dailyUsed, usageLogs, auditLogs] = await Promise.all([
    db.user.findUnique({
      where: { id },
      include: {
        generations: {
          where: { deletedAt: null },
          orderBy: { createdAt: "desc" },
          take: 20,
          include: {
            provider: { select: { name: true } },
            providerAccount: { select: { name: true, baseUrl: true } },
          },
        },
      },
    }),
    db.generation.count({
      where: { userId: id, createdAt: { gte: today }, status: { not: "CANCELED" } },
    }),
    db.usageLog.findMany({
      where: { userId: id },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    db.auditLog.findMany({
      where: { target: id },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { actor: { select: { email: true } } },
    }),
  ]);

  if (!user) {
    return null;
  }

  return { user, dailyUsed, usageLogs, auditLogs };
}

function duration(start: Date | null, end: Date | null) {
  if (!start) {
    return "-";
  }

  return `${Math.round(((end ?? new Date()).getTime() - start.getTime()) / 1000)}s`;
}

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getUser(id);

  if (!data) {
    return (
      <div className="surface-panel p-6 text-sm text-text-muted">
        用户不存在或数据库暂不可用。
      </div>
    );
  }

  const { user, dailyUsed, usageLogs, auditLogs } = data;

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">用户</p>
        <h1 className="mt-2 text-3xl font-semibold">{user.email}</h1>
      </div>
      <section className="grid gap-4 md:grid-cols-4">
        <div className="surface-panel p-4">
          <p className="text-sm text-text-muted">余额</p>
          <p className="mt-2 text-2xl font-semibold">{user.credits} 点</p>
        </div>
        <div className="surface-panel p-4">
          <p className="text-sm text-text-muted">今日用量</p>
          <p className="mt-2 text-2xl font-semibold">
            {dailyUsed}/{user.dailyGenLimit}
          </p>
        </div>
        <div className="surface-panel p-4">
          <p className="text-sm text-text-muted">并发限制</p>
          <p className="mt-2 text-2xl font-semibold">{user.concurrentLimit}</p>
        </div>
        <div className="surface-panel p-4">
          <p className="text-sm text-text-muted">状态</p>
          <p className="mt-2 text-2xl font-semibold">{user.status}</p>
        </div>
      </section>
      <AdminUserProfileForm
        user={{
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          status: user.status,
          dailyGenLimit: user.dailyGenLimit,
          concurrentLimit: user.concurrentLimit,
          bannedReason: user.bannedReason,
        }}
      />
      <AdminCreditForm userId={user.id} />
      <section className="grid gap-4 lg:grid-cols-2">
        <AdminPasswordResetForm userId={user.id} />
        <AdminDangerActions userId={user.id} />
      </section>
      <DataTable
        headers={["任务", "模型", "状态", "渠道", "账号", "耗时", "点数", "错误"]}
        rows={user.generations.map((generation) => [
          <Link
            key={generation.id}
            href={`/admin/generations?q=${generation.id}`}
            className="underline"
          >
            {generation.id.slice(0, 8)}
          </Link>,
          generation.modelId,
          generation.status,
          generation.provider?.name ?? "-",
          generation.providerAccount?.name ?? generation.providerAccount?.baseUrl ?? "-",
          duration(generation.startedAt, generation.finishedAt),
          generation.costCredits,
          generation.errorMessage ?? "-",
        ])}
      />
      <DataTable
        headers={["时间", "动作", "点数变化", "任务"]}
        rows={usageLogs.map((log) => [
          log.createdAt.toLocaleString("zh-CN"),
          log.action,
          log.creditsDelta,
          log.generationId ?? "-",
        ])}
      />
      <DataTable
        headers={["时间", "管理员", "动作", "变更"]}
        rows={auditLogs.map((log) => [
          log.createdAt.toLocaleString("zh-CN"),
          log.actor.email,
          log.action,
          JSON.stringify(log.diff ?? {}),
        ])}
      />
    </div>
  );
}
