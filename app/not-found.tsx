import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <div className="surface-panel max-w-sm p-8 text-center">
        <p className="eyebrow">404</p>
        <h1 className="mt-2 text-xl font-semibold">页面不存在</h1>
        <p className="mt-3 text-sm leading-6 text-text-muted">
          你要找的页面可能已被移动或删除。
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <Link
            href="/app"
            className="inline-flex h-9 items-center rounded-lg bg-[rgb(var(--brand-primary))] px-4 text-sm text-on-accent transition-colors hover:bg-[rgb(var(--brand-primary))]/88"
          >
            回到工作台
          </Link>
          <Link
            href="/"
            className="inline-flex h-9 items-center rounded-lg border border-border bg-surface px-4 text-sm text-foreground transition-colors hover:border-border-strong hover:bg-surface-2"
          >
            返回首页
          </Link>
        </div>
      </div>
    </main>
  );
}
