"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Compass,
  History,
  LayoutGrid,
  MoreHorizontal,
  Presentation,
  Settings,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  activeConversationHref,
  readActiveConversationId,
} from "./lib/active-conversation";

const DESKTOP_NAV_ITEMS = [
  { href: "/app", label: "工作台", icon: LayoutGrid },
  { href: "/app/inspiration", label: "灵感圈", icon: Compass },
  { href: "/app/history", label: "历史", icon: History },
  { href: "/app/ppt", label: "PPT", icon: Presentation },
] as const;

const MOBILE_NAV_ITEMS = [
  { href: "/app", label: "工作台", icon: LayoutGrid },
  { href: "/app/inspiration", label: "灵感", icon: Compass },
  { href: "/app/history", label: "历史", icon: History },
] as const;

type IconRailProps = {
  mobile?: boolean;
  hideOnStudio?: boolean;
};

export function IconRail({
  mobile = false,
  hideOnStudio = false,
}: IconRailProps = {}) {
  const pathname = usePathname();
  const router = useRouter();
  const [workbenchHref, setWorkbenchHref] = useState("/app");

  useEffect(() => {
    setWorkbenchHref(activeConversationHref(readActiveConversationId()));
  }, [pathname]);

  const isPathWithin = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);
  const isActive = (href: string) =>
    href === "/app"
      ? pathname === "/app" || pathname === "/app/"
      : isPathWithin(href);
  // Publishing is part of the inspiration workflow even though the composer
  // lives inside the authenticated app shell.
  const inspirationActive =
    isPathWithin("/app/inspiration") || isPathWithin("/app/publish");
  const settingsActive = isActive("/app/settings");
  const moreActive = isPathWithin("/app/ppt") || settingsActive;

  const linkClass = (active: boolean) =>
    cn(
      "pressable relative flex min-w-0 flex-1 basis-0 items-center justify-center rounded-md transition-colors",
      mobile
        ? "h-16 flex-col gap-0.5 py-1 text-[10px] leading-4"
        : "h-9 w-9 flex-none",
      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground",
      active
        ? "bg-surface-2 text-foreground shadow-[inset_0_0_0_1px_rgb(var(--border-strong))]"
        : "text-text-muted hover:bg-surface-2 hover:text-foreground",
    );

  if (hideOnStudio && (pathname === "/app" || pathname === "/app/"))
    return null;

  return (
    <nav
      aria-label={mobile ? "移动端主导航" : "主导航"}
      className={cn(
        "shrink-0 border-border bg-background",
        mobile
          ? "flex h-[calc(4rem+env(safe-area-inset-bottom))] w-full flex-row items-start border-t px-1 pb-[env(safe-area-inset-bottom)] md:hidden"
          : "hidden h-full w-12 flex-col items-center gap-1 border-r py-3 md:flex",
      )}
    >
      {(mobile ? MOBILE_NAV_ITEMS : DESKTOP_NAV_ITEMS).map((item) => {
        const Icon = item.icon;
        const active =
          item.href === "/app/inspiration"
            ? inspirationActive
            : isActive(item.href);
        return (
          <Link
            key={item.href}
            href={item.href === "/app" ? workbenchHref : item.href}
            aria-label={item.label}
            aria-current={active ? "page" : undefined}
            title={item.label}
            className={linkClass(active)}
          >
            {active ? (
              <span className="absolute left-1/2 top-0 h-0.5 w-5 -translate-x-1/2 rounded-full bg-brand md:left-0 md:top-1/2 md:h-4 md:w-0.5 md:translate-x-0 md:-translate-y-1/2" />
            ) : null}
            <Icon
              aria-hidden="true"
              focusable="false"
              size={18}
              strokeWidth={active ? 2.2 : 1.8}
            />
            {mobile ? <span className="truncate">{item.label}</span> : null}
          </Link>
        );
      })}

      {mobile ? (
        <DropdownMenu
          className="mb-2"
          trigger={
            <button
              type="button"
              aria-label="更多"
              aria-current={moreActive ? "page" : undefined}
              title="更多"
              className={linkClass(moreActive)}
            >
              {moreActive ? (
                <span className="absolute left-1/2 top-0 h-0.5 w-5 -translate-x-1/2 rounded-full bg-brand" />
              ) : null}
              <MoreHorizontal aria-hidden="true" focusable="false" size={18} />
              <span className="truncate">更多</span>
            </button>
          }
        >
          <DropdownMenuItem onClick={() => router.push("/app/ppt")}>
            <Presentation aria-hidden="true" focusable="false" size={14} /> PPT
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => router.push("/app/settings")}>
            <Settings aria-hidden="true" focusable="false" size={14} /> 设置
          </DropdownMenuItem>
        </DropdownMenu>
      ) : (
        <Link
          href="/app/settings"
          aria-label="设置"
          aria-current={settingsActive ? "page" : undefined}
          title="设置"
          className={cn(linkClass(settingsActive), "mt-auto")}
        >
          {settingsActive ? (
            <span className="absolute left-1/2 top-0 h-0.5 w-5 -translate-x-1/2 rounded-full bg-brand md:left-0 md:top-1/2 md:h-4 md:w-0.5 md:translate-x-0 md:-translate-y-1/2" />
          ) : null}
          <Settings
            aria-hidden="true"
            focusable="false"
            size={18}
            strokeWidth={settingsActive ? 2.2 : 1.8}
          />
        </Link>
      )}
    </nav>
  );
}
