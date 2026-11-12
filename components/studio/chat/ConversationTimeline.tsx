"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
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
import {
  ActivityTrail,
  chatUsageBreakdown,
  ResultBubble,
  TurnCredits,
  NO_CREDIT_CHARGE,
} from "./ChatReplyBubbles";
import {
  chatReplyErrorMessage,
  readCreditSettlement,
} from "@/lib/turn-credit-types";
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
  onOpenArtifact?: (source: string) => void;
  onRetry: (generation: Generation) => void;
  onCancel: (id: string) => void;
  onRetryChat?: (id: string, expectedPreviousAttemptId: string) => void;
}

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
  const breakdown = chatUsageBreakdown(usage);
  const tokens = (value: number | null) =>
    value === null ? "未报告" : value.toLocaleString();
  return (
    <>
      {sources.length ? (
        <nav
          aria-label="回复来源"
          className="mt-3 flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-xs leading-5 text-text-muted"
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
            输入 {tokens(breakdown.inputTotal)} · 输出{" "}
            {tokens(breakdown.output)}
          </p>
          <p>
            输入总量 {tokens(breakdown.inputTotal)} · 输出{" "}
            {tokens(breakdown.output)}
          </p>
          <p>
            未缓存输入 {tokens(breakdown.uncachedInput)} · 缓存读取{" "}
            {tokens(breakdown.cacheRead)}
          </p>
          <p>缓存创建 {tokens(breakdown.cacheCreation)}</p>
        </details>
      ) : null}
    </>
  );
}

