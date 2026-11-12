"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Compass,
  History,
  Network,
  MessageSquare,
  Presentation,
  Search,
  Settings,
  SquarePen,
  ArrowUpRight,
  Trash2,
  Wallet,
} from "lucide-react";
import { Button, IconButton, Input } from "@/components/ui";
import { Logo } from "@/components/shared/Logo";
import { cn } from "@/lib/utils";
import type { ConversationSummary } from "../lib/types";

interface Props {
  pathname?: string;
  threads: ConversationSummary[];
  activeId: string | null;
  disabled: boolean;
  loading: boolean;
  error: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete?: (id: string) => Promise<void>;
  onReload: () => void;
  onNavigate?: () => void;
}

export function ConversationSidebar({
  pathname = "/app",
  threads,
  activeId,
  disabled,
  loading,
  error,
  onSelect,
  onNew,
  onDelete,
  onReload,
  onNavigate,
}: Props) {
  const [search, setSearch] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const filtered = threads.filter((thread) =>
    `${thread.title} ${thread.latestMessage ?? ""}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");
  const inspirationActive =
    isActive("/app/inspiration") || isActive("/app/publish");
  const historyActive = isActive("/app/history") || isActive("/app/g");
  const linkClass = (active: boolean) =>
    cn(
      "smooth-surface studio-nav-link relative flex h-10 items-center gap-3 rounded-md px-3 text-[13px] transition-colors",
      active
        ? "font-medium text-foreground"
        : "text-text-muted hover:bg-surface-2 hover:text-foreground",
    );
  return (
    <div className="studio-sidebar flex h-full min-h-0 flex-col overflow-y-auto">
      <div className="flex h-20 shrink-0 items-center gap-2 px-5">
        <Logo />
        <span className="mt-0.5 text-[11px] text-text-faint">Studio</span>
      </div>
      <div className="px-4 pb-5">
        <Button
          variant="primary"
          onClick={onNew}
          disabled={disabled}
          className="h-10 w-full justify-start gap-3 px-3 text-[13px] shadow-[var(--shadow-xs)]"
        >
          <SquarePen size={16} />
          <span className="flex-1 text-left">新对话</span>
          <ArrowUpRight size={14} className="opacity-60" />
        </Button>
      </div>
      <nav aria-label="创作导航" className="space-y-1 px-3 pb-5">
        <p className="px-3 pb-2 text-[11px] font-medium text-text-faint">
          工作区
        </p>
        <Link
          href="/app/inspiration"
          aria-current={inspirationActive ? "page" : undefined}
          onClick={onNavigate}
          className={linkClass(inspirationActive)}
        >
          <Compass size={17} /> 灵感圈
        </Link>
        <Link
          href="/app/nodes"
          aria-current={
            isActive("/app/nodes") || isActive("/app/canvas")
              ? "page"
              : undefined
          }
          onClick={onNavigate}
          className={linkClass(
            isActive("/app/nodes") || isActive("/app/canvas"),
          )}
        >
          <Network size={17} /> 节点画布
        </Link>
        <Link
          href="/app/ppt"
          aria-current={isActive("/app/ppt") ? "page" : undefined}
          onClick={onNavigate}
          className={linkClass(isActive("/app/ppt"))}
        >
          <Presentation size={17} /> PPT
        </Link>
        <Link
          href="/app/history"
          aria-current={historyActive ? "page" : undefined}
          onClick={onNavigate}
          className={linkClass(historyActive)}
        >
          <History size={17} /> 历史图片
        </Link>
        <Link
          href="/app/recharge"
          aria-current={isActive("/app/recharge") ? "page" : undefined}
          onClick={onNavigate}
          className={linkClass(isActive("/app/recharge"))}
        >
          <Wallet size={17} /> 充值
        </Link>
      </nav>
      <div className="mx-5 mb-4 border-t border-border" />
      <div className="relative mx-4 mb-4">
        <Search
          size={15}
          className="pointer-events-none absolute left-2.5 top-2.5 text-text-faint"
        />
        <Input
          aria-label="搜索最近对话"
          placeholder="搜索对话"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="h-9 border-transparent bg-surface pl-8 text-xs placeholder:text-text-faint hover:border-border focus:border-border-strong"
        />
      </div>
      <div className="flex items-center justify-between px-6 pb-2 text-[11px] font-medium text-text-faint">
        最近对话
        {threads.length > 0 ? (
          <span className="tabular-nums">{threads.length}</span>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 overscroll-contain">
        {loading ? (
          <p role="status" className="px-2 py-4 text-sm text-text-muted">
            加载中…
          </p>
        ) : error ? (
          <div role="alert" className="px-2 py-3 text-sm text-danger">
            <p>{error}</p>
            <Button variant="ghost" size="sm" onClick={onReload}>
              重新加载
            </Button>
          </div>
        ) : filtered.length ? (
          filtered.map((thread) => (
            <div
              key={thread.id}
              className={cn(
                "smooth-surface studio-thread group relative mb-0.5 flex min-h-10 min-w-0 items-center rounded-md transition-colors",
                activeId === thread.id
                  ? "text-foreground"
                  : "text-text-muted hover:text-foreground",
              )}
              data-active={activeId === thread.id ? "true" : "false"}
            >
              <button
                type="button"
                disabled={disabled}
                onClick={() => onSelect(thread.id)}
                aria-current={activeId === thread.id ? "page" : undefined}
                title={thread.title}
                className="flex min-h-10 min-w-0 flex-1 items-center gap-2.5 px-3 py-2 text-left text-[13px] focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-brand/35 disabled:opacity-50"
              >
                <MessageSquare size={14} className="shrink-0 text-text-faint" />
                <span className="min-w-0 truncate">{thread.title}</span>
              </button>
              {onDelete ? (
                <IconButton
                  type="button"
                  variant="ghost"
                  aria-label={"删除对话 " + thread.title}
                  title="删除对话"
                  disabled={disabled || deletingId === thread.id}
                  onClick={async (event) => {
                    event.stopPropagation();
                    if (
                      typeof window !== "undefined" &&
                      !window.confirm("删除“" + thread.title + "”？")
                    )
                      return;
                    setDeletingId(thread.id);
                    try {
                      await onDelete(thread.id);
                    } catch {
                      onReload();
                    } finally {
                      setDeletingId(null);
                    }
                  }}
                  className="studio-thread-delete mr-1 h-8 w-8 shrink-0 text-text-muted hover:text-danger focus-visible:text-foreground"
                >
                  <Trash2 size={14} />
                </IconButton>
              ) : null}
            </div>
          ))
        ) : (
          <p className="px-3 py-3 text-xs text-text-faint">
            {search ? "没有匹配的对话" : "还没有创作记录"}
          </p>
        )}
      </div>
      <nav
        aria-label="设置导航"
        className="mx-3 shrink-0 border-t border-border py-3"
      >
        <Link
          href="/app/settings"
          aria-current={isActive("/app/settings") ? "page" : undefined}
          onClick={onNavigate}
          className={cn(linkClass(isActive("/app/settings")), "h-11")}
        >
          <Settings size={17} /> 设置
        </Link>
      </nav>
    </div>
  );
}
