"use client";

import { Cloud, Smartphone } from "lucide-react";

import { cn } from "@/lib/utils";
import { AssistantContent } from "./AssistantContent";
import type { Conversation } from "../lib/types";

/**
 * 本机快照的只读视图：服务端工作副本过期（或对话只存在于手机上）时，
 * 用 localUrlMap 替换图片地址后按 role 渲染文本与图片网格。
 */
export function LocalConversationView({
  conversation,
  localOnly = false,
}: {
  conversation: Conversation;
  localOnly?: boolean;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 md:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-[52rem] space-y-7 py-6">
        {localOnly ? (
          <div
            role="status"
            className="flex items-start gap-2 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm leading-6 text-text-muted"
          >
            <Smartphone size={16} className="mt-0.5 shrink-0" />
            <span>
              云端工作副本已过期，仅可在本机查看。完整记录保存在这台手机上。
            </span>
          </div>
        ) : null}
        {conversation.messages.map((message, index) => {
          const images = (message.images ?? []).filter(
            (image) => image.src || image.url,
          );
          return (
            <article
              key={message.id ?? `local-${index}`}
              className="min-w-0 space-y-3"
            >
              {message.role === "user" ? (
                <div className="ml-auto max-w-[85%] whitespace-pre-wrap break-words rounded-2xl bg-[rgb(var(--text)/0.06)] px-4 py-3 text-sm leading-6">
                  {message.content}
                </div>
              ) : message.content.trim() ? (
                <AssistantContent content={message.content} />
              ) : null}
              {images.length ? (
                <div
                  className={cn(
                    "grid gap-2",
                    images.length > 1 ? "grid-cols-2" : "grid-cols-1",
                  )}
                >
                  {images.map((image, imageIndex) => (
                    <div
                      key={image.id ?? `${index}-${imageIndex}`}
                      className="overflow-hidden rounded-xl border border-border bg-surface"
                    >
                      {/* 本机文件（/__local/files/...）由外壳直接读取，不经过 Next 图片优化。 */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={image.src || image.url}
                        alt={message.generationPrompt ?? "对话图片"}
                        loading="lazy"
                        className="h-auto w-full object-cover"
                      />
                    </div>
                  ))}
                </div>
              ) : null}
            </article>
          );
        })}
        {conversation.messages.length ? null : (
          <p className="text-sm text-text-muted">本机快照暂无内容。</p>
        )}
      </div>
    </div>
  );
}

/** 保存位置标识（本机 / 云端）。 */
export function ConversationStorageBadge({
  storage,
  className,
}: {
  storage: "local" | "cloud" | undefined;
  className?: string;
}) {
  const local = storage === "local";
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center gap-1 rounded-full border border-border px-2 text-[11px] text-text-muted",
        className,
      )}
      title={local ? "仅保存在本机" : "已保存在云端"}
    >
      {local ? <Smartphone size={13} /> : <Cloud size={13} />}
      {local ? "本机" : "云端"}
    </span>
  );
}
