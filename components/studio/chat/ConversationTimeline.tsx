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
import { ReferenceThumbnails } from "../ReferenceDropZone";
import { chatThumbnail } from "../lib/reference-input";
import type { SubmittedChatMessage } from "../lib/chat-turn-view";
import type { Conversation, Generation, ModelInfo } from "../lib/types";
import { messageGeneration } from "./message-generation";
import { AssistantContent } from "./AssistantContent";
import type { QuickReplyHandler } from "./InteractiveBlocks";
import { stripInteractiveBlocks } from "../lib/chat-interactive-blocks";
import { TurnXiie, XiieSlot } from "./TurnXiie";
import type { XiiePose } from "./Xiie";
import { isListenSilence } from "@/lib/chat-conversation-mode";
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
  pending: SubmittedChatMessage | null;
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
  /** Sends an option from an assistant ask card or quick reply as a user message. */
  onQuickReply?: QuickReplyHandler;
  /** Opens a chat deck in the side panel. */
  onOpenDeck?: (id: string) => void;
  /**
   * 对谈 / 倖听: Xiie alone shows the work, without the step trail and timer,
   * and a listen-mode silence leaves no reply behind.
   */
  compact?: boolean;
  /** 倖听: lines the user has said that are not sent to the model yet. */
  listenQueue?: string[];
  /** 倖听: Xiie's pose at the foot of the conversation, if any. */
  listenPose?: XiiePose | null;
}

