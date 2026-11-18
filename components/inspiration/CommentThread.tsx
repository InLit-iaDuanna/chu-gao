"use client";

import { useCallback, useEffect, useState } from "react";
import { MessageCircle, Reply, Send, X } from "lucide-react";

import {
  Button,
  EmptyState,
  IconButton,
  Textarea,
  useToast,
} from "@/components/ui";
import {
  inspirationRequest,
  InspirationApiError,
  loginForCurrentPage,
} from "./api";
import { ReportDialog } from "./ReportDialog";
import type { InspirationComment } from "./types";

function CommentItem({
  comment,
  onReply,
  depth = 0,
}: {
  comment: InspirationComment;
  onReply: (comment: InspirationComment) => void;
  depth?: number;
}) {
  return (
    <article className="min-w-0 border-b border-border py-4 last:border-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 max-w-full break-words text-sm font-medium">
          {comment.authorName}
        </span>
        <time className="text-xs text-text-muted">
          {new Date(comment.createdAt).toLocaleString("zh-CN")}
        </time>
      </div>
      <p
        className={`mt-2 whitespace-pre-wrap break-words text-sm leading-6 ${comment.deleted ? "italic text-text-faint" : "text-text-muted"}`}
      >
        {comment.content}
      </p>
      {!comment.deleted ? (
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <Button
            variant="ghost"
            className="h-9 gap-1 px-2 text-xs text-text-muted"
            onClick={() => onReply(comment)}
          >
            <Reply size={12} /> 回复
          </Button>
          <ReportDialog
            postId={comment.postId}
            commentId={comment.id}
            triggerClassName="h-9 gap-1 px-2 text-xs text-text-muted"
          />
        </div>
      ) : null}
      {comment.replies.length ? (
        <div
          className={
            depth < 2
              ? "mt-2 min-w-0 border-l border-border pl-3 sm:ml-3 sm:pl-4"
              : "mt-2 min-w-0"
          }
        >
          {comment.replies.map((reply) => (
            <CommentItem
              key={reply.id}
              comment={reply}
              onReply={onReply}
              depth={depth + 1}
            />
          ))}
        </div>
      ) : null}
    </article>
  );
}

function countComments(items: InspirationComment[]): number {
  return items.reduce(
    (total, item) => total + 1 + countComments(item.replies ?? []),
    0,
  );
}

export function CommentThread({ postId }: { postId: string }) {
  const { toast } = useToast();
  const [items, setItems] = useState<InspirationComment[]>([]);
  const [content, setContent] = useState("");
  const [replyingTo, setReplyingTo] = useState<InspirationComment | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await inspirationRequest<{ items: InspirationComment[] }>(
        `/api/inspiration/posts/${postId}/comments`,
      );
      setItems(data.items);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [postId]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    if (!content.trim()) return;
    setSending(true);
    try {
      await inspirationRequest(`/api/inspiration/posts/${postId}/comments`, {
        method: "POST",
        body: JSON.stringify({
          content: content.trim(),
          parentId: replyingTo?.id ?? null,
        }),
      });
      setContent("");
      setReplyingTo(null);
      await load();
    } catch (error) {
      if (error instanceof InspirationApiError && error.status === 401)
        return loginForCurrentPage();
      toast({
        title: "评论失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "danger",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <section
      id="discussion"
      className="min-w-0 scroll-mt-6 text-sm tracking-normal"
    >
      <div className="flex items-center gap-2">
        <MessageCircle size={17} />
        <h2 className="app-section-title text-xl font-semibold">讨论</h2>
        <span className="text-xs text-text-faint">
          {countComments(items)} 条
        </span>
      </div>
      <div className="mt-4 space-y-3">
        {replyingTo ? (
          <div className="flex items-center justify-between gap-2 text-xs text-text-muted">
            <span className="min-w-0 break-words">
              回复 {replyingTo.authorName}
            </span>
            <IconButton
              className="h-9 w-9"
              aria-label="取消回复"
              title="取消回复"
              onClick={() => setReplyingTo(null)}
            >
              <X size={16} />
            </IconButton>
          </div>
        ) : null}
        <Textarea
          aria-label="讨论内容"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder="说清楚你的观察、依据或不同意见…"
          className="min-h-24"
        />
        <div className="flex justify-end">
          <Button
            variant="primary"
            disabled={sending || !content.trim()}
            onClick={() => void submit()}
          >
            <Send size={14} /> {sending ? "发布中…" : "发布回应"}
          </Button>
        </div>
      </div>
      <div className="mt-4">
        {loading ? (
          <p role="status" className="py-8 text-center text-sm text-text-muted">
            正在读取讨论…
          </p>
        ) : items.length ? (
          items.map((item) => (
            <CommentItem key={item.id} comment={item} onReply={setReplyingTo} />
          ))
        ) : (
          <EmptyState
            icon={MessageCircle}
            title="还没有回应"
            description="先把你的判断说出来。"
          />
        )}
      </div>
    </section>
  );
}
