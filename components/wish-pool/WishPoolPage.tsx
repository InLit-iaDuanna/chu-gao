"use client";

import { Button } from "@/components/ui";

import { Input, Select, Textarea } from "@/components/ui";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  MessageCircle,
  Pencil,
  Pin,
  Plus,
  Search,
  Send,
  Sparkles,
  X,
} from "lucide-react";

type Comment = {
  id: string;
  content: string;
  authorName: string;
  isAdmin: boolean;
  createdAt: string;
  canEdit: boolean;
  parentId: string | null;
};
type Wish = {
  id: string;
  title: string;
  content: string;
  authorName: string;
  status: string;
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
  comments: Comment[];
};

const statusLabels: Record<string, string> = {
  OPEN: "开放讨论",
  PLANNED: "已纳入计划",
  IN_PROGRESS: "开发中",
  COMPLETED: "已完成",
  DECLINED: "暂不考虑",
};
const statusColors: Record<string, string> = {
  OPEN: "border-border text-text-muted",
  PLANNED: "border-info/40 text-info",
  IN_PROGRESS: "border-brand/40 text-brand",
  COMPLETED: "border-success/40 text-success",
  DECLINED: "border-danger/40 text-danger",
};

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function WishPoolPage(): React.ReactElement {
  const [items, setItems] = useState<Wish[]>([]);
  const [remaining, setRemaining] = useState(3);
  const [viewer, setViewer] = useState<{ role: string; email: string } | null>(
    null,
  );
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [editing, setEditing] = useState<Wish | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    document.title = "许愿池 · Chūgǎo";
  }, []);

  const load = useCallback(
    async (cursor?: string) => {
      if (cursor) setLoadingMore(true);
      else setLoading(true);
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(
        `/api/wishes${params.size ? `?${params}` : ""}`,
        { cache: "no-store" },
      );
      const json = await response.json();
      if (json.ok) {
        setItems((current) =>
          cursor ? [...current, ...json.data.items] : json.data.items,
        );
        setNextCursor(json.data.nextCursor);
        setRemaining(json.data.remainingToday);
        setViewer(json.data.viewer);
      } else setNotice(json.error?.message || "许愿池暂时不可用");
      setLoading(false);
      setLoadingMore(false);
    },
    [query],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const openCount = useMemo(
    () => items.filter((item) => item.status === "OPEN").length,
    [items],
  );
  const isAdmin = viewer?.role === "ADMIN";

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-brand text-on-accent">
              <Sparkles size={18} />
            </div>
            <div>
              <p className="text-base font-semibold">许愿池</p>
              <p className="text-xs text-text-muted">
                和大家一起决定 Chūgǎo 的下一步
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-text-muted">
            {viewer ? (
              <span className="hidden sm:inline">
                {viewer.role === "ADMIN" ? "管理员视图" : viewer.email}
              </span>
            ) : (
              <a
                className="hidden hover:text-foreground sm:inline"
                href="/login?next=/"
              >
                管理员登录
              </a>
            )}
            <a
              className="rounded-md border border-border px-3 py-2 hover:bg-surface-2"
              href="https://chugao.art/"
            >
              返回 Chūgǎo
            </a>
          </div>
        </div>
      </header>
      <section className="mx-auto max-w-5xl px-5 pb-10 pt-12">
        <div className="max-w-2xl">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-brand">
            I WISH
          </p>
          <h1 className="mt-3 text-4xl font-semibold leading-tight sm:text-5xl">
            把你想要的功能，
            <br />
            <span className="text-text-muted">写进下一版。</span>
          </h1>
          <p className="mt-5 text-sm leading-7 text-text-muted">
            这里是公开的产品许愿池。每个 IP 每天可发布 3
            个愿望，讨论回复不限次数；管理员会在这里回应并更新进度。
          </p>
        </div>
        <div className="mt-9 flex flex-col gap-3 sm:flex-row">
          <Button
            variant="primary"
            className="h-10 px-4"
            onClick={() => {
              setEditing(null);
              setComposerOpen(true);
            }}
            disabled={!isAdmin && remaining === 0}
          >
            <Plus size={16} />
            发布愿望{" "}
            <span className="font-mono text-xs opacity-75">
              {isAdmin ? "管理员不限次数" : `今日还可许愿 ${remaining}/3`}
            </span>
          </Button>
          <label className="relative flex h-10 max-w-sm flex-1">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-text-faint"
              size={16}
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索愿望"
              className="w-full rounded-md border border-border bg-surface pl-9 pr-3 text-sm outline-none focus:border-brand"
            />
          </label>
        </div>
        {notice ? (
          <div className="mt-4 flex items-center justify-between rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            {notice}
            <Button variant="ghost" onClick={() => setNotice("")}>
              <X size={16} />
            </Button>
          </div>
        ) : null}
        <div className="mt-10 flex items-center justify-between border-b border-border pb-3 text-xs text-text-muted">
          <span>
            {loading
              ? "正在加载…"
              : `${items.length} 条愿望 · ${openCount} 条开放讨论`}
          </span>
          <span>按最新发布排序</span>
        </div>
        <div className="mt-4 grid gap-3">
          {items.map((wish) => (
            <WishCard
              key={wish.id}
              wish={wish}
              onEdit={() => {
                setEditing(wish);
                setComposerOpen(true);
              }}
              onRefresh={() => load()}
              onError={setNotice}
            />
          ))}
          {!loading && items.length === 0 ? (
            <div className="border border-dashed border-border py-16 text-center text-sm text-text-muted">
              还没有愿望，成为第一个发言的人。
            </div>
          ) : null}
        </div>
        {nextCursor ? (
          <div className="mt-6 flex justify-center">
            <Button
              variant="ghost"
              className="h-9 border border-border px-4"
              disabled={loadingMore}
              onClick={() => void load(nextCursor)}
            >
              {loadingMore ? "加载中…" : "加载更多"}
            </Button>
          </div>
        ) : null}
      </section>
      {composerOpen ? (
        <WishComposer
          initial={editing}
          isAdmin={isAdmin}
          onClose={() => setComposerOpen(false)}
          onSaved={() => {
            setComposerOpen(false);
            void load();
          }}
          onError={setNotice}
        />
      ) : null}
    </main>
  );
}

