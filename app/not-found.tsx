import Link from "next/link";

import { Logo } from "@/components/shared/Logo";
import { Button } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="flex min-h-svh flex-col bg-background text-sm tracking-normal text-foreground">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-12 w-full max-w-7xl items-center px-4 sm:px-6">
          <Link href="/" aria-label="初稿首页">
            <Logo />
          </Link>
        </div>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-md text-center">
          <p className="text-sm tabular-nums text-text-muted">404</p>
          <div className="app-page-header mt-2">
            <div className="w-full min-w-0">
              <h1 className="app-page-title">页面不存在</h1>
              <p className="app-page-description">
                你要找的页面可能已被移动或删除。
              </p>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Button asChild variant="primary">
              <Link href="/app">回到工作台</Link>
            </Button>
            <Button asChild>
              <Link href="/">返回首页</Link>
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
