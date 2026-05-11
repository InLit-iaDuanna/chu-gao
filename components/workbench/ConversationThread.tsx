"use client";

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { Bot, Trash2 } from "lucide-react";

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

export function ConversationThread({
  className,
  messages,
  taskStatus,
  progress,
  footer,
  onClearMessages,
  canClearMessages,
}: {
  className?: string;
  messages: ConversationMessage[];
  taskStatus?: WorkbenchTaskStatus;
  progress?: number;
  footer?: ReactNode;
  onClearMessages?: () => void;
  canClearMessages?: boolean;
}) {
  const lastMessageContent = messages.at(-1)?.content;
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);
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
            <p className="eyebrow">对话</p>
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

          return (
            <div
              key={message.id}
              className={cn(
                "flex gap-2.5",
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
                  "max-w-[86%] whitespace-pre-wrap break-words rounded-[8px] border px-3.5 py-2.5 text-sm leading-6 max-sm:max-w-[90%]",
                  isUser
                    ? "border-border-strong bg-foreground text-background"
                    : "border-border bg-surface-2/65 text-foreground",
                )}
              >
                {message.content}
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
