"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  Coins,
  LogOut,
  Moon,
  Shield,
  Sun,
  UserRound,
  ChevronRight,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import {
  DropdownMenu,
  DropdownMenuItem,
  IconButton,
  useToast,
} from "@/components/ui";

import { logout } from "./lib/api";
import type { Me, ModelInfo } from "./lib/types";
import {
  activeConversationHref,
  readActiveConversationId,
} from "./lib/active-conversation";

interface TopBarProps {
  me: Me | null;
  model: ModelInfo | null;
  leading?: ReactNode;
  title?: string;
  actions?: ReactNode;
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Keep the server render and the first client render identical.
  const isDark = !mounted || resolvedTheme !== "light";
  const nextTheme = isDark ? "浅色" : "深色";

  return (
    <IconButton
      variant="ghost"
      size="md"
      type="button"
      aria-label={`切换到${nextTheme}主题`}
      title={`切换到${nextTheme}主题`}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="h-9 w-9 rounded-md border-transparent bg-transparent text-text-muted hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-foreground/40"
    >
      {mounted && !isDark ? (
        <Sun size={16} strokeWidth={2.2} />
      ) : (
        <Moon size={16} strokeWidth={2.2} />
      )}
    </IconButton>
  );
}

export function TopBar({ me, model, leading, title, actions }: TopBarProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [workbenchHref, setWorkbenchHref] = useState("/app");

  useEffect(() => {
    setWorkbenchHref(activeConversationHref(readActiveConversationId()));
  }, []);

  const handleLogout = async () => {
    try {
      await logout();
      router.replace("/login");
      router.refresh();
    } catch (error) {
      toast({
        title: "退出登录失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "danger",
      });
    }
  };

  return (
    <header className="flex h-16 shrink-0 items-center gap-2 border-b border-border/70 bg-background px-3 md:gap-3 md:px-6">
      {leading}
      {title !== undefined ? (
        <div className="flex min-w-0 flex-1 items-center gap-2.5 text-[13px]">
          <span className="hidden shrink-0 text-text-faint lg:block">
            工作区
          </span>
          <ChevronRight
            size={13}
            className="hidden shrink-0 text-text-faint lg:block"
          />
          <span className="min-w-0 truncate font-medium" title={title}>
            {title}
          </span>
        </div>
      ) : (
        <>
          <Link
            href={workbenchHref}
            className="flex shrink-0 items-center gap-2"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand text-[11px] font-bold text-on-accent">
              C
            </span>
            <span className="hidden text-[13px] font-semibold tracking-tight sm:inline">
              Chūgǎo Studio
            </span>
          </Link>

          <span className="hidden h-4 w-px bg-border sm:block" aria-hidden />

          <span
            className="hidden min-w-0 max-w-[12rem] truncate text-sm font-medium leading-5 text-foreground sm:block sm:max-w-[18rem]"
            title={model?.displayName ?? "加载模型…"}
          >
            {model ? model.displayName : "加载模型…"}
          </span>
        </>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {actions}
        <span
          className={`mr-1 flex h-8 min-w-14 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-border bg-surface px-2.5 text-xs font-medium text-foreground ${me ? "" : "invisible"}`}
          title={
            me ? `今日已用 ${me.dailyUsed}/${me.dailyLimit} 次` : undefined
          }
          aria-hidden={!me}
        >
          {me ? (
            <>
              <Coins size={13} className="shrink-0 text-warning" />
              <span
                key={me.credits}
                className="pulse-once inline-block shrink-0 tabular-nums"
              >
                {me.credits}
              </span>
              <span className="hidden shrink-0 text-text-muted sm:inline">
                积分
              </span>
            </>
          ) : null}
        </span>

        <ThemeToggle />

        <DropdownMenu
          trigger={
            <IconButton
              variant="ghost"
              size="md"
              type="button"
              aria-label="账户菜单"
              title="账户菜单"
              className="ml-1 h-8 w-8 rounded-full border-border bg-surface-2 text-foreground hover:bg-surface-3 focus-visible:ring-2 focus-visible:ring-foreground/40"
            >
              {me ? (
                <span className="text-xs font-semibold">
                  {(me.name || me.email).slice(0, 1).toUpperCase()}
                </span>
              ) : (
                <UserRound size={15} />
              )}
            </IconButton>
          }
        >
          <div className="px-2 py-1.5">
            <p className="truncate text-xs font-medium text-foreground">
              {me?.name ?? me?.email ?? "…"}
            </p>
            <p className="truncate text-[11px] text-text-faint">{me?.email}</p>
          </div>
          <div className="my-1 h-px bg-border" />
          {me?.role === "ADMIN" ? (
            <DropdownMenuItem onClick={() => router.push("/admin")}>
              <Shield size={13} className="mr-2" />
              管理后台
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onClick={() => void handleLogout()}>
            <LogOut size={13} className="mr-2" />
            退出登录
          </DropdownMenuItem>
        </DropdownMenu>
      </div>
    </header>
  );
}
