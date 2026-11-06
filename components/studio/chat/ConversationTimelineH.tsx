"use client";

/**
 * ConversationTimelineH — 横向滚动版对话时间线
 *
 * 每一"轮"（一条用户消息 + 一条助手回复）渲染成一张竖向 card，
 * 所有 card 在一条水平滚动 rail 上左→右排列。
 * 这样可以充分利用宽屏横向空间，同时让每张 card 保持适中的阅读宽度。
 *
 * 图片编号规则：
 *   – 按消息时间顺序，每张成功生成的图片依次编号 图1、图2…
 *   – 编号作为 aria-label 标注，也在卡片 footer 显示。
 */

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ImagePlus,
  Loader2,
  RotateCcw,
  SquarePen,
} from "lucide-react";
import { Button, IconButton } from "@/components/ui";
import { cn } from "@/lib/utils";
import { CopyTextButton } from "../CopyTextButton";
import { GenerationCard } from "../GenerationCard";
import type { Conversation, Generation, ModelInfo } from "../lib/types";
import { messageGeneration } from "./message-generation";
import { AssistantContent } from "./AssistantContent";
import { chatActivityText } from "../lib/chat-turn-api";
import type { ConversationMessage } from "../lib/types";
import { request } from "../lib/api";

interface Props {
  conversation: Conversation | null;
  generations: Record<string, Generation>;
  models: ModelInfo[];
  pending: string | null;
  streaming: string | null;
  status: string | null;
  managedTurnId?: string | null;
  connection?: "connected" | "reconnecting" | "disconnected";
  disabled: boolean;
  onEdit: (text: string) => void;
  onReference: (generation: Generation) => void;
  onOpen: (generation: Generation, index: number) => void;
  onRetry: (generation: Generation) => void;
  onCancel: (id: string) => void;
  onRetryChat?: (id: string, expectedPreviousAttemptId: string) => void;
}

/* ─── 等待计时器 ──────────────────────────────────────── */
function WaitingTime({ since, hasText }: { since: string; hasText: boolean }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const parsed = Date.parse(since);
  const seconds = Number.isFinite(parsed)
    ? Math.max(0, Math.floor((now - parsed) / 1000))
    : 0;
  return (
    <span className="shrink-0 tabular-nums">
      {hasText ? "已用时" : "已等待"} {seconds} 秒
    </span>
  );
}

/* ─── 渲染回执 ────────────────────────────────────────── */
const renderedAttempts = new Set<string>();
function TextRenderReceipt({ message }: { message: ConversationMessage }) {
  const { chatTurnId, chatAttemptId } = message;
  const hasText = Boolean(message.content);
  useEffect(() => {
    if (
      !hasText ||
      !chatTurnId ||
      !chatAttemptId ||
      renderedAttempts.has(chatAttemptId)
    )
      return;
    let frame = 0;
    let disposed = false;
    const schedule = () => {
      if (disposed || document.visibilityState === "hidden" || frame) return;
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          frame = 0;
          if (
            disposed ||
            document.visibilityState === "hidden" ||
            renderedAttempts.has(chatAttemptId)
          )
            return;
          renderedAttempts.add(chatAttemptId);
          if (renderedAttempts.size > 2000)
            renderedAttempts.delete(renderedAttempts.values().next().value!);
          void request(
            `/api/chat/turns/${encodeURIComponent(chatTurnId)}/rendered`,
            {
              method: "POST",
              body: JSON.stringify({
                expectedAttemptId: chatAttemptId,
                renderedAt: new Date().toISOString(),
              }),
            },
          ).catch(() => undefined);
        });
      });
    };
    schedule();
    document.addEventListener("visibilitychange", schedule);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", schedule);
    };
  }, [chatTurnId, chatAttemptId, hasText]);
  return null;
}

