import { headers } from "next/headers";
import Link from "next/link";
import { CircleAlert } from "lucide-react";
import { Button, EmptyState } from "@/components/ui";

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
    <StudioPageShell title="设置">
      {!user ? (
        <EmptyState
          role="status"
          icon={CircleAlert}
          className="min-h-72 border-t border-border"
          title="账户资料暂时无法读取"
          description="请稍后刷新页面，或返回工作台继续查看当前状态。"
          action={
            <Button asChild>
              <Link href="/app">返回工作台</Link>
            </Button>
          }
        />
      ) : (
        <SettingsView user={user} models={models} />
      )}
    </StudioPageShell>
  );
}
