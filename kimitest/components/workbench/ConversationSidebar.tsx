"use client";

import { MessageSquarePlus, Trash2, X } from "lucide-react";

import type { ConversationSummaryView } from "@/lib/conversation";
import { cn } from "@/lib/utils";

interface ConversationSidebarProps {
  conversations: ConversationSummaryView[];
  activeId: string | null;
  open: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onArchive: (id: string) => void;
}

export function ConversationSidebar({
  conversations,
  activeId,
  open,
  onClose,
  onSelect,
  onNew,
  onArchive,
}: ConversationSidebarProps): React.ReactElement {
  const list = (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between px-3 py-3">
        <span className="text-[13px] font-medium text-foreground">历史对话</span>
        <button
          type="button"
          onClick={onNew}
          className="flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
          aria-label="新建对话"
          title="新建对话"
        >
          <MessageSquarePlus size={14} strokeWidth={1.5} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {conversations.length === 0 ? (
          <p className="px-2 py-4 text-[12px] leading-5 text-text-faint">
            还没有历史对话。发送第一条消息后会自动保存。
          </p>
        ) : (
          conversations.map((conversation) => (
            <div
              key={conversation.id}
              role="button"
              tabIndex={0}
              className={cn(
                "group flex cursor-pointer items-start gap-2 rounded-lg px-2.5 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/60",
                conversation.id === activeId
                  ? "bg-foreground/[0.06] text-foreground"
                  : "text-text-muted hover:bg-surface-2 hover:text-foreground",
              )}
              onClick={() => onSelect(conversation.id)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(conversation.id);
                }
              }}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-medium">
                  {conversation.title}
                </p>
                {conversation.latestMessage ? (
                  <p className="mt-0.5 line-clamp-1 text-[11px] opacity-70">
                    {conversation.latestMessage}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onArchive(conversation.id);
                }}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-faint opacity-0 transition-all hover:bg-surface hover:text-foreground group-hover:opacity-100"
                aria-label="归档对话"
              >
                <Trash2 size={11} strokeWidth={1.5} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* 桌面：常驻左栏 */}
      <aside className="hidden w-60 shrink-0 overflow-hidden rounded-2xl border border-border bg-surface/60 md:flex md:flex-col">
        {list}
      </aside>

      {/* 移动：抽屉 */}
      {open ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-background/50"
            onClick={onClose}
            aria-hidden
          />
          <aside className="absolute left-0 top-0 h-full w-[78%] max-w-[300px] border-r border-ink/[0.08] bg-surface/85 shadow-[var(--shadow-lg)]">
            <div className="flex items-center justify-end px-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-surface-2 hover:text-foreground"
                aria-label="关闭"
              >
                <X size={14} strokeWidth={1.5} />
              </button>
            </div>
            {list}
          </aside>
        </div>
      ) : null}
    </>
  );
}