/* ─── 消息来源 / token 用量 ──────────────────────────── */
function ReplyMetadata({ message }: { message: ConversationMessage }) {
  const seen = new Set<string>();
  const sources = (message.chatSources ?? []).flatMap((item) => {
    try {
      if (!item || typeof item.url !== "string") return [];
      const url = new URL(item.url);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        seen.has(url.href)
      )
        return [];
      seen.add(url.href);
      return [
        {
          url: url.href,
          title:
            typeof item.title === "string" && item.title.trim()
              ? item.title.trim()
              : url.hostname,
        },
      ];
    } catch {
      return [];
    }
  });
  const usage = message.chatUsage;
  const inputDetails = usage?.input_tokens_details as
    | Record<string, unknown>
    | undefined;
  const tokens = (name: string) =>
    typeof usage?.[name] === "number"
      ? (usage[name] as number).toLocaleString()
      : "未报告";
  return (
    <>
      {sources.length ? (
        <nav
          aria-label="回复来源"
          className="mt-3 flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-xs leading-5 text-text-muted"
        >
          {sources.map((source, index) => (
            <a
              key={source.url}
              href={source.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              referrerPolicy="no-referrer"
              className="max-w-full break-words underline underline-offset-2 [overflow-wrap:anywhere]"
            >
              {index + 1}. {source.title}
            </a>
          ))}
        </nav>
      ) : null}
      {usage ? (
        <details className="mt-2 text-xs leading-5 text-text-muted">
          <summary className="cursor-pointer">用量</summary>
          <p>
            输入 {tokens("input_tokens")} · 输出 {tokens("output_tokens")}
          </p>
          <p>
            缓存命中{" "}
            {typeof inputDetails?.cached_tokens === "number"
              ? inputDetails.cached_tokens.toLocaleString()
              : "未报告"}
            {" · "}缓存写入{" "}
            {typeof inputDetails?.cache_write_tokens === "number"
              ? inputDetails.cache_write_tokens.toLocaleString()
              : "未报告"}
          </p>
        </details>
      ) : null}
    </>
  );
}

/* ─── 把消息数组分组成「轮次」 ──────────────────────── */
interface Turn {
  id: string;
  userMsg: ConversationMessage | null;
  assistantMsg: ConversationMessage | null;
  /** 该轮中全部已成功生成图片，按时间顺序，带全局图片序号 */
  imageIndex: number; // 该轮第一张图的全局序号（从1起）
}

function groupIntoTurns(messages: ConversationMessage[]): Turn[] {
  const turns: Turn[] = [];
  let i = 0;
  while (i < messages.length) {
    const msg = messages[i];
    if (msg.role === "user") {
      const next = messages[i + 1];
      const assistantMsg =
        next && next.role === "assistant" ? next : null;
      turns.push({
        id: msg.chatTurnId ?? msg.id,
        userMsg: msg,
        assistantMsg,
        imageIndex: 0, // filled below
      });
      i += assistantMsg ? 2 : 1;
    } else {
      // orphan assistant message
      turns.push({
        id: msg.chatTurnId ?? msg.id,
        userMsg: null,
        assistantMsg: msg,
        imageIndex: 0,
      });
      i += 1;
    }
  }
  // assign global image indices
  let imgCount = 1;
  for (const turn of turns) {
    turn.imageIndex = imgCount;
    if (turn.assistantMsg?.generationId) imgCount++;
  }
  return turns;
}

/* ─── 主组件 ─────────────────────────────────────────── */
export function ConversationTimelineH({
  conversation,
  generations,
  models,
  pending,
  streaming,
  status,
  managedTurnId,
  connection = "connected",
  disabled,
  onEdit,
  onReference,
  onOpen,
  onRetry,
  onCancel,
  onRetryChat,
}: Props) {
  const railRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const latestUserTurnId = conversation?.messages
    .filter((m) => m.role === "user")
    .at(-1)?.chatTurnId;
  const latestChatMessageId = conversation?.messages
    .filter((m) => m.role === "assistant" && m.chatTurnId)
    .at(-1)?.id;

  /* 自动滚到末尾 */
  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    el.scrollLeft = el.scrollWidth;
  }, [conversation?.messages, pending, streaming, status, generations]);

  /* 更新左右箭头可见性 */
  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    const update = () => {
      setCanScrollLeft(el.scrollLeft > 8);
      setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 8);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);

  const scroll = (dir: "left" | "right") => {
    const el = railRef.current;
    if (!el) return;
    el.scrollBy({ left: dir === "left" ? -340 : 340, behavior: "smooth" });
  };

  const turns = groupIntoTurns(conversation?.messages ?? []);

  return (
    <div className="timeline-h-root relative flex min-h-0 flex-1 flex-col">
      {/* 左右箭头导航 */}
      {canScrollLeft ? (
        <button
          type="button"
          onClick={() => scroll("left")}
          aria-label="向左滚动"
          className="timeline-h-nav timeline-h-nav-left absolute left-2 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-surface shadow-sm text-text-muted hover:text-foreground transition-opacity"
        >
          <ArrowLeft size={16} />
        </button>
      ) : null}
      {canScrollRight ? (
        <button
          type="button"
          onClick={() => scroll("right")}
          aria-label="向右滚动"
          className="timeline-h-nav timeline-h-nav-right absolute right-2 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-surface shadow-sm text-text-muted hover:text-foreground transition-opacity"
        >
          <ArrowRight size={16} />
        </button>
      ) : null}

      {/* 横向滚动轨道 */}
      <div
        ref={railRef}
        role="log"
        aria-label="创作对话"
        aria-live="polite"
        className="timeline-h-rail flex h-full min-h-0 flex-1 gap-3 overflow-x-auto overflow-y-hidden overscroll-x-contain px-6 py-5 scroll-smooth"
        style={{ scrollbarWidth: "none" }}
      >
        {turns.map((turn) => (
          <TurnCard
            key={turn.id}
            turn={turn}
            generations={generations}
            models={models}
            managedTurnId={managedTurnId ?? null}
            connection={connection}
            status={status}
            streaming={streaming}
            disabled={disabled}
            latestUserTurnId={latestUserTurnId ?? null}
            latestChatMessageId={latestChatMessageId ?? null}
            conversationId={conversation?.id ?? ""}
            onEdit={onEdit}
            onReference={onReference}
            onOpen={onOpen}
            onRetry={onRetry}
            onCancel={onCancel}
            onRetryChat={onRetryChat ?? null}
          />
        ))}

        {/* 正在发送中的临时气泡 */}
        {pending ? (
          <PendingCard pending={pending} streaming={streaming} status={status} />
        ) : null}
      </div>
    </div>
  );
}

