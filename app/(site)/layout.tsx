import Link from "next/link";
import { headers } from "next/headers";

import { Compass, Sparkles } from "lucide-react";
import { IconRail } from "@/components/studio/IconRail";
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
      className={`min-h-screen bg-background text-foreground ${isAuthenticated ? "pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0" : ""}`}
    >
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/inspiration" className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand text-on-accent">
              <Compass size={15} />
            </span>
            <span className="text-sm font-semibold">
              Chūgǎo{" "}
              <span className="font-normal text-text-muted">/ 灵感圈</span>
            </span>
          </Link>
          <nav className="hidden items-center gap-1 sm:flex">
            <Link
              href="/inspiration"
              className="rounded-md px-3 py-2 text-xs text-text-muted hover:bg-surface-2 hover:text-foreground"
            >
              广场
            </Link>
            <Link
              href="/inspiration/daily"
              className="rounded-md px-3 py-2 text-xs text-text-muted hover:bg-surface-2 hover:text-foreground"
            >
              每日命题
            </Link>
          </nav>
          <div className="flex items-center gap-2">
            {isAuthenticated ? (
              <Link
                href="/app/inspiration?view=mine"
                className="hidden rounded-md px-3 py-2 text-xs text-text-muted hover:text-foreground sm:inline-flex"
              >
                我的灵感
              </Link>
            ) : (
              <Link
                href="/login?next=/app/publish"
                className="hidden rounded-md px-3 py-2 text-xs text-text-muted hover:text-foreground sm:inline-flex"
              >
                登录
              </Link>
            )}
            <Link
              href={isAuthenticated ? "/app/publish" : "/app"}
              className="tool-button h-9 px-3 text-xs text-text-muted"
            >
              <Sparkles size={14} /> {isAuthenticated ? "发布灵感" : "开始创作"}
            </Link>
          </div>
        </div>
      </header>
      {children}
      <footer className="border-t border-border py-8 text-center text-xs text-text-faint">
        Chūgǎo 灵感圈 · 让设计问题继续生长
      </footer>
      {isAuthenticated ? (
        <div className="fixed inset-x-0 bottom-0 z-40 md:hidden">
          <IconRail mobile />
        </div>
      ) : null}
    </div>
  );
}
