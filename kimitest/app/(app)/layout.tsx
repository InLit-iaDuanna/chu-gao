import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Frame, Grid3X3, ImagePlus, Settings } from "lucide-react";
import { ActionableStatus } from "@/components/shared/ActionableStatus";
import { AccountMenu } from "@/components/shared/AccountMenu";
import { Logo } from "@/components/shared/Logo";
import { MotionProvider } from "@/components/shared/MotionProvider";
import { ThemeToggle } from "@/components/shared/ThemeToggle";
import { checkSessionFromHeaders } from "@/lib/auth";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/app", label: "创作", icon: ImagePlus },
  { href: "/app/canvas", label: "无限画布", icon: Frame },
  { href: "/app/history", label: "历史", icon: Grid3X3 },
];

const BOTTOM_NAV_ITEMS = [
  { href: "/app/settings", label: "设置", icon: Settings },
];

function isActivePath(current: string, href: string) {
  if (href === "/app") return current === "/app" || current === "/app/";
  return current.startsWith(href);
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
    const encodedNext = encodeURIComponent(currentPath);
    redirect(`/login?next=${encodedNext}`);
  }

  if (sessionResult.status === "unavailable") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <ActionableStatus
          tone="danger"
          title="服务暂时不可用"
          description="无法连接到认证服务，请稍后再试。"
        />
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar — 发丝线纸面导航 */}
      <nav className="flex w-[60px] shrink-0 flex-col items-center gap-1 border-r border-border bg-surface py-3">
        <div className="mb-3 flex items-center justify-center">
          <Link href="/app" className="flex items-center justify-center">
            <div className="relative flex h-8 w-8 items-center justify-center">
              <div className="absolute h-5 w-5 rounded-[3px] bg-ink" />
              <div className="absolute h-2 w-2 rounded-[1px] bg-brand" />
            </div>
          </Link>
        </div>

        <div className="flex flex-1 flex-col items-center gap-1">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              title={label}
              className={cn(
                "group flex h-10 w-10 items-center justify-center rounded-[var(--radius-sm)] transition-colors duration-150",
                isActivePath(currentPath, href)
                  ? "bg-ink text-background"
                  : "text-text-faint hover:bg-ink/[0.05] hover:text-foreground",
              )}
            >
              <Icon size={18} strokeWidth={1.5} />
            </Link>
          ))}
        </div>

        <div className="flex flex-col items-center gap-1">
          {BOTTOM_NAV_ITEMS.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              title={label}
              className={cn(
                "group flex h-10 w-10 items-center justify-center rounded-[var(--radius-sm)] transition-colors duration-150",
                isActivePath(currentPath, href)
                  ? "bg-ink text-background"
                  : "text-text-faint hover:bg-ink/[0.05] hover:text-foreground",
              )}
            >
              <Icon size={18} strokeWidth={1.5} />
            </Link>
          ))}
        </div>
      </nav>

      {/* Main area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header — 发丝线纸面顶栏 */}
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-surface px-4">
          <Logo />
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <AccountMenu />
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-auto">
          <MotionProvider>{children}</MotionProvider>
        </main>
      </div>
    </div>
  );
}
