import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AdminShell } from "@/components/admin-console/AdminShell";
import { checkSessionFromHeaders } from "@/lib/auth";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const headerList = await headers();
  const sessionResult = await checkSessionFromHeaders(headerList);
  const currentPath = headerList.get("x-current-path") ?? "/admin";

  if (sessionResult.status === "unauthenticated") {
    redirect(`/login?next=${encodeURIComponent(currentPath)}`);
  }

  if (sessionResult.status === "unavailable") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <div className="surface-panel max-w-sm p-6">
          <p className="eyebrow">管理端</p>
          <h1 className="mt-2 text-xl font-semibold">认证服务暂不可用</h1>
          <p className="mt-4 text-sm leading-6 text-text-muted">
            请稍后刷新，或确认数据库服务已启动。
          </p>
        </div>
      </div>
    );
  }

  if (
    sessionResult.user.role !== "ADMIN" ||
    sessionResult.user.status !== "ACTIVE"
  ) {
    redirect("/app");
  }

  return <AdminShell>{children}</AdminShell>;
}
