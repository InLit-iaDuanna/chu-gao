import type { ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { WorkspaceShell } from "@/components/studio/WorkspaceShell";
import { checkSessionFromHeaders } from "@/lib/auth";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const headerList = await headers();
  const sessionResult = await checkSessionFromHeaders(headerList);
  const currentPath = headerList.get("x-current-path") ?? "/app";

  if (sessionResult.status === "unauthenticated") {
    redirect(`/login?next=${encodeURIComponent(currentPath)}`);
  }

  if (sessionResult.status === "unavailable") {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background px-6 text-foreground">
        <div className="surface-panel max-w-sm p-6">
          <p className="eyebrow">Chūgǎo Studio</p>
          <h1 className="mt-2 text-xl font-semibold">认证服务暂不可用</h1>
          <p className="mt-4 text-sm leading-6 text-text-muted">
            请稍后刷新，或联系管理员确认数据库服务已启动。
          </p>
        </div>
      </div>
    );
  }

  return <WorkspaceShell researchEnabled={sessionResult.user.role === "ADMIN"}>{children}</WorkspaceShell>;
}
