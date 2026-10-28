"use client";

/**
 * ConversationTimelineV8 — 横排轮次 + scroll-snap proximity
 *
 * 整体纵向滚动；每一轮 = 横向行（序号 | 用户 | 助手）。
 * 长轮自动填满视口高度，proximity snap 提供磁吸停靠感。
 * 助手侧文字内容超过 2 段时自动进入双栏排版。
 */

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ImagePlus, Loader2, RotateCcw, SquarePen } from "lucide-react";
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
import styles from "./ConversationTimelineV8.module.css";

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

/* ─── 图片编号系统 ────────────────────────────────────── */
interface Turn {
  userMsg: ConversationMessage;
  asstMsg: ConversationMessage | null;
  /** 本轮助手消息对应的全局图片起始索引（1-based） */
  imageIndex: number;
}

function groupIntoTurns(
  messages: ConversationMessage[],
  generations: Record<string, Generation>,
): Turn[] {
  const turns: Turn[] = [];
  let globalImageCount = 0;

  let i = 0;
  while (i < messages.length) {
    const msg = messages[i];
    if (msg.role !== "user") { i++; continue; }

    const userMsg = msg;
    const asstMsg = messages[i + 1]?.role === "assistant" ? messages[i + 1] : null;

    // 统计本轮之前已有多少图片
    const imagesBefore = globalImageCount;
    if (asstMsg?.generationId) {
      const gen = generations[asstMsg.generationId];
      if (gen?.images.length) globalImageCount += gen.images.length;
      else if (asstMsg.generationId) globalImageCount += 1; // 占位
    }

    turns.push({ userMsg, asstMsg, imageIndex: imagesBefore + 1 });
    i += asstMsg ? 2 : 1;
  }
  return turns;
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

/* ─── 渲染回执（保留原有逻辑） ──────────────────────────── */
const renderedAttempts = new Set<string>();
function TextRenderReceipt({ message }: { message: ConversationMessage }) {
  const { chatTurnId, chatAttemptId } = message;
  const hasText = Boolean(message.content);
  useEffect(() => {
    if (!hasText || !chatTurnId || !chatAttemptId || renderedAttempts.has(chatAttemptId)) return;
    let frame = 0;
    let disposed = false;
    const schedule = () => {
      if (disposed || document.visibilityState === "hidden" || frame) return;
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          frame = 0;
          if (disposed || document.visibilityState === "hidden" || renderedAttempts.has(chatAttemptId)) return;
          renderedAttempts.add(chatAttemptId);
          if (renderedAttempts.size > 2000) renderedAttempts.delete(renderedAttempts.values().next().value!);
          void request(`/api/chat/turns/${encodeURIComponent(chatTurnId)}/rendered`, {
            method: "POST",
            body: JSON.stringify({ expectedAttemptId: chatAttemptId, renderedAt: new Date().toISOString() }),
          }).catch(() => undefined);
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

/* ─── 来源 & 用量 ─────────────────────────────────────── */
function ReplyMetadata({ message }: { message: ConversationMessage }) {
  const seen = new Set<string>();
  const sources = (message.chatSources ?? []).flatMap((item) => {
    try {
      if (!item || typeof item.url !== "string") return [];
      const url = new URL(item.url);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || seen.has(url.href)) return [];
      seen.add(url.href);
      return [{ url: url.href, title: typeof item.title === "string" && item.title.trim() ? item.title.trim() : url.hostname }];
    } catch { return []; }
  });
  const usage = message.chatUsage;
  const inputDetails = usage?.input_tokens_details as Record<string, unknown> | undefined;
  const tokens = (name: string) =>
    typeof usage?.[name] === "number" ? (usage[name] as number).toLocaleString() : "未报告";
  return (
    <>
      {sources.length ? (
        <nav aria-label="回复来源" className="mt-3 flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-xs leading-5 text-text-muted">
          {sources.map((source, index) => (
            <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer nofollow" referrerPolicy="no-referrer"
              className="max-w-full break-words underline underline-offset-2 [overflow-wrap:anywhere]">
              {index + 1}. {source.title}
            </a>
          ))}
        </nav>
      ) : null}
      {usage ? (
        <details className="mt-2 text-xs leading-5 text-text-muted">
          <summary className="cursor-pointer">用量</summary>
          <p>输入 {tokens("input_tokens")} · 输出 {tokens("output_tokens")}</p>
          <p>
            缓存命中{" "}
            {typeof inputDetails?.cached_tokens === "number" ? inputDetails.cached_tokens.toLocaleString() : "未报告"}
            {" · "}缓存写入{" "}
            {typeof inputDetails?.cache_write_tokens === "number" ? inputDetails.cache_write_tokens.toLocaleString() : "未报告"}
          </p>
        </details>
      ) : null}
    </>
  );
}

/* ─── 助手内容是否应双栏 ─────────────────────────────── */
function shouldTwoCol(content: string | null | undefined): boolean {
  if (!content) return false;
  // 超过 2 个段落（空行分隔）且文字足够长时启用双栏
  const paras = content.split(/\n\n+/).filter((p) => p.trim().length > 0);
  return paras.length >= 3 && content.length > 300;
}

/* ─── 主组件 ──────────────────────────────────────────── */
export function ConversationTimelineV8({
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const [showBottom, setShowBottom] = useState(false);

  const latestUserTurnId = conversation?.messages
    .filter((m) => m.role === "user")
    .at(-1)?.chatTurnId;
  const latestChatMessageId = conversation?.messages
    .filter((m) => m.role === "assistant" && m.chatTurnId)
    .at(-1)?.id;

  useEffect(() => {
    following.current = true;
    setShowBottom(false);
  }, [conversation?.id]);

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    following.current = true;
    setShowBottom(false);
  };

  useEffect(() => {
    if (following.current && (typeof window === "undefined" || window.getSelection()?.isCollapsed !== false))
      scrollToBottom();
  }, [conversation?.messages, pending, streaming, status, generations]);

  const allMsgs = conversation?.messages ?? [];
  const turns = groupIntoTurns(allMsgs, generations);

  // 全局图片计数（用于 pending / streaming 行）
  let totalImages = 0;
  allMsgs.forEach((m) => {
    if (m.role === "assistant" && m.generationId) {
      const gen = generations[m.generationId];
      totalImages += gen?.images.length ? gen.images.length : 1;
    }
  });

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        role="log"
        aria-label="创作对话"
        aria-live="polite"
        className={styles.timeline}
        onScroll={(event) => {
          const el = event.currentTarget;
          following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
          setShowBottom(!following.current);
        }}
      >
        {turns.map((turn, turnIndex) => {
          const { userMsg, asstMsg, imageIndex } = turn;
          const active = asstMsg ? ["queued", "running"].includes(asstMsg.chatStatus ?? "") : false;
          const partial = Boolean(asstMsg?.chatStatus && !["completed", "queued", "running"].includes(asstMsg.chatStatus));
          const generation = asstMsg?.generationId
            ? (generations[asstMsg.generationId] ?? messageGeneration(asstMsg, conversation!.id))
            : null;
          const modelName = generation
            ? (models.find((m) => m.id === generation.modelId)?.displayName ?? "图片生成")
            : null;
          const twoCol = shouldTwoCol(asstMsg?.content);
          // 短内容不强制撑满屏幕
          const isShort = !asstMsg?.content || asstMsg.content.length < 80;

          return (
            <article
              key={
                userMsg.chatTurnId
                  ? `turn:${userMsg.chatTurnId}`
                  : `turn:${turnIndex}`
              }
              aria-label={`第 ${turnIndex + 1} 轮对话`}
              className={cn(styles.turn, isShort && styles.turnShort)}
              style={{ animationDelay: `${Math.min(turnIndex * 0.06, 0.3)}s` }}
            >
              {/* 序号 */}
              <span className={styles.num} aria-hidden>
                {String(turnIndex + 1).padStart(2, "0")}
              </span>

              {/* 用户侧 */}
              <div className={styles.userCol}>
                <div className={styles.userLabel} aria-hidden>你</div>
                <p className={styles.userText}>{userMsg.content}</p>
              </div>

              {/* 助手侧 */}
              <div className={styles.asstCol}>
                <div className={styles.asstId}>
                  <span className={styles.asstDot} />
                  Chūgǎo
                  {generation ? (
                    <span className={styles.asstTag}>
                      图{imageIndex}
                      {active ? " · 生成中" : ""}
                    </span>
                  ) : null}
                </div>

                {/* 生成中状态 */}
                {active && !generation ? (
                  <div role="status" className={styles.statusRow}>
                    <span className="flex items-center gap-2">
                      <Loader2
                        size={13}
                        className={connection === "disconnected" ? "shrink-0" : "shrink-0 animate-spin"}
                      />
                      {asstMsg!.chatTurnId === managedTurnId && connection !== "connected"
                        ? connection === "reconnecting"
                          ? "连接恢复中…"
                          : "连接暂未恢复"
                        : asstMsg!.chatTurnId === managedTurnId && status
                          ? status
                          : chatActivityText({
                              activity: asstMsg!.chatActivity,
                              searched: asstMsg!.chatSearched,
                              status: asstMsg!.chatStatus!,
                              text: asstMsg!.content,
                            })}
                    </span>
                    <WaitingTime
                      since={asstMsg!.chatStartedAt ?? asstMsg!.createdAt}
                      hasText={Boolean(asstMsg!.content)}
                    />
                  </div>
                ) : null}

                {/* 文字回复 */}
                {asstMsg?.content && !generation ? (
                  <div className={twoCol ? styles.twoColWrap : undefined}>
                    <AssistantContent
                      content={asstMsg.content}
                      streaming={active}
                      messageStatus={asstMsg.chatStatus ?? "completed"}
                    />
                  </div>
                ) : null}

                {asstMsg ? <ReplyMetadata message={asstMsg} /> : null}
                {asstMsg ? <TextRenderReceipt message={asstMsg} /> : null}

                {partial ? (
                  <p role="status" className="mt-3 text-xs leading-5 text-text-muted">
                    {asstMsg!.chatError ?? "回复未完成，已保留收到的内容，本轮未收费"}
                  </p>
                ) : null}

                {/* 图片生成卡 */}
                {generation ? (
                  <div className="max-w-[320px]">
                    {modelName ? (
                      <p className="mb-1.5 text-xs font-medium text-text-muted">{modelName}</p>
                    ) : null}
                    <GenerationCard
                      generation={generation}
                      variant="conversation"
                      onOpen={onOpen}
                      onCancel={onCancel}
                      onRetry={onRetry}
                      onUseAsReference={onReference}
                    />
                  </div>
                ) : null}

                {/* 操作按钮 */}
                <div className={styles.acts}>
                  {partial && asstMsg!.chatTurnId === latestUserTurnId && asstMsg!.id === latestChatMessageId && asstMsg!.chatAttemptId && onRetryChat ? (
                    <IconButton
                      variant="ghost"
                      aria-label="重新生成回复"
                      title="重新生成回复"
                      disabled={disabled}
                      onClick={() => onRetryChat(asstMsg!.chatTurnId!, asstMsg!.chatAttemptId!)}
                      className="h-9 w-9 text-text-muted"
                    >
                      <RotateCcw size={14} />
                    </IconButton>
                  ) : null}
                  <CopyTextButton
                    text={generation?.prompt ?? asstMsg?.content ?? userMsg.content}
                    label={generation ? "复制提示词" : "复制消息"}
                  />
                  <IconButton
                    variant="ghost"
                    aria-label={asstMsg ? "使用提示词" : "重新编辑消息"}
                    title={asstMsg ? "使用提示词" : "重新编辑消息"}
                    disabled={disabled}
                    onClick={() => onEdit(generation?.prompt ?? asstMsg?.content ?? userMsg.content)}
                    className="h-9 w-9 text-text-muted"
                  >
                    <SquarePen size={14} />
                  </IconButton>
                  {generation?.images.length ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={disabled}
                      onClick={() => onReference(generation)}
                      className="gap-1.5 text-xs text-text-muted"
                    >
                      <ImagePlus size={14} />
                      继续修改
                    </Button>
                  ) : null}
                </div>
              </div>
            </article>
          );
        })}

        {/* pending 消息（发出但还没进对话） */}
        {pending ? (
          <article
            aria-label="正在发送的消息"
            className={cn(styles.turn, styles.turnShort)}
          >
            <span className={styles.num} aria-hidden>
              {String(turns.length + 1).padStart(2, "0")}
            </span>
            <div className={styles.userCol}>
              <div className={styles.userLabel} aria-hidden>你</div>
              <p className={styles.userText}>{pending}</p>
            </div>
            <div className={styles.asstCol}>
              <div className={styles.asstId}>
                <span className={styles.asstDot} />
                Chūgǎo
              </div>
              <p className="flex items-center gap-2 text-sm text-text-muted">
                <Loader2 size={14} className="animate-spin" />
                正在等待模型响应…
              </p>
            </div>
          </article>
        ) : null}

        {/* 无 managedTurnId 时的流式回复行 */}
        {!managedTurnId && (streaming !== null || status) ? (
          <article
            aria-label="正在回复"
            className={cn(styles.turn, styles.turnShort)}
          >
            <span className={styles.num} aria-hidden>
              {String(turns.length + (pending ? 2 : 1)).padStart(2, "0")}
            </span>
            <div className={styles.userCol}>
              <div className={styles.userLabel} aria-hidden>你</div>
            </div>
            <div className={styles.asstCol}>
              <div className={styles.asstId}>
                <span className={styles.asstDot} />
                Chūgǎo
              </div>
              {streaming ? (
                <>
                  <p role="status" className="mb-3 text-xs text-text-muted">
                    {status ?? "正在生成回复…"}
                  </p>
                  <AssistantContent
                    content={streaming}
                    streaming
                    messageStatus="running"
                  />
                </>
              ) : (
                <p className="flex items-center gap-2 text-sm text-text-muted">
                  <Loader2 size={14} className="animate-spin" />
                  {status ?? "正在等待模型响应…"}
                </p>
              )}
            </div>
          </article>
        ) : null}
      </div>

      {showBottom ? (
        <IconButton
          variant="secondary"
          aria-label="回到最新消息"
          title="回到最新消息"
          onClick={scrollToBottom}
          className={cn(
            styles.scrollBtn,
            "h-10 w-10 rounded-full border border-border bg-surface shadow-sm",
          )}
        >
          <ArrowDown size={17} />
        </IconButton>
      ) : null}
    </div>
  );
}
