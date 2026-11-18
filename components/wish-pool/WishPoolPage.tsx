"use client";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  IconButton,
  Input,
  Select,
  Textarea,
} from "@/components/ui";

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
    <main className="min-h-screen min-w-0 break-words bg-background text-sm tracking-normal text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
              <Sparkles size={18} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold">Chūgǎo</p>
              <p className="text-xs text-text-muted">
                和大家一起决定 Chūgǎo 的下一步
              </p>
            </div>
          </div>
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 text-xs text-text-muted">
            {viewer ? (
              <span className="hidden min-w-0 max-w-full break-all sm:inline">
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
            <Button asChild>
              <a href="https://chugao.art/">返回 Chūgǎo</a>
            </Button>
          </div>
        </div>
      </header>
      <section className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <div className="app-page-header block max-w-2xl border-0 pb-0">
          <h1 className="app-page-title text-xl font-semibold sm:text-2xl">
            许愿池
          </h1>
          <p className="app-page-description mt-2 text-sm leading-6 text-text-muted">
            这里是公开的产品许愿池。每个 IP 每天可发布 3
            个愿望，讨论回复不限次数；管理员会在这里回应并更新进度。
          </p>
        </div>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <Button
            variant="primary"
            onClick={() => {
              setEditing(null);
              setComposerOpen(true);
            }}
            disabled={!isAdmin && remaining === 0}
          >
            <Plus size={16} />
            发布愿望
          </Button>
          <span className="text-xs text-text-muted">
            {isAdmin ? "管理员不限次数" : `今日还可许愿 ${remaining}/3`}
          </span>
          <label className="relative flex min-w-0 flex-1 sm:ml-auto sm:max-w-sm">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-text-faint"
              size={16}
            />
            <Input
              aria-label="搜索愿望"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索愿望"
              className="h-9 pl-9"
            />
          </label>
        </div>
        {notice ? (
          <div
            role="alert"
            className="mt-4 flex items-center justify-between gap-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
          >
            <span className="min-w-0 break-words">{notice}</span>
            <IconButton
              className="h-9 w-9"
              aria-label="关闭提示"
              title="关闭提示"
              onClick={() => setNotice("")}
            >
              <X size={16} />
            </IconButton>
          </div>
        ) : null}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3 text-xs text-text-muted">
          <span>
            {loading
              ? "正在加载…"
              : `${items.length} 条愿望 · ${openCount} 条开放讨论`}
          </span>
          <span>按最新发布排序</span>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3">
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
            <EmptyState
              className="min-h-64"
              icon={Sparkles}
              title="还没有愿望"
              description="成为第一个发言的人。"
            />
          ) : null}
        </div>
        {nextCursor ? (
          <div className="mt-6 flex justify-center">
            <Button
              variant="secondary"
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
    <article className="min-w-0 rounded-lg border border-border bg-surface p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="min-w-0 max-w-full break-words text-xl font-semibold leading-7">
              {wish.title}
            </h2>
            {wish.isPinned ? <Pin size={14} className="text-brand" /> : null}
            <span
              className={`rounded-md border px-2 py-1 text-xs ${statusColors[wish.status]}`}
            >
              {statusLabels[wish.status]}
            </span>
          </div>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-text-muted">
            {wish.content}
          </p>
          <p className="mt-4 break-words text-xs text-text-muted">
            {wish.authorName} · {dateLabel(wish.createdAt)}
          </p>
        </div>
        {wish.canEdit ? (
          <IconButton
            aria-label="编辑愿望"
            title="编辑愿望"
            className="h-9 w-9"
            onClick={onEdit}
          >
            <Pencil size={15} />
          </IconButton>
        ) : null}
      </div>
      <div className="mt-5 border-t border-border pt-4">
        <div className="flex items-center gap-2 text-xs font-medium text-text-muted">
          <MessageCircle size={14} />
          {wish.comments.length} 条讨论
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3">
          {wish.comments.map((comment) => (
            <div
              key={comment.id}
              className={`min-w-0 border-l-2 pl-3 ${comment.isAdmin ? "border-brand" : "border-border"}`}
            >
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="min-w-0 max-w-full break-words font-medium">
                  {comment.authorName}
                </span>
                {comment.isAdmin ? (
                  <span className="rounded-md bg-brand/10 px-1.5 py-0.5 text-xs text-brand">
                    管理员
                  </span>
                ) : null}
                <span className="text-text-faint">
                  {dateLabel(comment.createdAt)}
                </span>
                {comment.canEdit && editingCommentId !== comment.id ? (
                  <IconButton
                    aria-label="编辑回复"
                    title="编辑回复"
                    className="ml-auto h-9 w-9"
                    onClick={() => {
                      setEditingCommentId(comment.id);
                      setEditingComment(comment.content);
                    }}
                  >
                    <Pencil size={12} />
                  </IconButton>
                ) : null}
              </div>
              {editingCommentId === comment.id ? (
                <div className="mt-2 flex gap-2">
                  <Input
                    aria-label="修改回复内容"
                    value={editingComment}
                    onChange={(event) => setEditingComment(event.target.value)}
                    className="h-9 min-w-0 flex-1"
                  />
                  <IconButton
                    variant="primary"
                    aria-label="保存修改"
                    title="保存修改"
                    onClick={() => void saveComment()}
                    className="h-9 w-9"
                  >
                    <Check size={14} />
                  </IconButton>
                  <IconButton
                    variant="secondary"
                    aria-label="取消修改"
                    title="取消修改"
                    onClick={() => setEditingCommentId(null)}
                    className="h-9 w-9"
                  >
                    <X size={14} />
                  </IconButton>
                </div>
              ) : (
                <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-text-muted">
                  {comment.content}
                </p>
              )}
            </div>
          ))}
        </div>
        <div className="mt-4 flex gap-2">
          <Input
            aria-label="回复内容"
            value={reply}
            onChange={(event) => setReply(event.target.value)}
            placeholder="加入讨论…"
            className="h-9 min-w-0 flex-1"
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void sendReply();
              }
            }}
          />
          <IconButton
            variant="primary"
            aria-label="发送回复"
            title="发送回复"
            onClick={() => void sendReply()}
            disabled={sending || !reply.trim()}
            className="h-9 w-9"
          >
            <Send size={15} />
          </IconButton>
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
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-32px)] max-w-lg overflow-y-auto rounded-lg text-sm tracking-normal">
        <DialogHeader>
          <DialogTitle className="pr-8 text-xl tracking-normal">
            {initial ? "编辑愿望" : "发布新愿望"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {initial ? "修改愿望的标题和具体描述" : "填写愿望的标题和具体描述"}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-4 px-5 pb-5">
          <label className="grid min-w-0 grid-cols-1 gap-1 text-xs text-text-muted">
            标题
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={80}
              className="h-9"
            />
          </label>
          <label className="grid min-w-0 grid-cols-1 gap-1 text-xs text-text-muted">
            具体描述
            <Textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              maxLength={2000}
              rows={5}
              className="min-h-32 resize-y"
            />
          </label>
          {!initial ? (
            <label className="grid min-w-0 grid-cols-1 gap-1 text-xs text-text-muted">
              显示昵称（可选）
              <Input
                value={authorName}
                onChange={(event) => setAuthorName(event.target.value)}
                maxLength={24}
                className="h-9"
                placeholder="匿名访客"
              />
            </label>
          ) : null}
          {initial && isAdmin ? (
            <label className="grid min-w-0 grid-cols-1 gap-1 text-xs text-text-muted">
              处理状态
              <Select
                aria-label="处理状态"
                className="h-9"
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
        <DialogFooter className="flex-wrap">
          <Button variant="ghost" onClick={onClose} className="h-9 px-4">
            取消
          </Button>
          <Button
            variant="primary"
            onClick={() => void save()}
            disabled={saving || !title.trim() || !content.trim()}
            className="h-9 px-4"
          >
            <Check size={15} />
            {saving ? "保存中…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
