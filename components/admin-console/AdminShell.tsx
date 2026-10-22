"use client";

import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
  IconButton,
} from "@/components/ui";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { ArrowLeft, LogOut, Menu, Moon, Sun, X } from "lucide-react";

import { cn } from "@/lib/utils";

import { logout } from "@/components/studio/lib/api";

const NAV_GROUPS: {
  label: string;
  items: { href: string; label: string }[];
}[] = [
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
      { href: "/admin/generations", label: "生成记录" },
      { href: "/admin/providers", label: "渠道" },
      { href: "/admin/pricing", label: "定价" },
      { href: "/admin/api-key-config", label: "API Key" },
      { href: "/admin/integrations", label: "AI 集成" },
      { href: "/admin/research", label: "研究工作台" },
    ],
  },
  {
    label: "系统",
    items: [
      { href: "/admin/inspiration", label: "灵感圈" },
      { href: "/admin/announcements", label: "公告" },
      { href: "https://iwish.chugao.art/", label: "许愿池" },
      { href: "/admin/system", label: "系统配置" },
      { href: "/admin/audit", label: "审计日志" },
    ],
  },
];

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme !== "light";

  return (
    <IconButton
      aria-label="切换主题"
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {mounted && !isDark ? <Sun size={14} /> : <Moon size={14} />}
    </IconButton>
  );
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => setNavOpen(false), [pathname]);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 768px)");
    const closeOnDesktop = () => {
      if (desktop.matches) setNavOpen(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  const isExternal = (href: string) => /^https?:\/\//.test(href);
  const isActive = (href: string) =>
    !isExternal(href) &&
    (href === "/admin" ? pathname === "/admin" : pathname.startsWith(href));

  const handleLogout = async () => {
    try {
      await logout();
      router.replace("/login");
      router.refresh();
    } catch {
      // Keep the session cookie so the user can retry when the auth database
      // becomes available again.
    }
  };

  const sidebar = (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-12 items-center gap-2.5 border-b border-border px-4">
        <span className="flex h-5 w-5 items-center justify-center rounded bg-brand text-[10px] font-bold text-on-accent">
          C
        </span>
        <span className="text-[13px] font-semibold tracking-tight">
          Chūgǎo <span className="text-text-faint">/ 管理端</span>
        </span>
        <IconButton
          aria-label="关闭管理导航"
          title="关闭管理导航"
          className="ml-auto md:hidden"
          onClick={() => setNavOpen(false)}
        >
          <X />
        </IconButton>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2.5 py-3">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="mb-5">
            <p className="mb-1 px-2 font-mono text-[10px] uppercase tracking-[0.14em] text-text-faint">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  target={isExternal(item.href) ? "_blank" : undefined}
                  rel={isExternal(item.href) ? "noreferrer" : undefined}
                  onClick={() => setNavOpen(false)}
                  aria-current={isActive(item.href) ? "page" : undefined}
                  className={cn(
                    "relative block rounded-md px-2 py-1.5 text-[13px] transition-colors",
                    isActive(item.href)
                      ? "bg-surface-2 font-medium text-foreground"
                      : "text-text-muted hover:bg-surface-2 hover:text-foreground",
                  )}
                >
                  {isActive(item.href) ? (
                    <span className="absolute left-0 top-1/2 h-3.5 w-0.5 -translate-y-1/2 rounded-full bg-brand" />
                  ) : null}
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="flex items-center justify-between gap-1 border-t border-border px-2.5 py-2.5">
        <Link
          href="/app"
          className="flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          <ArrowLeft size={13} strokeWidth={1.5} />
          回到工作台
        </Link>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <IconButton
            aria-label="退出登录"
            title="退出登录"
            onClick={() => void handleLogout()}
            className="hover:text-danger"
          >
            <LogOut size={14} strokeWidth={1.5} />
          </IconButton>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background text-foreground md:h-screen md:flex-row">
      <Dialog open={navOpen} onOpenChange={setNavOpen}>
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3 md:hidden">
          <span className="text-sm font-semibold">Chūgǎo / 管理端</span>
          <DialogTrigger>
            <IconButton
              aria-label="打开管理导航"
              title="打开管理导航"
              size="lg"
            >
              <Menu />
            </IconButton>
          </DialogTrigger>
        </header>
        <DialogContent
          hideClose
          aria-describedby={undefined}
          className="inset-y-0 left-0 top-0 h-dvh w-[min(17rem,86vw)] max-w-none translate-x-0 translate-y-0 rounded-none border-y-0 border-l-0"
        >
          <DialogTitle className="sr-only">管理导航</DialogTitle>
          {sidebar}
        </DialogContent>
      </Dialog>
      <aside className="hidden h-full w-[216px] shrink-0 border-r border-border md:block">
        {sidebar}
      </aside>

      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1200px] px-3 py-4 sm:px-6 sm:py-6">
          {children}
        </div>
      </main>
    </div>
  );
}
