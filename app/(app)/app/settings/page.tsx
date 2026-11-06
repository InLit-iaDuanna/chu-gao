import { headers } from "next/headers";
import Link from "next/link";

import { SettingsView } from "@/components/studio/SettingsView";
import { StudioPageShell } from "@/components/studio/StudioPageShell";
import { checkSessionFromHeaders } from "@/lib/auth";
import { db } from "@/lib/db";
import { listConfiguredModels } from "@/lib/models/runtime-config";
import { isDatabaseUnavailableError } from "@/lib/service-errors";

async function getUserProfile() {
  const sessionResult = await checkSessionFromHeaders(await headers());

  if (sessionResult.status !== "authenticated") {
    return null;
  }

  if (!process.env.DATABASE_URL) {
    return null;
  }

  try {
    const user = await db.user.findUnique({
      where: { id: sessionResult.user.id },
      select: {
        id: true,
        email: true,
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
      email: user.email,
      credits: user.credits,
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

export default async function SettingsPage() {
  const [user, models] = await Promise.all([
    getUserProfile(),
    listConfiguredModels(),
  ]);

  return (
    <StudioPageShell eyebrow="Settings" title="设置">
      {!user ? (
        <div className="surface-panel flex min-h-72 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
          <h2 className="text-xl font-medium">账户资料暂时无法读取</h2>
          <p className="max-w-md text-sm leading-6 text-text-muted">
            请稍后刷新页面，或返回工作台继续查看当前状态。
          </p>
          <Link href="/app" className="tool-button mt-2 h-9 text-text-muted">
            返回工作台
          </Link>
        </div>
      ) : (
        <SettingsView user={user} models={models} />
      )}
    </StudioPageShell>
  );
}
