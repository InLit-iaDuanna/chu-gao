import Link from "next/link";
import { Suspense } from "react";
import { Compass, Plus, Sparkles, UserRound } from "lucide-react";

import { InspirationDashboard } from "@/components/inspiration/InspirationDashboard";
import { InspirationFeed } from "@/components/inspiration/InspirationFeed";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";

type InspirationWorkspacePageProps = {
  searchParams: Promise<{
    view?: string | string[];
    section?: string | string[];
  }>;
};

export default async function InspirationWorkspacePage({
  searchParams,
}: InspirationWorkspacePageProps) {
  const params = await searchParams;
  const view = params.view === "mine" ? "mine" : "discover";
  const dashboardTab =
    params.section === "bookmarks" ||
    params.section === "notifications" ||
    params.section === "analytics" ||
    params.section === "profile"
      ? params.section
      : "posts";
  const tabClass = (active: boolean) =>
    cn(
      "inline-flex h-9 items-center gap-2 border-b-2 px-1 text-sm font-medium transition-colors",
      active
        ? "border-brand text-foreground"
        : "border-transparent text-text-muted hover:text-foreground",
    );

  return (
    <div className="h-full min-w-0 overflow-y-auto text-sm tracking-normal">
      <header className="sticky top-0 z-20 border-b border-border bg-background">
        <div className="mx-auto max-w-7xl px-4 pt-4 sm:px-6 sm:pt-5">
          <div className="app-page-header flex flex-wrap items-center justify-between gap-3 border-0 pb-0">
            <div>
              <h1 className="app-page-title text-xl font-semibold tracking-normal sm:text-2xl">
                灵感圈
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild>
                <Link href="/app/inspiration/daily">
                  <Sparkles size={16} /> 每日命题
                </Link>
              </Button>
              <Button asChild variant="primary">
                <Link href="/app/publish">
                  <Plus size={16} /> 发布
                </Link>
              </Button>
            </div>
          </div>
          <nav aria-label="灵感圈视图" className="mt-3 flex gap-5">
            <Link
              href="/app/inspiration"
              aria-current={view === "discover" ? "page" : undefined}
              className={tabClass(view === "discover")}
            >
              <Compass size={14} /> 发现
            </Link>
            <Link
              href="/app/inspiration?view=mine"
              aria-current={view === "mine" ? "page" : undefined}
              className={tabClass(view === "mine")}
            >
              <UserRound size={14} /> 我的
            </Link>
          </nav>
        </div>
      </header>

      {view === "discover" ? (
        <Suspense
          fallback={
            <div className="mx-auto max-w-7xl px-4 py-10 text-sm text-text-muted sm:px-6">
              正在读取灵感…
            </div>
          }
        >
          <InspirationFeed basePath="/app/inspiration" embedded />
        </Suspense>
      ) : (
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
          <InspirationDashboard initialTab={dashboardTab} />
        </div>
      )}
    </div>
  );
}
