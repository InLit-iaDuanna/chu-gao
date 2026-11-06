import { headers } from "next/headers";
import Link from "next/link";

import { ActionableStatus } from "@/components/shared/ActionableStatus";
import { RedeemCodeForm } from "@/components/shared/RedeemCodeForm";
import { WorkbenchPreferencesForm } from "@/components/workbench/WorkbenchPreferencesForm";
import { checkSessionFromHeaders } from "@/lib/auth";
import { db } from "@/lib/db";
import { listConfiguredModels } from "@/lib/models/runtime-config";
import { isDatabaseUnavailableError } from "@/lib/service-errors";

async function getUserProfile() {
  const sessionResult = await checkSessionFromHeaders(await headers());

  if (sessionResult.status !== "authenticated") {
    return null;
  }

  const session = sessionResult.user;

  if (!process.env.DATABASE_URL) {
    return null;
  }

  try {
    const user = await db.user.findUnique({
      where: { id: session.id },
      select: {
        id: true,
        email: true,
        name: true,
        credits: true,
        dailyGenLimit: true,
      },
    });

    if (!user) {
      return null;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dailyUsed = await db.generation.count({
      where: {
        userId: user.id,
        createdAt: { gte: today },
        status: { not: "CANCELED" },
      },
    });

    return {
      ...user,
      dailyUsed,
      dailyLimit: user.dailyGenLimit,
    };
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      return null;
    }

    throw error;
  }
}

function usageLabel(used: number, limit: number | null) {
  return limit ? `${used} / ${limit}` : `${used} / 不限`;
}

export default async function SettingsPage() {
  const [user, models] = await Promise.all([
    getUserProfile(),
    listConfiguredModels(),
  ]);

  if (!user) {
    return (
      <ActionableStatus
        tone="warning"
        eyebrow="账户"
        title="账户资料暂时无法读取"
        description="请稍后刷新页面，或返回创作页继续查看当前工作台状态。"
        action={
          <Link href="/app" className="tool-button h-10 text-text-muted">
            返回创作
          </Link>
        }
      />
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="surface-panel p-6">
        <p className="eyebrow">账户</p>
        <h1 className="mt-2 text-2xl">个人资料</h1>
        <div className="mt-6 space-y-4">
          <div>
            <p className="text-sm text-text-muted">邮箱</p>
            <p className="mt-1">{user.email}</p>
          </div>
          <div>
            <p className="text-sm text-text-muted">余额</p>
            <p className="mt-1">{user.credits} 点</p>
          </div>
          <div>
            <p className="text-sm text-text-muted">今日用量</p>
            <p className="mt-1">
              {usageLabel(user.dailyUsed, user.dailyLimit)}
            </p>
          </div>
        </div>
        <RedeemCodeForm />
      </section>
      <WorkbenchPreferencesForm
        models={models.map((model) => ({ ...model, available: true }))}
      />
    </div>
  );
}
