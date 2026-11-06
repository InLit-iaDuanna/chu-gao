import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AccountMenu } from "@/components/shared/AccountMenu";
import { checkSessionFromHeaders } from "@/lib/auth";

const NAV_GROUPS: Array<{
  label: string;
  items: Array<{ href: string; label: string }>;
}> = [
  {
    label: "概览",
    items: [{ href: "/admin", label: "仪表盘" }],
  },
  {
    label: "用户与增长",
    items: [
      { href: "/admin/users", label: "用户" },
      { href: "/admin/invites", label: "邀请码" },
      { href: "/admin/redemption-codes", label: "兑换码" },
    ],
  },
  {
    label: "生成与渠道",
    items: [
      { href: "/admin/generations", label: "生成" },
      { href: "/admin/providers", label: "渠道" },
      { href: "/admin/pricing", label: "定价" },
      { href: "/admin/integrations", label: "AI 集成" },
    ],
  },
  {
    label: "系统",
    items: [
      { href: "/admin/system", label: "系统" },
      { href: "/admin/audit", label: "审计" },
    ],
  },
];

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
      <div className="min-h-screen bg-background text-foreground">
        <main className="page-shell py-6">
          <div className="surface-panel p-6">
            <p className="eyebrow">管理端</p>
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
    <div className="min-h-screen bg-background text-foreground">
      <div className="page-shell grid min-w-0 max-w-full gap-6 py-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="surface-panel h-fit min-w-0 max-w-full p-4">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <p className="eyebrow">管理端</p>
            <AccountMenu compact showAdminLink={false} />
          </div>
          <Link
            className="mt-4 block rounded-[var(--radius-sm)] px-3 py-2 text-sm text-foreground transition-colors hover:bg-ink/[0.05]"
            href="/app"
          >
            ← 回到创作
          </Link>
          <nav className="mt-3 min-w-0 space-y-5 text-sm text-text-muted">
            {NAV_GROUPS.map((group) => (
              <div key={group.label} className="space-y-1">
                <p className="px-3 font-mono text-[10px] uppercase tracking-[0.16em] text-text-faint">
                  {group.label}
                </p>
                {group.items.map((item) => {
                  const isActive =
                    item.href === "/admin"
                      ? currentPath === "/admin"
                      : currentPath.startsWith(item.href);

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={isActive ? "page" : undefined}
                      className={
                        "block rounded-[var(--radius-sm)] px-3 py-2 transition-colors duration-150 " +
                        (isActive
                          ? "bg-ink font-medium text-background"
                          : "hover:bg-ink/[0.05] hover:text-foreground")
                      }
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
        </aside>
        <main className="min-w-0 max-w-full">{children}</main>
      </div>
    </div>
  );
}
