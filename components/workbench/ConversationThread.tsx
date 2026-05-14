"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { Bot, Check, Copy, Pencil, RotateCcw, Trash2, X } from "lucide-react";

import { ProgressIndicator } from "@/components/shared/ProgressIndicator";
import type { ConversationMessage } from "@/lib/conversation";
import type { WorkbenchTaskStatus } from "@/components/workbench/types";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<WorkbenchTaskStatus, string> = {
  idle: "待输入",
  pending: "排队中",
  running: "生成中",
  succeeded: "已完成",
  failed: "失败",
  canceled: "已取消",
};

function formatMessageTime(value?: string) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDuration(startedAt?: string | null, finishedAt?: string | null) {
  if (!startedAt) {
    return null;
  }

  const start = new Date(startedAt).getTime();
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();

  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return null;
  }

  const seconds = Math.max(1, Math.round((end - start) / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;

  return minutes > 0 ? `${minutes}分${rest}秒` : `${rest}秒`;
}

export function ConversationThread({
  className,
  messages,
  taskStatus,
  progress,
  taskMeta,
  footer,
  onClearMessages,
  canClearMessages,
  onReuseMessage,
  onEditMessage,
}: {
  className?: string;
  messages: ConversationMessage[];
  taskStatus?: WorkbenchTaskStatus;
  progress?: number;
  taskMeta?: {
    provider?: string | null;
    providerChannelName?: string | null;
    startedAt?: string | null;
    finishedAt?: string | null;
  };
  footer?: ReactNode;
  onClearMessages?: () => void;
  canClearMessages?: boolean;
  onReuseMessage?: (content: string) => void;
  onEditMessage?: (messageId: string, content: string) => Promise<void>;
}) {
  const lastMessageContent = messages.at(-1)?.content;
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const duration = formatDuration(taskMeta?.startedAt, taskMeta?.finishedAt);
  const showProgress =
    taskStatus === "pending" ||
    taskStatus === "running" ||
    taskStatus === "succeeded";

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      scrollAnchorRef.current?.scrollIntoView({ block: "end" });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [messages.length, lastMessageContent, taskStatus]);

  async function copyMessage(message: ConversationMessage) {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedId(message.id ?? null);
      window.setTimeout(() => setCopiedId(null), 1200);
    } catch {
      setCopiedId(null);
    }
  }

  async function saveEdit(message: ConversationMessage) {
    const next = editingContent.trim();

    if (!message.id || !next || !onEditMessage) {
      return;
    }

    setIsSavingEdit(true);
    try {
      await onEditMessage(message.id, next);
      setEditingId(null);
      setEditingContent("");
    } finally {
      setIsSavingEdit(false);
    }
  }

  return (
    <section
      className={cn(
        "surface-panel conversation-panel flex min-h-[420px] flex-col overflow-hidden",
        className,
      )}
    >
      <div className="border-b border-border px-4 py-3 max-sm:px-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow">历史对话</p>
            <h3 className="mt-1 truncate text-base font-medium">
              继续描述，持续修改
            </h3>
          </div>
          {canClearMessages ? (
            <button
              type="button"
              className="tool-button h-9 w-9 shrink-0 px-0 text-text-muted"
              onClick={onClearMessages}
              aria-label="清空聊天记录"
              title="清空聊天记录"
            >
              <Trash2 className="h-4 w-4 stroke-[1.5]" />
            </button>
          ) : null}
        </div>
        {taskStatus && taskStatus !== "idle" ? (
          <div className="mt-3 space-y-2">
            <p className="break-words text-xs text-text-muted">
              当前任务：{STATUS_LABEL[taskStatus]}
              {duration ? ` · 耗时 ${duration}` : ""}
              {taskMeta?.provider || taskMeta?.providerChannelName
                ? taskStatus === "pending" || taskStatus === "running"
                  ? ` · ${
                      taskMeta?.providerChannelName
                        ? `${taskMeta.providerChannelName} · `
                        : ""
                    }${taskMeta?.provider ?? "当前通道"}正在给你生成`
                  : ` · 通道 ${
                      taskMeta?.providerChannelName
                        ? `${taskMeta.providerChannelName}${
                            taskMeta.provider ? ` · ${taskMeta.provider}` : ""
                          }`
                        : taskMeta.provider
                    }`
                : ""}
            </p>
            {showProgress ? (
              <ProgressIndicator
                label={
                  taskStatus === "succeeded"
                    ? "生成完成"
                    : taskStatus === "pending"
                      ? "等待队列"
                      : "正在生成"
                }
                progress={progress ?? (taskStatus === "succeeded" ? 100 : 0)}
              />
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto scroll-smooth p-4 pb-5 max-lg:max-h-[min(48vh,420px)] max-sm:p-3 lg:max-h-none">
        {messages.map((message) => {
          const isUser = message.role === "user";
          const isEditing = editingId === message.id;
          const canOperate = Boolean(
            isUser && message.id && message.id !== "welcome",
          );

          return (
            <div
              key={message.id}
              className={cn(
                "group flex gap-2.5",
                isUser ? "justify-end" : "justify-start",
              )}
            >
              {!isUser ? (
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2 text-text-muted">
                  <Bot className="h-4 w-4 stroke-[1.5]" />
                </div>
              ) : null}
              <div
                className={cn(
                  "flex max-w-[86%] flex-col max-sm:max-w-[90%]",
                  isUser ? "items-end" : "items-start",
                )}
              >
                {isEditing ? (
                  <div className="w-[min(520px,86vw)] rounded-[8px] border border-border-strong bg-surface-2 p-2">
                    <textarea
                      value={editingContent}
                      onChange={(event) => setEditingContent(event.target.value)}
                      className="min-h-24 w-full resize-y bg-transparent text-sm leading-6 outline-none"
                      maxLength={4000}
                    />
                    <div className="mt-2 flex justify-end gap-2">
                      <button
                        type="button"
                        className="tool-button h-8 w-8 px-0 text-text-muted"
                        aria-label="取消编辑"
                        title="取消编辑"
                        onClick={() => {
                          setEditingId(null);
                          setEditingContent("");
                        }}
                      >
                        <X className="h-3.5 w-3.5 stroke-[1.5]" />
                      </button>
                      <button
                        type="button"
                        className="tool-button h-8 w-8 px-0 text-text-muted"
                        aria-label="保存编辑"
                        title="保存编辑"
                        disabled={isSavingEdit || !editingContent.trim()}
                        onClick={() => void saveEdit(message)}
                      >
                        <Check className="h-3.5 w-3.5 stroke-[1.5]" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    className={cn(
                      "whitespace-pre-wrap break-words rounded-[8px] border px-3.5 py-2.5 text-sm leading-6",
                      isUser
                        ? "border-border-strong bg-foreground text-background"
                        : "border-border bg-surface-2/65 text-foreground",
                    )}
                  >
                    {message.content}
                  </div>
                )}
                {message.createdAt || canOperate ? (
                  <div
                    className={cn(
                      "mt-1 flex flex-wrap items-center gap-1 text-[11px] text-text-faint",
                      isUser ? "justify-end" : "justify-start",
                    )}
                  >
                    {message.createdAt ? (
                      <span>{formatMessageTime(message.createdAt)}</span>
                    ) : null}
                    {canOperate ? (
                      <>
                        <button
                          type="button"
                          className="ml-1 rounded-[5px] border border-transparent p-1 transition-colors hover:border-border hover:text-foreground"
                          aria-label="复制旧内容"
                          title="复制"
                          onClick={() => void copyMessage(message)}
                        >
                          {copiedId === message.id ? (
                            <Check className="h-3.5 w-3.5 stroke-[1.5]" />
                          ) : (
                            <Copy className="h-3.5 w-3.5 stroke-[1.5]" />
                          )}
                        </button>
                        <button
                          type="button"
                          className="rounded-[5px] border border-transparent p-1 transition-colors hover:border-border hover:text-foreground"
                          aria-label="复用旧内容"
                          title="填入输入框"
                          onClick={() => onReuseMessage?.(message.content)}
                        >
                          <RotateCcw className="h-3.5 w-3.5 stroke-[1.5]" />
                        </button>
                        <button
                          type="button"
                          className="rounded-[5px] border border-transparent p-1 transition-colors hover:border-border hover:text-foreground"
                          aria-label="编辑旧内容"
                          title="编辑"
                          onClick={() => {
                            setEditingId(message.id ?? null);
                            setEditingContent(message.content);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5 stroke-[1.5]" />
                        </button>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
        <div ref={scrollAnchorRef} aria-hidden="true" />
      </div>
      {footer ? (
        <div className="sticky bottom-0 z-10 border-t border-border bg-surface/95 p-3 backdrop-blur">
          {footer}
        </div>
      ) : null}
    </section>
  );
}
