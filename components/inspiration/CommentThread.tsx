"use client";

import { useCallback, useEffect, useState } from "react";
import { MessageCircle, Reply, Send } from "lucide-react";

import { Button, Textarea, useToast } from "@/components/ui";
import { inspirationRequest, InspirationApiError, loginForCurrentPage } from "./api";
import { ReportDialog } from "./ReportDialog";
import type { InspirationComment } from "./types";

function CommentItem({ comment, onReply }: { comment: InspirationComment; onReply: (comment: InspirationComment) => void }) {
  return (
    <article className="border-b border-border py-4 last:border-0">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium">{comment.authorName}</span>
        <time className="font-mono text-[10px] text-text-faint">{new Date(comment.createdAt).toLocaleString("zh-CN")}</time>
      </div>
      <p className={`mt-2 whitespace-pre-wrap text-sm leading-6 ${comment.deleted ? "italic text-text-faint" : "text-text-muted"}`}>{comment.content}</p>
      {!comment.deleted ? (
        <div className="mt-1 flex items-center gap-1">
          <Button variant="ghost" className="h-7 gap-1 px-1 text-[11px] text-text-faint" onClick={() => onReply(comment)}>
            <Reply size={12} /> 回复
          </Button>
          <ReportDialog
            postId={comment.postId}
            commentId={comment.id}
            triggerClassName="h-7 gap-1 px-1 text-[11px] text-text-faint"
          />
        </div>
      ) : null}
      {comment.replies.length ? (
        <div className="ml-4 mt-2 border-l border-border pl-4">
          {comment.replies.map((reply) => <CommentItem key={reply.id} comment={reply} onReply={onReply} />)}
        </div>
      ) : null}
    </article>
  );
}

function countComments(items: InspirationComment[]): number {
  return items.reduce((total, item) => total + 1 + countComments(item.replies ?? []), 0);
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
      const data = await inspirationRequest<{ items: InspirationComment[] }>(`/api/inspiration/posts/${postId}/comments`);
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
        body: JSON.stringify({ content: content.trim(), parentId: replyingTo?.id ?? null }),
      });
      setContent("");
      setReplyingTo(null);
      await load();
    } catch (error) {
      if (error instanceof InspirationApiError && error.status === 401) return loginForCurrentPage();
      toast({ title: "评论失败", description: error instanceof Error ? error.message : "请稍后重试", variant: "danger" });
    } finally {
      setSending(false);
    }
  };

  return (
    <section id="discussion" className="surface-panel p-4 sm:p-6">
      <div className="flex items-center gap-2">
        <MessageCircle size={17} />
        <h2 className="font-medium">讨论</h2>
        <span className="text-xs text-text-faint">{countComments(items)} 条</span>
      </div>
      <div className="mt-4 rounded-lg border border-border bg-surface-2 p-3">
        {replyingTo ? (
          <div className="mb-2 flex items-center justify-between text-xs text-text-muted">
            <span>回复 {replyingTo.authorName}</span>
            <button type="button" onClick={() => setReplyingTo(null)} className="hover:text-foreground">取消</button>
          </div>
        ) : null}
        <Textarea value={content} onChange={(event) => setContent(event.target.value)} placeholder="说清楚你的观察、依据或不同意见…" className="min-h-24 border-0 bg-transparent px-0 shadow-none" />
        <div className="flex justify-end">
          <Button disabled={sending || !content.trim()} onClick={() => void submit()}>
            <Send size={14} /> {sending ? "发布中…" : "发布回应"}
          </Button>
        </div>
      </div>
      <div className="mt-4">
        {loading ? <p className="py-8 text-center text-sm text-text-muted">正在读取讨论…</p> : items.length ? items.map((item) => <CommentItem key={item.id} comment={item} onReply={setReplyingTo} />) : <p className="py-8 text-center text-sm text-text-muted">还没有回应。先把你的判断说出来。</p>}
      </div>
    </section>
  );
}
