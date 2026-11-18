import Link from "next/link";
import { headers } from "next/headers";

import { ArrowRight, Plus } from "lucide-react";
import { Logo } from "@/components/shared/Logo";
import { IconRail } from "@/components/studio/IconRail";
import { Button } from "@/components/ui";
import { checkSessionFromHeaders } from "@/lib/auth";

export default async function SiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sessionResult = await checkSessionFromHeaders(await headers());
  const isAuthenticated = sessionResult.status === "authenticated";

  return (
    <div
      className={`min-h-svh bg-background text-sm tracking-normal text-foreground ${isAuthenticated ? "pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0" : ""}`}
    >
      <header className="sticky top-0 z-30 border-b border-border bg-surface">
        <div className="mx-auto flex min-h-12 max-w-7xl flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-1.5 sm:px-6">
          <Link
            href="/inspiration"
            aria-label="初稿灵感圈"
            className="flex min-w-0 shrink-0 items-center gap-3"
          >
            <Logo />
            <span className="border-l border-border pl-3 text-sm font-medium">
              灵感圈
            </span>
          </Link>
          <nav
            aria-label="灵感圈导航"
            className="order-last flex w-full flex-wrap items-center gap-1 border-t border-border pt-1 sm:order-none sm:w-auto sm:flex-1 sm:border-0 sm:pt-0"
          >
            <Link
              href="/inspiration"
              className="inline-flex h-9 items-center rounded-md px-3 text-sm text-text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              广场
            </Link>
            <Link
              href="/inspiration/daily"
              className="inline-flex h-9 items-center rounded-md px-3 text-sm text-text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              每日命题
            </Link>
            {isAuthenticated ? (
              <Link
                href="/app/inspiration?view=mine"
                className="inline-flex h-9 items-center rounded-md px-3 text-sm text-text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
              >
                我的灵感
              </Link>
            ) : null}
          </nav>
          <div className="flex shrink-0 items-center gap-1">
            {!isAuthenticated ? (
              <Link
                href="/login?next=/app/publish"
                className="inline-flex h-9 items-center rounded-md px-2 text-sm text-text-muted transition-colors hover:bg-surface-2 hover:text-foreground sm:px-3"
              >
                登录
              </Link>
            ) : null}
            <Button asChild variant="primary" className="px-3">
              <Link href={isAuthenticated ? "/app/publish" : "/app"}>
                {isAuthenticated ? (
                  <Plus size={16} aria-hidden />
                ) : (
                  <ArrowRight size={16} aria-hidden />
                )}
                {isAuthenticated ? "发布灵感" : "开始创作"}
              </Link>
            </Button>
          </div>
        </div>
      </header>
      {children}
      <footer className="border-t border-border px-4 py-6 text-center text-xs text-text-muted">
        © 2026 Chūgǎo Studio · 灵感圈
      </footer>
      {isAuthenticated ? (
        <div className="fixed inset-x-0 bottom-0 z-40 md:hidden">
          <IconRail mobile />
        </div>
      ) : null}
    </div>
  );
}
