import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AccountMenu } from "@/components/shared/AccountMenu";
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
      <div
        data-surface="admin"
        className="min-h-screen bg-background text-foreground"
      >
        <main className="page-shell py-6">
          <div className="surface-panel p-6">
            <p className="eyebrow">Admin</p>
            <h1 className="mt-2 text-2xl font-semibold">认证服务暂不可用</h1>
            <p className="mt-4 text-sm leading-6 text-text-muted">
              请稍后刷新，或确认数据库服务已启动。
            </p>
          </div>
        </main>
      </div>
    );
  }

  if (
    sessionResult.user.role !== "ADMIN" ||
    sessionResult.user.status !== "ACTIVE"
  ) {
    redirect("/app");
  }

  return (
    <div
      data-surface="admin"
      className="min-h-screen bg-background text-foreground"
    >
      <div className="page-shell grid gap-6 py-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="surface-panel h-fit p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="eyebrow">Admin</p>
            <AccountMenu />
          </div>
          <nav className="mt-4 space-y-2 text-sm text-text-muted">
            <Link
              className="block rounded-[6px] px-3 py-2 text-foreground hover:bg-surface-2"
              href="/app"
            >
              回到创作
            </Link>
            <Link
              className="block rounded-[6px] px-3 py-2 hover:bg-surface-2"
              href="/admin"
            >
              仪表盘
            </Link>
            <Link
              className="block rounded-[6px] px-3 py-2 hover:bg-surface-2"
              href="/admin/users"
            >
              用户
            </Link>
            <Link
              className="block rounded-[6px] px-3 py-2 hover:bg-surface-2"
              href="/admin/providers"
            >
              渠道
            </Link>
            <Link
              className="block rounded-[6px] px-3 py-2 hover:bg-surface-2"
              href="/admin/invites"
            >
              邀请码
            </Link>
            <Link
              className="block rounded-[6px] px-3 py-2 hover:bg-surface-2"
              href="/admin/redemption-codes"
            >
              兑换码
            </Link>
            <Link
              className="block rounded-[6px] px-3 py-2 hover:bg-surface-2"
              href="/admin/pricing"
            >
              定价
            </Link>
            <Link
              className="block rounded-[6px] px-3 py-2 hover:bg-surface-2"
              href="/admin/generations"
            >
              生成
            </Link>
            <Link
              className="block rounded-[6px] px-3 py-2 hover:bg-surface-2"
              href="/admin/system"
            >
              系统
            </Link>
            <Link
              className="block rounded-[6px] px-3 py-2 hover:bg-surface-2"
              href="/admin/audit"
            >
              审计
            </Link>
          </nav>
        </aside>
        <main>{children}</main>
      </div>
    </div>
  );
}
