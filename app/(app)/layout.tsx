import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Grid3X3, ImagePlus, Settings } from "lucide-react";

import { ActionableStatus } from "@/components/shared/ActionableStatus";
import { AccountMenu } from "@/components/shared/AccountMenu";
import { Logo } from "@/components/shared/Logo";
import { ThemeToggle } from "@/components/shared/ThemeToggle";
import { checkSessionFromHeaders } from "@/lib/auth";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/app", label: "创作", icon: ImagePlus },
  { href: "/app/history", label: "历史", icon: Grid3X3 },
];

const BOTTOM_NAV_ITEMS = [
  { href: "/app/settings", label: "设置", icon: Settings },
];

function isActivePath(currentPath: string, href: string) {
  if (href === "/app") {
    return currentPath === "/app" || currentPath.startsWith("/app/g/");
  }

  return currentPath === href;
}

export default async function UserAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const headerList = await headers();
  const sessionResult = await checkSessionFromHeaders(headerList);
  const currentPath = headerList.get("x-current-path") ?? "/app";

  if (sessionResult.status === "unauthenticated") {
    redirect(`/login?next=${encodeURIComponent(currentPath)}`);
  }

  if (sessionResult.status === "unavailable") {
    return (
      <div className="min-h-screen bg-background">
        <main className="page-shell py-6">
          <ActionableStatus
            tone="warning"
            eyebrow="认证"
            title="暂时无法确认登录状态"
            description="请稍后刷新页面。服务恢复后会自动回到你要访问的位置。"
            action={
              <Link href="/login" className="tool-button h-10 text-text-muted">
                返回登录
              </Link>
            }
          />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed left-0 top-0 z-20 hidden h-screen w-14 flex-col items-center border-r border-border bg-background/96 px-0 py-3 lg:flex">
        <Link
          href="/app"
          className="mb-6 flex h-8 w-8 items-center justify-center rounded-[4px] border border-border"
          aria-label="Chūgǎo Studio"
        >
          <div className="h-2.5 w-2.5 rounded-[2px] bg-foreground" />
        </Link>
        <nav className="flex flex-1 flex-col gap-1">
          {NAV_ITEMS.map((item) => {
            const active = isActivePath(currentPath, item.href);
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-[6px] text-text-faint transition-colors hover:bg-surface hover:text-foreground",
                  active && "bg-surface-2 text-foreground",
                )}
                aria-label={item.label}
                title={item.label}
                aria-current={active ? "page" : undefined}
              >
                <Icon className="h-5 w-5 stroke-[1.5]" />
              </Link>
            );
          })}
        </nav>
        <div className="flex flex-col gap-1">
          {BOTTOM_NAV_ITEMS.map((item) => {
            const active = isActivePath(currentPath, item.href);
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-[6px] text-text-faint transition-colors hover:bg-surface hover:text-foreground",
                  active && "bg-surface-2 text-foreground",
                )}
                aria-label={item.label}
                title={item.label}
                aria-current={active ? "page" : undefined}
              >
                <Icon className="h-5 w-5 stroke-[1.5]" />
              </Link>
            );
          })}
        </div>
      </aside>

      <div className="lg:pl-14">
        <header className="sticky top-0 z-10 border-b border-border bg-background/88 backdrop-blur">
          <div className="page-shell flex flex-wrap items-center justify-between gap-3 py-2.5">
            <div className="flex min-w-0 items-center gap-8">
              <Logo />
            </div>
            <div className="flex items-center gap-2">
              <AccountMenu />
              <ThemeToggle />
            </div>
            <nav className="flex w-full items-center gap-2 text-sm text-text-muted lg:hidden">
              {[...NAV_ITEMS, ...BOTTOM_NAV_ITEMS].map((item) => {
                const active = isActivePath(currentPath, item.href);

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "selection-pill px-3 py-2.5 font-medium tracking-[0.01em]",
                      active
                        ? "selection-pill-active"
                        : "hover:text-foreground",
                    )}
                    aria-current={active ? "page" : undefined}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        </header>
        <main className="page-shell py-4">{children}</main>
      </div>
    </div>
  );
}
