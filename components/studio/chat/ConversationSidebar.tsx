"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Compass,
  History,
  Network,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Presentation,
  Search,
  Settings,
  SquarePen,
  Trash2,
  ArrowUpRight,
} from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DropdownMenu,
  DropdownMenuItem,
  IconButton,
  Input,
} from "@/components/ui";
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
  onReload: () => void;
  onRename: (id: string, title: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onNavigate?: () => void;
  researchEnabled?: boolean;
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
  onReload,
  onRename,
  onDelete,
  onNavigate,
  researchEnabled = false,
}: Props) {
  const [search, setSearch] = useState("");
  const [renameTarget, setRenameTarget] = useState<ConversationSummary | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] = useState<ConversationSummary | null>(
    null,
  );
  const [title, setTitle] = useState("");
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const openRename = (thread: ConversationSummary) => {
    setRenameTarget(thread);
    setTitle(thread.title);
    setActionError(null);
  };
  const openDelete = (thread: ConversationSummary) => {
    setDeleteTarget(thread);
    setActionError(null);
  };
  const saveRename = async () => {
    const nextTitle = title.trim();
    if (!renameTarget || !nextTitle || actionPending) return;
    if (nextTitle === renameTarget.title) {
      setRenameTarget(null);
      return;
    }
    setActionPending(true);
    setActionError(null);
    try {
      await onRename(renameTarget.id, nextTitle);
      setRenameTarget(null);
    } catch {
      setActionError("重命名失败，请稍后重试");
    } finally {
      setActionPending(false);
    }
  };
  const confirmDelete = async () => {
    if (!deleteTarget || actionPending) return;
    setActionPending(true);
    setActionError(null);
    try {
      await onDelete(deleteTarget.id);
      setDeleteTarget(null);
    } catch {
      setActionError("删除失败，请稍后重试");
    } finally {
      setActionPending(false);
    }
  };

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
      "studio-nav-link flex h-10 items-center gap-3 rounded-md px-3 text-[13px] transition-colors",
      active
        ? "font-medium text-foreground"
        : "text-text-muted hover:bg-surface-2 hover:text-foreground",
    );
  return (
    <div className="studio-sidebar flex h-full min-h-0 flex-col">
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
        {researchEnabled ? (
          <Link
            href="/app/research"
            aria-current={isActive("/app/research") ? "page" : undefined}
            onClick={onNavigate}
            className={linkClass(isActive("/app/research"))}
          >
            <Search size={17} /> 研究
          </Link>
        ) : null}
        <Link
          href="/app/canvas"
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
          <Network size={17} /> 设计画布
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
                "group mb-0.5 flex min-w-0 items-center rounded-md transition-colors",
                activeId === thread.id
                  ? "bg-surface-2 text-foreground"
                  : "text-text-muted hover:bg-surface hover:text-foreground",
              )}
            >
              <button
                type="button"
                disabled={disabled}
                onClick={() => onSelect(thread.id)}
                aria-current={activeId === thread.id ? "page" : undefined}
                title={thread.title}
                className="flex min-h-10 min-w-0 flex-1 items-center gap-2.5 rounded-md px-3 py-2 text-left text-[13px] focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-50"
              >
                <MessageSquare size={14} className="shrink-0 text-text-faint" />
                <span className="min-w-0 truncate">{thread.title}</span>
              </button>
              <DropdownMenu
                trigger={
                  <IconButton
                    aria-label={`对话操作：${thread.title}`}
                    title="对话操作"
                    disabled={disabled}
                    size="sm"
                    className="mr-1 h-7 w-7 text-text-faint opacity-100 hover:text-foreground md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 md:data-[state=open]:opacity-100"
                  >
                    <MoreHorizontal size={15} />
                  </IconButton>
                }
              >
                <DropdownMenuItem onClick={() => openRename(thread)}>
                  <Pencil size={15} />
                  重命名
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-danger"
                  onClick={() => openDelete(thread)}
                >
                  <Trash2 size={15} />
                  删除
                </DropdownMenuItem>
              </DropdownMenu>
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
      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open && !actionPending) {
            setRenameTarget(null);
            setActionError(null);
          }
        }}
      >
        <DialogContent aria-describedby={undefined} className="space-y-4 p-5">
          <DialogTitle>重命名对话</DialogTitle>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void saveRename();
            }}
          >
            <Input
              aria-label="对话名称"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onFocus={(event) => event.currentTarget.select()}
              maxLength={80}
              disabled={actionPending}
              autoFocus
            />
            {actionError ? (
              <p role="alert" className="text-sm text-danger">
                {actionError}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                disabled={actionPending}
                onClick={() => setRenameTarget(null)}
              >
                取消
              </Button>
              <Button
                type="submit"
                loading={actionPending}
                disabled={!title.trim()}
              >
                保存
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !actionPending) {
            setDeleteTarget(null);
            setActionError(null);
          }
        }}
      >
        <DialogContent className="space-y-4 p-5">
          <DialogTitle>删除对话</DialogTitle>
          <DialogDescription className="break-words">
            确定删除“{deleteTarget?.title}”吗？该对话将从最近对话中移除。
          </DialogDescription>
          {actionError ? (
            <p role="alert" className="text-sm text-danger">
              {actionError}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              disabled={actionPending}
              onClick={() => setDeleteTarget(null)}
            >
              取消
            </Button>
            <Button
              variant="danger"
              loading={actionPending}
              onClick={() => void confirmDelete()}
            >
              删除
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