export function ConversationTimeline({
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
  onOpenArtifact,
  onRetry,
  onCancel,
  onRetryChat,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const [showBottom, setShowBottom] = useState(false);
  const latestUserTurnId = conversation?.messages
    .filter((message) => message.role === "user")
    .at(-1)?.chatTurnId;
  const latestChatMessageId = conversation?.messages
    .filter((message) => message.role === "assistant" && message.chatTurnId)
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
    if (
      following.current &&
      (typeof window === "undefined" ||
        window.getSelection()?.isCollapsed !== false)
    )
      scrollToBottom();
  }, [conversation?.messages, pending, streaming, status, generations]);

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        role="log"
        aria-label="创作对话"
        aria-live="polite"
        className="h-full overflow-y-auto overscroll-contain px-3 py-6 md:px-6 lg:px-8"
        onScroll={(event) => {
          const el = event.currentTarget;
          following.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 100;
          setShowBottom(!following.current);
        }}
      >
        <div className="mx-auto w-full max-w-[52rem] space-y-8 pb-3">
          {(conversation?.messages ?? []).map((message) => {
            const isUser = message.role === "user";
            const active =
              !isUser &&
              ["queued", "running"].includes(message.chatStatus ?? "");
            const partial = Boolean(
              message.chatStatus &&
              !["completed", "queued", "running"].includes(message.chatStatus),
            );
            const generation =
              !isUser && message.generationId
                ? (generations[message.generationId] ??
                  messageGeneration(message, conversation!.id))
                : null;
            return (
              <article
                key={
                  message.chatTurnId
                    ? `${message.role}:${message.chatTurnId}:${isUser ? "user" : (message.chatAttemptId ?? message.id)}`
                    : message.id
                }
                aria-label={isUser ? "你的消息" : "助手回复"}
                className={cn(
                  "flex min-w-0 flex-col",
                  isUser ? "items-end" : "items-start",
                )}
              >
                <div
                  className={cn(
                    "min-w-0",
                    isUser
                      ? "smooth-surface studio-message relative max-w-[90%] rounded-xl border border-border/70 bg-surface px-4 py-3 sm:max-w-[85%]"
                      : "w-full",
                  )}
                >
                  {!isUser ? (
                    <div className="mb-3 flex items-center gap-2 text-xs font-medium text-text-muted">
                      <span className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--studio-highlight))]" />
                      Chūgǎo
                    </div>
                  ) : null}
                  {isUser ? (
                    <p className="select-text whitespace-pre-wrap break-words text-[15px] leading-7 [overflow-wrap:anywhere]">
                      {message.content}
                    </p>
                  ) : !generation || Boolean(message.chatTurnId) ? (
                    <>
                      <ActivityTrail
                        status={message.chatStatus}
                        history={message.chatActivityHistory}
                        current={
                          message.chatActivity ??
                          (active ? "waiting_upstream" : undefined)
                        }
                        active={active}
                        statusOverride={
                          message.chatTurnId === managedTurnId &&
                          connection !== "connected"
                            ? connection === "reconnecting"
                              ? "连接恢复中，任务可能仍在继续…"
                              : "连接暂未恢复，生成状态待确认"
                            : message.chatTurnId === managedTurnId
                              ? (status ??
                                (message.chatSearched && !message.content
                                  ? chatActivityText({
                                      activity: message.chatActivity,
                                      searched: message.chatSearched,
                                      status: message.chatStatus!,
                                      text: message.content,
                                    })
                                  : undefined))
                              : undefined
                        }
                      />
                      {active ? (
                        <div className="mb-3 text-xs text-text-muted">
                          <WaitingTime
                            since={message.chatStartedAt ?? message.createdAt}
                            hasText={Boolean(message.content)}
                          />
                        </div>
                      ) : null}
                      {message.content ? (
                        <ResultBubble streaming={active}>
                          <AssistantContent
                            content={message.content}
                            streaming={active}
                            messageStatus={message.chatStatus ?? "completed"}
                            onOpenArtifact={onOpenArtifact}
                          />
                          <ReplyMetadata message={message} />
                        </ResultBubble>
                      ) : (
                        <ReplyMetadata message={message} />
                      )}
                      <TextRenderReceipt message={message} />
                      {partial ? (
                        <p
                          role="status"
                          className="mt-3 text-xs leading-5 text-text-muted"
                        >
                          {chatReplyErrorMessage(
                            message.chatError ??
                              "文字回复未完成，已保留收到的内容",
                          )}
                        </p>
                      ) : null}
                    </>
                  ) : null}
                  {generation ? (
                    <>
                      <p className="text-xs font-medium text-text-muted">
                        {models.find((model) => model.id === generation.modelId)
                          ?.displayName ?? "图片生成"}
                      </p>
                      <GenerationCard
                        showCredits={false}
                        generation={generation}
                        variant="conversation"
                        onOpen={onOpen}
                        onCancel={onCancel}
                        onRetry={onRetry}
                        onUseAsReference={onReference}
                      />
                    </>
                  ) : null}
                  {!isUser ? (
                    <TurnCredits
                      chat={
                        message.chatTurnId
                          ? (message.chatBilling ??
                            readCreditSettlement(message.chatUsage?.billing))
                          : generation
                            ? NO_CREDIT_CHARGE
                            : undefined
                      }
                      image={
                        generation
                          ? (generation.billing ?? message.generationBilling)
                          : NO_CREDIT_CHARGE
                      }
                    />
                  ) : null}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-0.5">
                  {partial &&
                  message.chatTurnId === latestUserTurnId &&
                  message.id === latestChatMessageId &&
                  message.chatAttemptId &&
                  onRetryChat ? (
                    <IconButton
                      variant="ghost"
                      aria-label="重新生成回复"
                      title="重新生成回复"
                      disabled={disabled}
                      onClick={() =>
                        onRetryChat(message.chatTurnId!, message.chatAttemptId!)
                      }
                      className="h-9 w-9 text-text-muted"
                    >
                      <RotateCcw size={15} />
                    </IconButton>
                  ) : null}
                  <CopyTextButton
                    text={generation?.prompt ?? message.content}
                    label={generation ? "复制提示词" : "复制消息"}
                  />
                  <IconButton
                    variant="ghost"
                    aria-label={isUser ? "重新编辑消息" : "使用提示词"}
                    title={isUser ? "重新编辑消息" : "使用提示词"}
                    disabled={disabled}
                    onClick={() =>
                      onEdit(generation?.prompt ?? message.content)
                    }
                    className="h-9 w-9 text-text-muted"
                  >
                    <SquarePen size={15} />
                  </IconButton>
                  {generation?.images.length ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={disabled}
                      onClick={() => onReference(generation)}
                      className="gap-1.5 text-xs text-text-muted"
                    >
                      <ImagePlus size={15} />
                      继续修改
                    </Button>
                  ) : null}
                </div>
              </article>
            );
          })}
          {pending ? (
            <article aria-label="正在发送的消息" className="flex justify-end">
              <p className="smooth-surface studio-message relative max-w-[90%] select-text whitespace-pre-wrap break-words rounded-xl border border-border/70 bg-surface px-4 py-3 text-[15px] leading-7 [overflow-wrap:anywhere]">
                {pending}
              </p>
            </article>
          ) : null}
          {!managedTurnId && (streaming !== null || status) ? (
            <article
              aria-label="正在回复"
              className="min-w-0 text-[15px] leading-7"
            >
              {streaming ? (
                <>
                  <ActivityTrail
                    history={[]}
                    current="answering"
                    active
                    statusOverride={status ?? undefined}
                  />
                  <ResultBubble streaming>
                    <AssistantContent
                      content={streaming}
                      streaming
                      messageStatus="running"
                      onOpenArtifact={onOpenArtifact}
                    />
                  </ResultBubble>
                </>
              ) : (
                <p className="flex items-center gap-2 text-sm text-text-muted">
                  <Loader2 size={16} className="animate-spin" />
                  {status ?? "正在等待模型响应…"}
                </p>
              )}
            </article>
          ) : null}
        </div>
      </div>
      {showBottom ? (
        <IconButton
          variant="secondary"
          aria-label="回到最新消息"
          title="回到最新消息"
          onClick={scrollToBottom}
          className="absolute bottom-3 left-1/2 h-10 w-10 -translate-x-1/2 rounded-full border border-border bg-surface shadow-sm"
        >
          <ArrowDown size={17} />
        </IconButton>
      ) : null}
    </div>
  );
}
