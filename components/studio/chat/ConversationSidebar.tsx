"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Cloud,
  Compass,
  History,
  Network,
  Plus,
  Presentation,
  Search,
  Settings,
  Smartphone,
  Trash2,
  Wallet,
} from "lucide-react";
import { Button, IconButton, Input } from "@/components/ui";
import { Logo } from "@/components/shared/Logo";
import { useIsNativeApp } from "@/lib/app-client";
import { cn } from "@/lib/utils";
import type { ConversationSummary } from "../lib/types";
import { stripInteractiveBlocks } from "../lib/chat-interactive-blocks";

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
  // 节点画布与 PPT 只支持电脑端，原生 APP 里隐藏入口（直接访问会看到占位页）。
  const isNativeApp = useIsNativeApp();
  const filtered = threads.filter((thread) =>
    `${thread.title} ${stripInteractiveBlocks(thread.latestMessage ?? "")}`
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
      "studio-nav-link relative flex h-8 items-center gap-3 rounded-lg px-2 text-sm transition-colors",
      active ? "text-foreground" : "text-text-muted hover:text-foreground",
    );
  return (
    <div className="studio-sidebar flex h-full min-h-0 flex-col overflow-y-auto">
      <div className="flex h-12 shrink-0 items-center gap-2 px-4">
        <Logo />
      </div>
      <div className="px-2 pb-1 pt-1">
        <Button
          variant="ghost"
          onClick={onNew}
          disabled={disabled}
          className="studio-new-thread h-9 w-full justify-start gap-2.5 rounded-lg px-1.5 text-sm font-medium text-foreground"
        >
          <span className="studio-new-thread-mark">
            <Plus size={14} strokeWidth={2.4} />
          </span>
          <span className="flex-1 text-left">新对话</span>
        </Button>
      </div>
      <nav aria-label="创作导航" className="space-y-px px-2 pb-4">
        <Link
          href="/app/inspiration"
          aria-current={inspirationActive ? "page" : undefined}
          onClick={onNavigate}
          className={linkClass(inspirationActive)}
        >
          <Compass size={16} strokeWidth={1.75} /> 灵感圈
        </Link>
        <Link
          href="/app/nodes"
          aria-current={
            isActive("/app/nodes") || isActive("/app/canvas")
              ? "page"
              : undefined
          }
          onClick={onNavigate}
          className={cn(
            linkClass(isActive("/app/nodes") || isActive("/app/canvas")),
            isNativeApp && "hidden",
          )}
        >
          <Network size={16} strokeWidth={1.75} /> 节点画布
        </Link>
        <Link
          href="/app/ppt"
          aria-current={isActive("/app/ppt") ? "page" : undefined}
          onClick={onNavigate}
          className={cn(
            linkClass(isActive("/app/ppt")),
            isNativeApp && "hidden",
          )}
        >
          <Presentation size={16} strokeWidth={1.75} /> PPT
        </Link>
        <Link
          href="/app/history"
          aria-current={historyActive ? "page" : undefined}
          onClick={onNavigate}
          className={linkClass(historyActive)}
        >
          <History size={16} strokeWidth={1.75} /> 历史图片
        </Link>
        <Link
          href="/app/recharge"
          aria-current={isActive("/app/recharge") ? "page" : undefined}
          onClick={onNavigate}
          className={linkClass(isActive("/app/recharge"))}
        >
          <Wallet size={16} strokeWidth={1.75} /> 充值
        </Link>
      </nav>
      <div className="studio-label px-4 pb-1.5 pt-2">最近对话</div>
      <div className="relative mx-2 mb-1">
        <Search
          size={14}
          className="pointer-events-none absolute left-2.5 top-[9px] text-text-faint"
        />
        <Input
          aria-label="搜索最近对话"
          placeholder="搜索对话"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="h-8 rounded-lg border-transparent bg-transparent pl-8 text-sm placeholder:text-text-faint hover:bg-[rgb(var(--text)/0.05)] focus:border-transparent focus:bg-[rgb(var(--text)/0.05)]"
        />
      </div>
      <div className="min-h-0 flex-1 space-y-px overflow-y-auto px-2 pb-4 overscroll-contain">
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
                "studio-thread group relative flex h-8 min-w-0 items-center rounded-lg transition-colors",
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
                title={
                  thread.localOnly
                    ? `${thread.title}（仅本机）`
                    : thread.title
                }
                className="flex h-8 min-w-0 flex-1 items-center rounded-lg px-2 text-left text-sm focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[rgb(var(--text)/0.4)] disabled:opacity-50"
              >
                <span className="min-w-0 truncate">{thread.title}</span>
              </button>
              {thread.localOnly ? (
                <span
                  className="shrink-0 rounded bg-[rgb(var(--text)/0.08)] px-1 text-[10px] leading-4 text-text-faint"
                  aria-hidden="true"
                >
                  仅本机
                </span>
              ) : null}
              <span
                aria-hidden="true"
                title={
                  thread.storage === "local"
                    ? thread.localOnly
                      ? "仅本机（云端副本已过期）"
                      : "仅保存在本机"
                    : "已保存在云端"
                }
                className="shrink-0 text-text-faint"
              >
                {thread.storage === "local" ? (
                  <Smartphone size={13} />
                ) : (
                  <Cloud size={13} />
                )}
              </span>
              {onDelete ? (
                <IconButton
                  type="button"
                  variant="ghost"
                  aria-label={"删除对话 " + thread.title}
                  title="删除对话"
                  disabled={disabled || deletingId === thread.id}
                  onClick={async (event) => {
                    event.stopPropagation();
                    const message = thread.localOnly
                      ? "将从本机删除该对话记录，无法恢复。确定删除？"
                      : "删除“" + thread.title + "”？";
                    if (
                      typeof window !== "undefined" &&
                      !window.confirm(message)
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
                  className="studio-thread-delete mr-0.5 h-7 w-7 shrink-0 rounded-md text-text-muted hover:text-danger focus-visible:text-foreground"
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
        className="shrink-0 border-t border-border px-2 py-2"
      >
        <Link
          href="/app/settings"
          aria-current={isActive("/app/settings") ? "page" : undefined}
          onClick={onNavigate}
          className={linkClass(isActive("/app/settings"))}
        >
          <Settings size={16} strokeWidth={1.75} /> 设置
        </Link>
      </nav>
    </div>
  );
}