function WishCard({
  wish,
  onEdit,
  onRefresh,
  onError,
}: {
  wish: Wish;
  onEdit: () => void;
  onRefresh: () => Promise<void>;
  onError: (message: string) => void;
}): React.ReactElement {
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingComment, setEditingComment] = useState("");
  async function sendReply() {
    if (!reply.trim()) return;
    setSending(true);
    const response = await fetch(`/api/wishes/${wish.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: reply }),
    });
    const json = await response.json();
    if (!response.ok) onError(json.error?.message || "回复失败");
    else {
      setReply("");
      await onRefresh();
    }
    setSending(false);
  }
  async function saveComment() {
    if (!editingCommentId || !editingComment.trim()) return;
    setSending(true);
    const response = await fetch(`/api/wishes/comments/${editingCommentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: editingComment }),
    });
    const json = await response.json();
    if (!response.ok) onError(json.error?.message || "修改失败");
    else {
      setEditingCommentId(null);
      setEditingComment("");
      await onRefresh();
    }
    setSending(false);
  }
  return (
    <article className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold">{wish.title}</h2>
            {wish.isPinned ? <Pin size={14} className="text-brand" /> : null}
            <span
              className={`rounded-full border px-2 py-0.5 text-[11px] ${statusColors[wish.status]}`}
            >
              {statusLabels[wish.status]}
            </span>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-text-muted">
            {wish.content}
          </p>
          <p className="mt-4 text-xs text-text-faint">
            {wish.authorName} · {dateLabel(wish.createdAt)}
          </p>
        </div>
        {wish.canEdit ? (
          <Button
            variant="ghost"
            title="编辑愿望"
            className="rounded-md p-2 text-text-muted hover:bg-surface-2 hover:text-foreground"
            onClick={onEdit}
          >
            <Pencil size={15} />
          </Button>
        ) : null}
      </div>
      <div className="mt-5 border-t border-border pt-4">
        <div className="flex items-center gap-2 text-xs font-medium text-text-muted">
          <MessageCircle size={14} />
          {wish.comments.length} 条讨论
        </div>
        <div className="mt-3 grid gap-3">
          {wish.comments.map((comment) => (
            <div
              key={comment.id}
              className={`border-l-2 pl-3 ${comment.isAdmin ? "border-brand" : "border-border"}`}
            >
              <div className="flex items-center gap-2 text-xs">
                <span className="font-medium">{comment.authorName}</span>
                {comment.isAdmin ? (
                  <span className="rounded border border-brand/40 px-1 text-[10px] text-brand">
                    管理员
                  </span>
                ) : null}
                <span className="text-text-faint">
                  {dateLabel(comment.createdAt)}
                </span>
                {comment.canEdit && editingCommentId !== comment.id ? (
                  <Button
                    variant="ghost"
                    title="编辑回复"
                    className="ml-auto rounded p-1 text-text-faint hover:bg-surface-2 hover:text-foreground"
                    onClick={() => {
                      setEditingCommentId(comment.id);
                      setEditingComment(comment.content);
                    }}
                  >
                    <Pencil size={12} />
                  </Button>
                ) : null}
              </div>
              {editingCommentId === comment.id ? (
                <div className="mt-2 flex gap-2">
                  <Input
                    value={editingComment}
                    onChange={(event) => setEditingComment(event.target.value)}
                    className="min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm outline-none focus:border-brand"
                  />
                  <Button
                    variant="ghost"
                    title="保存修改"
                    onClick={() => void saveComment()}
                    className="rounded-md bg-brand p-1.5 text-on-accent"
                  >
                    <Check size={14} />
                  </Button>
                  <Button
                    variant="ghost"
                    title="取消修改"
                    onClick={() => setEditingCommentId(null)}
                    className="rounded-md border border-border p-1.5 text-text-muted"
                  >
                    <X size={14} />
                  </Button>
                </div>
              ) : (
                <p className="mt-1 whitespace-pre-wrap text-sm text-text-muted">
                  {comment.content}
                </p>
              )}
            </div>
          ))}
        </div>
        <div className="mt-4 flex gap-2">
          <Input
            value={reply}
            onChange={(event) => setReply(event.target.value)}
            placeholder="加入讨论…"
            className="min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-brand"
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void sendReply();
              }
            }}
          />
          <Button
            variant="ghost"
            title="发送回复"
            onClick={() => void sendReply()}
            disabled={sending || !reply.trim()}
            className="rounded-md bg-brand p-2 text-on-accent disabled:opacity-40"
          >
            <Send size={15} />
          </Button>
        </div>
      </div>
    </article>
  );
}