/* ─── 正在发送的临时 Card ─────────────────────────────── */
function PendingCard({
  pending,
  streaming,
  status,
}: {
  pending: string;
  streaming: string | null;
  status: string | null;
}) {
  return (
    <div className="timeline-h-card flex w-[320px] shrink-0 flex-col gap-3 rounded-xl border border-border bg-surface px-5 py-4">
      {/* 用户消息 */}
      <div className="rounded-lg border border-border/60 bg-surface-2 px-4 py-3">
        <p className="select-text whitespace-pre-wrap break-words text-[14px] leading-6 text-foreground [overflow-wrap:anywhere]">
          {pending}
        </p>
      </div>
      {/* 助手回复区 */}
      <div className="flex flex-1 flex-col gap-2">
        <div className="mb-1 flex items-center gap-2 text-[11px] font-medium text-text-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--studio-highlight))]" />
          初稿
        </div>
        {streaming ? (
          <AssistantContent
            content={streaming}
            streaming
            messageStatus="running"
          />
        ) : (
          <p className="flex items-center gap-2 text-sm text-text-muted">
            <Loader2 size={14} className="animate-spin" />
            {status ?? "正在等待回复…"}
          </p>
        )}
      </div>
    </div>
  );
}

/* ─── 单轮 Card ───────────────────────────────────────── */
interface TurnCardProps {
  turn: Turn;
  generations: Record<string, Generation>;
  models: ModelInfo[];
  managedTurnId: string | null;
  connection: "connected" | "reconnecting" | "disconnected";
  status: string | null;
  streaming: string | null;
  disabled: boolean;
  latestUserTurnId: string | null;
  latestChatMessageId: string | null;
  conversationId: string;
  onEdit: (text: string) => void;
  onReference: (generation: Generation) => void;
  onOpen: (generation: Generation, index: number) => void;
  onRetry: (generation: Generation) => void;
  onCancel: (id: string) => void;
  onRetryChat: ((id: string, expectedPreviousAttemptId: string) => void) | null;
}