function UserContent({ message }: { message: SubmittedChatMessage }) {
  return (
    <>
      {message.chatReferences?.length ? (
        <ReferenceThumbnails
          references={message.chatReferences.map(chatThumbnail)}
        />
      ) : null}
      <p className="select-text whitespace-pre-wrap break-words text-base leading-7 [overflow-wrap:anywhere]">
        {message.content}
      </p>
    </>
  );
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
          className="mt-4 flex min-w-0 flex-col gap-1 text-xs leading-5 text-text-muted"
        >
          {sources.map((source, index) => (
            <a
              key={source.url}
              href={source.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              referrerPolicy="no-referrer"
              className="max-w-full break-words underline decoration-[rgb(var(--border-strong))] underline-offset-[3px] [overflow-wrap:anywhere] hover:text-foreground hover:decoration-current"
            >
              {index + 1}. {source.title}
            </a>
          ))}
        </nav>
      ) : null}
      {usage ? (
        <details className="mt-3 font-mono text-[11px] leading-5 text-text-faint">
          <summary className="cursor-pointer hover:text-text-muted">
            用量
          </summary>
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
  onQuickReply,
  onOpenDeck,
  compact = false,
  listenQueue = [],
  listenPose = null,
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
  const messages = conversation?.messages ?? [];
  const latestAssistantId = messages
    .filter((message) => message.role === "assistant")
    .at(-1)?.id;
  // Ask cards and quick replies only accept clicks when nothing is in flight.
  const turnInFlight =
    disabled ||
    pending !== null ||
    streaming !== null ||
    messages.some((message) =>
      ["queued", "running"].includes(message.chatStatus ?? ""),
    );
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
  }, [
    conversation?.messages,
    pending,
    streaming,
    status,
    generations,
    listenQueue.length,
    listenPose,
  ]);

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        role="log"
        aria-label="创作对话"
        aria-live="polite"
        className="h-full overflow-y-auto overscroll-contain px-3 py-6 [scrollbar-gutter:stable_both-edges] md:px-6 lg:px-8"
        onScroll={(event) => {
          const el = event.currentTarget;
          following.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 100;
          setShowBottom(!following.current);
        }}
      >
        <div className="mx-auto w-full max-w-[46rem] space-y-9 pb-3">
          {messages.map((message, index) => {
            const isUser = message.role === "user";
            const nextMessage = messages[index + 1];
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
            // A listen-mode silence: Xiie at the foot already says "listening".
            if (
              compact &&
              !isUser &&
              !active &&
              !generation &&
              message.chatStatus === "completed" &&
              isListenSilence(message.content)
            )
              return null;
            return (
              <article
                key={
                  message.chatTurnId
                    ? `${message.role}:${message.chatTurnId}:${isUser ? "user" : (message.chatAttemptId ?? message.id)}`
                    : message.id
                }
                aria-label={isUser ? "你的消息" : "助手回复"}
                className={cn(
                  "studio-turn flex min-w-0 flex-col",
                  isUser ? "items-end" : "items-start",
                )}
              >
                <div
                  className={cn(
                    "min-w-0",
                    isUser
                      ? "studio-message max-w-[90%] px-4 py-2.5 sm:max-w-[75%]"
                      : "w-full",
                  )}
                >
                  {isUser ? (
                    <UserContent message={message} />
                  ) : !generation || Boolean(message.chatTurnId) ? (
                    <>
                      {compact ? null : <ActivityTrail
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
                      />}
                      {active && !compact ? (
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
                            interactive={
                              message.id === latestAssistantId && !turnInFlight
                            }
                            answer={
                              nextMessage?.role === "user"
                                ? nextMessage.content
                                : undefined
                            }
                            onQuickReply={onQuickReply}
                            idle={!turnInFlight}
                            onOpenDeck={onOpenDeck}
                          />
                          <ReplyMetadata message={message} />
                        </ResultBubble>
                      ) : (
                        <ReplyMetadata message={message} />
                      )}
                      {message.chatTurnId && compact ? (
                        <XiieSlot
                          pose={
                            active
                              ? message.content
                                ? "idea"
                                : "thinking"
                              : null
                          }
                        />
                      ) : message.chatTurnId ? (
                        <TurnXiie
                          active={active}
                          status={message.chatStatus}
                          activity={message.chatActivity}
                          hasText={Boolean(message.content)}
                          connection={
                            message.chatTurnId === managedTurnId
                              ? connection
                              : undefined
                          }
                          latest={message.id === latestChatMessageId}
                        />
                      ) : null}
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
                      <p className="mb-2 mt-4 text-xs text-text-faint">
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
                </div>
                <div
                  className={cn(
                    "studio-turn-actions mt-1 flex flex-wrap items-center gap-0.5",
                    !isUser && "-ml-2 w-full",
                  )}
                >
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
                      className="h-8 w-8 text-text-muted"
                    >
                      <RotateCcw size={15} />
                    </IconButton>
                  ) : null}
                  <CopyTextButton
                    text={
                      generation?.prompt ??
                      (isUser
                        ? message.content
                        : stripInteractiveBlocks(message.content))
                    }
                    label={generation ? "复制提示词" : "复制消息"}
                  />
                  <IconButton
                    variant="ghost"
                    aria-label={isUser ? "重新编辑消息" : "使用提示词"}
                    title={isUser ? "重新编辑消息" : "使用提示词"}
                    disabled={disabled}
                    onClick={() =>
                      onEdit(
                        generation?.prompt ??
                          (isUser
                            ? message.content
                            : stripInteractiveBlocks(message.content)),
                      )
                    }
                    className="h-8 w-8 text-text-muted"
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
              </article>
            );
          })}
          {pending ? (
            <article aria-label="正在发送的消息" className="flex justify-end">
              <div className="studio-message min-w-0 max-w-[90%] px-4 py-2.5 sm:max-w-[75%]">
                <UserContent message={pending} />
              </div>
            </article>
          ) : null}
          {listenQueue.map((line, index) => (
            <article
              key={`listen:${index}:${line}`}
              aria-label="你的消息（等待一起发送）"
              className="flex justify-end"
            >
              <div className="studio-message min-w-0 max-w-[90%] px-4 py-2.5 opacity-80 sm:max-w-[75%]">
                <UserContent message={{ content: line }} />
              </div>
            </article>
          ))}
          {listenPose ? (
            <div aria-label="正在听" role="status">
              <XiieSlot pose={listenPose} />
            </div>
          ) : null}
          {!managedTurnId && (streaming !== null || status) ? (
            <article
              aria-label="正在回复"
              className="min-w-0 text-base leading-7"
            >
              {compact ? (
                streaming ? (
                  <ResultBubble streaming>
                    <AssistantContent
                      content={streaming}
                      streaming
                      messageStatus="running"
                      onOpenArtifact={onOpenArtifact}
                    />
                  </ResultBubble>
                ) : null
              ) : streaming ? (
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
              <XiieSlot pose={streaming ? "coding" : "thinking"} />
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
          className="absolute bottom-3 left-1/2 h-8 w-8 -translate-x-1/2 rounded-full border border-border bg-surface shadow-[0_2px_8px_rgb(0_0_0/0.08)]"
        >
          <ArrowDown size={17} />
        </IconButton>
      ) : null}
    </div>
  );
}