function WishComposer({
  initial,
  isAdmin,
  onClose,
  onSaved,
  onError,
}: {
  initial: Wish | null;
  isAdmin: boolean;
  onClose: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
}): React.ReactElement {
  const [title, setTitle] = useState(initial?.title || "");
  const [content, setContent] = useState(initial?.content || "");
  const [authorName, setAuthorName] = useState("");
  const [status, setStatus] = useState(initial?.status || "OPEN");
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    const response = await fetch(
      initial ? `/api/wishes/${initial.id}` : "/api/wishes",
      {
        method: initial ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          initial
            ? { title, content, ...(isAdmin ? { status } : {}) }
            : { title, content, authorName },
        ),
      },
    );
    const json = await response.json();
    setSaving(false);
    if (!response.ok) onError(json.error?.message || "保存失败");
    else onSaved();
  }
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-5">
      <div className="w-full max-w-lg rounded-t-lg border border-border bg-surface p-5 sm:rounded-lg">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {initial ? "编辑愿望" : "发布新愿望"}
          </h2>
          <Button
            variant="ghost"
            onClick={onClose}
            className="rounded p-1 text-text-muted hover:bg-surface-2"
          >
            <X size={18} />
          </Button>
        </div>
        <div className="mt-5 grid gap-4">
          <label className="grid gap-1 text-xs text-text-muted">
            标题
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={80}
              className="h-10 rounded-md border border-border bg-surface-2 px-3 text-sm outline-none focus:border-brand"
            />
          </label>
          <label className="grid gap-1 text-xs text-text-muted">
            具体描述
            <Textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              maxLength={2000}
              rows={5}
              className="resize-y rounded-md border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-brand"
            />
          </label>
          {!initial ? (
            <label className="grid gap-1 text-xs text-text-muted">
              显示昵称（可选）
              <Input
                value={authorName}
                onChange={(event) => setAuthorName(event.target.value)}
                maxLength={24}
                className="h-10 rounded-md border border-border bg-surface-2 px-3 text-sm outline-none focus:border-brand"
                placeholder="匿名访客"
              />
            </label>
          ) : null}
          {initial && isAdmin ? (
            <label className="grid gap-1 text-xs text-text-muted">
              处理状态
              <Select
                aria-label="处理状态"
                controlSize="lg"
                value={status}
                onValueChange={setStatus}
                options={Object.entries(statusLabels).map(([value, label]) => ({
                  value,
                  label,
                }))}
              />
            </label>
          ) : null}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} className="h-9 px-4">
            取消
          </Button>
          <Button
            variant="ghost"
            onClick={() => void save()}
            disabled={saving || !title.trim() || !content.trim()}
            className="h-9 px-4"
          >
            <Check size={15} />
            {saving ? "保存中…" : "保存"}
          </Button>
        </div>
      </div>
    </div>
  );
}