function TurnCard({
  turn,
  generations,
  models,
  managedTurnId,
  connection,
  status,
  streaming: _streaming,
  disabled,
  latestUserTurnId,
  latestChatMessageId,
  onEdit,
  onReference,
  onOpen,
  onRetry,
  onCancel,
  onRetryChat,
}: TurnCardProps) {
  const { userMsg, assistantMsg } = turn;

  const generation =
    assistantMsg && assistantMsg.generationId
      ? (generations[assistantMsg.generationId] ??
        messageGeneration(assistantMsg, turn.id))
      : null;

  const active =
    assistantMsg !== null &&
    ["queued", "running"].includes(assistantMsg.chatStatus ?? "");

  const partial = Boolean(
    assistantMsg?.chatStatus &&
      !["completed", "queued", "running"].includes(assistantMsg.chatStatus),
  );

  /* Card 宽度：有图片时稍宽，纯文字对话稍窄 */
  const cardWidth = generation ? "w-[360px]" : "w-[320px]";

  return (
    <article
      aria-label={`第 ${turn.imageIndex} 轮对话`}
      className={cn(
        "timeline-h-card flex shrink-0 flex-col gap-3 rounded-xl border border-border bg-surface px-5 py-4",
        cardWidth,
      )}
    >
      {/* ── 用户消息 ── */}
      {userMsg ? (
        <div className="group/user relative rounded-lg border border-border/60 bg-surface-2 px-4 py-3">
          <p className="select-text whitespace-pre-wrap break-words text-[14px] leading-6 text-foreground [overflow-wrap:anywhere]">
            {userMsg.content}
          </p>
          <div className="mt-2 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/user:opacity-100">
            <CopyTextButton text={userMsg.content} label="复制" />
            <IconButton
              variant="ghost"
              size="sm"
              aria-label="重新编辑"
              title="重新编辑"
              disabled={disabled}
              onClick={() => onEdit(userMsg.content)}
              className="h-7 w-7 text-text-muted"
            >
              <SquarePen size={13} />
            </IconButton>
          </div>
        </div>
      ) : null}

      {/* ── 助手回复 ── */}
      {assistantMsg ? (
        <div className="flex flex-1 flex-col gap-2">
          {/* 标题行 */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[11px] font-medium text-text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--studio-highlight))]" />
              初稿
              {generation ? (
                <span className="text-text-faint">
                  图{turn.imageIndex}
                </span>
              ) : null}
            </div>
          </div>

          {/* 内容：生图 or 文字 */}
          {generation ? (
            <>
              <p className="text-xs font-medium text-text-muted">
                {models.find((m) => m.id === generation.modelId)?.displayName ??
                  "图片生成"}
              </p>
              <GenerationCard
                generation={generation}
                variant="conversation"
                onOpen={onOpen}
                onCancel={onCancel}
                onRetry={onRetry}
                onUseAsReference={onReference}
              />
            </>
          ) : (
            <>
              {active ? (
                <div
                  role="status"
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-5 text-text-muted"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Loader2
                      size={13}
                      className={
                        connection === "disconnected"
                          ? "shrink-0"
                          : "shrink-0 animate-spin"
                      }
                    />
                    {assistantMsg.chatTurnId === managedTurnId &&
                    connection !== "connected"
                      ? connection === "reconnecting"
                        ? "连接恢复中…"
                        : "连接暂未恢复"
                      : assistantMsg.chatTurnId === managedTurnId && status
                        ? status
                        : chatActivityText({
                            activity: assistantMsg.chatActivity,
                            searched: assistantMsg.chatSearched,
                            status: assistantMsg.chatStatus!,
                            text: assistantMsg.content,
                          })}
                  </span>
                  <WaitingTime
                    since={
                      assistantMsg.chatStartedAt ?? assistantMsg.createdAt
                    }
                    hasText={Boolean(assistantMsg.content)}
                  />
                </div>
              ) : null}
              {assistantMsg.content ? (
                <AssistantContent
                  content={assistantMsg.content}
                  streaming={active}
                  messageStatus={assistantMsg.chatStatus ?? "completed"}
                />
              ) : null}
              <ReplyMetadata message={assistantMsg} />
              <TextRenderReceipt message={assistantMsg} />
              {partial ? (
                <p
                  role="status"
                  className="mt-1 text-xs leading-5 text-text-muted"
                >
                  {assistantMsg.chatError ?? "回复未完成，本轮未收费"}
                </p>
              ) : null}
            </>
          )}

          {/* 操作按钮行 */}
          <div className="mt-auto flex flex-wrap items-center gap-0.5 pt-2">
            {partial &&
            assistantMsg.chatTurnId === latestUserTurnId &&
            assistantMsg.id === latestChatMessageId &&
            assistantMsg.chatAttemptId &&
            onRetryChat ? (
              <IconButton
                variant="ghost"
                size="sm"
                aria-label="重新生成回复"
                title="重新生成回复"
                disabled={disabled}
                onClick={() =>
                  onRetryChat(
                    assistantMsg.chatTurnId!,
                    assistantMsg.chatAttemptId!,
                  )
                }
                className="h-8 w-8 text-text-muted"
              >
                <RotateCcw size={13} />
              </IconButton>
            ) : null}
            <CopyTextButton
              text={generation?.prompt ?? assistantMsg.content}
              label={generation ? "复制提示词" : "复制"}
            />
            <IconButton
              variant="ghost"
              size="sm"
              aria-label={assistantMsg ? "使用提示词" : "重新编辑"}
              title={assistantMsg ? "使用提示词" : "重新编辑"}
              disabled={disabled}
              onClick={() =>
                onEdit(generation?.prompt ?? assistantMsg.content)
              }
              className="h-8 w-8 text-text-muted"
            >
              <SquarePen size={13} />
            </IconButton>
            {generation?.images.length ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() => onReference(generation)}
                className="gap-1 text-xs text-text-muted"
              >
                <ImagePlus size={13} />
                继续修改
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </article>
  );
}
