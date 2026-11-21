"use client";

import { Button, IconButton } from "@/components/ui";

import { Textarea } from "@/components/ui";

import {
  ArrowLeft,
  Loader2,
  MessageSquare,
  ImagePlus,
  SquarePen,
  Plus,
  Send,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useToast } from "@/components/ui";
import { cn, formatDate } from "@/lib/utils";
import { OPUS_MODEL_ID } from "@/lib/chat-model-options";

import {
  compileConversationPrompt,
  createConversation,
  getConversation,
  getConversationPricing,
  getMe,
  listConversations,
  updateConversation,
} from "../lib/api";
import { streamConversationChat } from "../lib/sse";
import { mergeChatTurn } from "../lib/chat-turn-view";
import { readChatReceipt } from "../lib/chat-submission";
import type { ChatTurnView } from "@/lib/chat-turn-types";
import { CHAT_INPUT_MAX_CHARS } from "@/lib/chat-turn-types";
import { readActiveConversationId } from "../lib/active-conversation";
import type { ReferenceItem } from "../CommandDock";
import { ReferenceDropZone, ReferenceThumbnails } from "../ReferenceDropZone";
import { CopyTextButton } from "../CopyTextButton";
import styles from "../chat/ChatControls.module.css";
import {
  referenceRequest,
  REFERENCE_ACCEPT,
  useReferenceInput,
} from "../lib/reference-input";
import {
  conversationDraftSchema,
  useSessionDraft,
} from "../lib/use-session-draft";
import type {
  ChatMessageInput,
  Conversation,
  ConversationPricing,
  ConversationSummary,
  CreateGenerationInput,
  ModelInfo,
} from "../lib/types";

interface ConversationPanelProps {
  model: ModelInfo | null;
  initialThreadId?: string | null;
  onSubmitGeneration: (input: CreateGenerationInput) => Promise<void>;
  onCreditsChange: (balance: number) => void;
  onActiveThreadChange: (id: string | null) => void;
  storageKey?: string;
  onUsePrompt?: (prompt: string) => void;
}

/** 对话线程面板：嵌入停靠区域使用，不再是隐藏抽屉。 */
export function ConversationPanel({
  model,
  initialThreadId = null,
  onSubmitGeneration,
  onCreditsChange,
  onActiveThreadChange,
  storageKey = "anon",
  onUsePrompt,
}: ConversationPanelProps) {
  const { toast } = useToast();
  const [threads, setThreads] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [draft, setDraft] = useState("");
  const [references, setReferences] = useState<ReferenceItem[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [pricing, setPricing] = useState<ConversationPricing | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [creating, setCreating] = useState(false);
  /** 编译完成、等待用户确认的生成预览。 */
  const [pendingGeneration, setPendingGeneration] = useState<{
    prompt: string;
    assistantMessage: string;
  } | null>(null);
  const [submittingPreview, setSubmittingPreview] = useState(false);
  const [activeThreadRestored, setActiveThreadRestored] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const referenceInput = useReferenceInput({
    model: model
      ? {
          ...model,
          capabilities: {
            ...model.capabilities,
            maxReferenceImages: Math.min(
              8,
              model.capabilities.maxReferenceImages,
            ),
          },
        }
      : null,
    references,
    onChange: setReferences,
  });
  useSessionDraft(
    activeId && storageKey !== "anon"
      ? `chugao.chat-draft.v1.${storageKey}.${activeId}`
      : null,
    { draft, references },
    conversationDraftSchema,
    (saved) => {
      setDraft(saved?.draft ?? "");
      setReferences(saved?.references ?? []);
    },
  );
  useEffect(() => () => abortRef.current?.abort(), []);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    void listConversations()
      .then((result) => setThreads(result.items))
      .catch(() => undefined);
    void getConversationPricing()
      .then(setPricing)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    setActiveId(initialThreadId || readActiveConversationId());
    setActiveThreadRestored(true);
  }, [initialThreadId]);

  useEffect(() => {
    if (activeThreadRestored) onActiveThreadChange(activeId);
  }, [activeId, activeThreadRestored, onActiveThreadChange]);

  useEffect(() => {
    let canceled = false;
    setPendingGeneration(null);
    if (!activeId) {
      setConversation(null);
      setLoadingThread(false);
      return;
    }
    setConversation(null);
    setLoadingThread(true);
    setThreadError(null);
    void getConversation(activeId)
      .then((data) => {
        if (canceled) return;
        setConversation(data);
        setTimeout(scrollToBottom, 0);
      })
      .catch(() => {
        if (!canceled) setThreadError("对话加载失败，请返回列表后重试");
      })
      .finally(() => {
        if (!canceled) setLoadingThread(false);
      });
    return () => {
      canceled = true;
    };
  }, [activeId, scrollToBottom]);

  const refreshThreads = useCallback(() => {
    void listConversations()
      .then((result) => setThreads(result.items))
      .catch(() => undefined);
  }, []);

  const createNewConversation = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const created = await createConversation({ title: "新的创作对话" });
      setConversation(created);
      setActiveId(created.id);
      setDraft("");
      setThreads((list) => [
        {
          id: created.id,
          title: created.title,
          lastMessageAt: created.lastMessageAt,
          createdAt: created.createdAt,
          latestMessage: null,
          thumbnailUrl: null,
          generationCount: 0,
        },
        ...list.filter((thread) => thread.id !== created.id),
      ]);
    } catch (error) {
      toast({
        title: "新建对话失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "danger",
      });
    } finally {
      setCreating(false);
    }
  };

  const send = async () => {
    const content = draft.trim();
    if (
      !content ||
      streaming !== null ||
      abortRef.current ||
      loadingThread ||
      !conversation ||
      referenceInput.uploading
    )
      return;

    setPendingUser(content);
    setStreaming("");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const user = await getMe();
      if (controller.signal.aborted) return;
      const receipt = readChatReceipt(user.id, conversation.id);
      const submitted =
        receipt?.pending?.kind === "create"
          ? receipt.pending.input.content
          : content;
      let lastTurn: ChatTurnView | null = null;
      await streamConversationChat({
        userId: user.id,
        conversationId: conversation.id,
        modelId: pricing?.defaultModelId ?? OPUS_MODEL_ID,
        messages: [{ role: "user", content: submitted }],
        ...referenceRequest(references),
        references: references.map((reference, index) =>
          reference.kind === "upload"
            ? { kind: "upload", key: reference.key, label: `图${index + 1}` }
            : { kind: "generated", id: reference.key, label: `图${index + 1}` },
        ),
        signal: controller.signal,
        handlers: {
          onTurn: (turn) => {
            if (controller.signal.aborted) return;
            lastTurn = turn;
            setPendingUser(null);
            setConversation((current) =>
              mergeChatTurn(current, turn, { content: submitted }),
            );
          },
          onDelta: () => undefined,
          onBilling: (event) => onCreditsChange(event.balance),
          onDone: () => undefined,
          onError: (message) =>
            toast({
              title: "对话失败",
              description: message,
              variant: "danger",
            }),
        },
      });
      if (!lastTurn || controller.signal.aborted) return;
      const history = await getConversation(conversation.id);
      if (controller.signal.aborted) return;
      setConversation(mergeChatTurn(history, lastTurn, { content: submitted }));
      refreshThreads();
      setDraft((value) => (value.trim() === submitted ? "" : value));
      setPendingUser(null);
      setTimeout(scrollToBottom, 0);
    } catch (error) {
      toast({
        title: "对话失败",
        description:
          error instanceof Error
            ? error.message
            : "提交结果尚未确认，发送凭据已保留",
        variant: "danger",
      });
    } finally {
      abortRef.current = null;
      setStreaming(null);
      setPendingUser(null);
    }
  };

  /** 第一步：把对话整理成提示词，先预览，不直接生成。 */
  const generateFromConversation = async () => {
    if (!model || !activeId || !conversation || compiling) return;
    const messages: ChatMessageInput[] = conversation.messages.map(
      (message) => ({
        role: message.role,
        content: message.content,
        generationId: message.generationId,
      }),
    );
    if (messages.length === 0) return;

    setCompiling(true);
    try {
      const compiled = await compileConversationPrompt({
        modelId: model.id,
        image2Mode: model.defaults.image2Mode,
        messages,
      });
      setPendingGeneration({
        prompt: compiled.prompt,
        assistantMessage: compiled.assistantMessage,
      });
    } catch (error) {
      toast({
        title: "整理提示词失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "danger",
      });
    } finally {
      setCompiling(false);
    }
  };

  /** 第二步：用户确认预览后才真正提交生成。 */
  const confirmPendingGeneration = async () => {
    if (!model || !activeId || !pendingGeneration || submittingPreview) return;
    const prompt = pendingGeneration.prompt.trim();
    if (!prompt) return;

    const lastUser = [...(conversation?.messages ?? [])]
      .reverse()
      .find((message) => message.role === "user");

    setSubmittingPreview(true);
    try {
      await onSubmitGeneration({
        modelId: model.id,
        image2Mode: model.defaults.image2Mode,
        prompt,
        n: 1,
        conversationId: activeId,
        userMessage: lastUser?.content.slice(0, 4000),
        assistantMessage: pendingGeneration.assistantMessage.slice(0, 400),
        ...referenceRequest(references),
      });
      setPendingGeneration(null);
    } catch (error) {
      toast({
        title: "生成失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "danger",
      });
    } finally {
      setSubmittingPreview(false);
    }
  };

  const archiveThread = async (id: string) => {
    try {
      await updateConversation(id, { archived: true });
      setThreads((list) => list.filter((thread) => thread.id !== id));
      if (activeId === id) {
        setActiveId(null);
        setConversation(null);
      }
    } catch {
      toast({ title: "归档失败", variant: "danger" });
    }
  };

  const hasAssistantReply =
    conversation?.messages.some((message) => message.role === "assistant") ??
    false;

  return (
    <div className="relative flex h-full min-h-0 min-w-0 flex-col bg-background text-sm tracking-normal">
      <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        {activeId ? (
          <IconButton
            variant="ghost"
            type="button"
            onClick={() => setActiveId(null)}
            disabled={
              streaming !== null ||
              referenceInput.uploading > 0 ||
              submittingPreview
            }
            aria-label="返回线程列表"
            title="返回线程列表"
            className="h-11 w-11 rounded-md sm:h-9 sm:w-9"
          >
            <ArrowLeft size={14} />
          </IconButton>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {activeId ? (conversation?.title ?? "对话") : "对话线程"}
        </span>
        {conversation?.messages.length ? (
          <CopyTextButton
            label="复制整段对话"
            text={conversation.messages
              .map(
                (message) =>
                  `${message.role === "user" ? "我" : "助手"}：\n${message.content}${message.generationPrompt ? `\n提示词：\n${message.generationPrompt}` : ""}`,
              )
              .join("\n\n")}
          />
        ) : null}
        {activeId && hasAssistantReply ? (
          <Button
            variant="primary"
            type="button"
            onClick={() => void generateFromConversation()}
            disabled={
              compiling ||
              pendingGeneration !== null ||
              streaming !== null ||
              referenceInput.uploading > 0
            }
            className="h-11 gap-2 rounded-md px-3 text-sm sm:h-9"
          >
            {compiling ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Sparkles size={16} />
            )}
            {compiling ? "整理中…" : "生成图片"}
          </Button>
        ) : null}
        {activeId ? (
          <IconButton
            variant="ghost"
            type="button"
            onClick={() => void archiveThread(activeId)}
            disabled={
              streaming !== null ||
              referenceInput.uploading > 0 ||
              submittingPreview
            }
            aria-label="归档对话"
            title="归档对话"
            className="h-11 w-11 rounded-md sm:h-9 sm:w-9"
          >
            <Trash2 size={13} />
          </IconButton>
        ) : null}
      </div>

      {!activeId ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <Button
            variant="ghost"
            type="button"
            onClick={() => void createNewConversation()}
            disabled={creating}
            className="mb-2 h-auto min-h-11 w-full flex-wrap justify-start gap-2 rounded-md border border-dashed border-border px-3 py-2 text-left text-sm sm:min-h-9"
          >
            <Plus size={13} />
            {creating ? "创建中…" : "新对话"}
            {pricing ? (
              <span className="ml-auto text-xs text-text-muted">
                {pricing.standardCredits} 点/轮
              </span>
            ) : null}
          </Button>

          {threads.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <MessageSquare size={18} className="text-text-faint" />
              <p className="text-sm leading-6 text-text-muted">
                还没有对话，从「新对话」开始
              </p>
            </div>
          ) : (
            threads.map((thread) => (
              <Button
                variant="ghost"
                key={thread.id}
                type="button"
                onClick={() => setActiveId(thread.id)}
                className="h-auto min-h-11 w-full min-w-0 flex-wrap items-center gap-3 rounded-md px-3 py-3 text-left font-normal"
              >
                {thread.thumbnailUrl ? (
                  <img
                    src={thread.thumbnailUrl}
                    alt=""
                    className="h-9 w-9 shrink-0 rounded-md border border-border object-cover"
                  />
                ) : (
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2 text-text-faint">
                    <MessageSquare size={13} />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {thread.title}
                  </span>
                  <span className="block truncate text-xs text-text-muted">
                    {thread.latestMessage ?? "…"}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-text-muted">
                  {formatDate(thread.lastMessageAt)}
                </span>
              </Button>
            ))
          )}
        </div>
      ) : (
        <>
          <div
            ref={scrollRef}
            className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain p-3"
          >
            {loadingThread ? (
              <p
                role="status"
                className="py-6 text-center text-sm text-text-muted"
              >
                加载对话中…
              </p>
            ) : null}
            {threadError ? (
              <p role="alert" className="py-4 text-sm text-danger">
                {threadError}
              </p>
            ) : null}
            {(conversation?.messages ?? []).map((message) => (
              <div
                key={message.id}
                className={cn(
                  "mb-4 flex min-w-0",
                  message.role === "user" ? "justify-end" : "justify-start",
                )}
              >
                <div
                  className={cn(
                    "min-w-0 max-w-full rounded-lg px-3 py-3 text-sm leading-6 sm:max-w-[95%]",
                    message.role === "user"
                      ? "border border-border bg-surface-2 text-foreground"
                      : "border border-border bg-surface text-foreground",
                  )}
                >
                  <p className="select-text whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                    {message.content}
                  </p>
                  {message.thumbnailUrl ? (
                    <img
                      src={message.thumbnailUrl}
                      alt="生成结果"
                      className="mt-3 max-h-40 max-w-full rounded-md border border-border object-contain"
                    />
                  ) : null}
                  <div className="mt-1 flex flex-wrap items-center justify-end gap-1 border-t border-border/60 pt-1">
                    <CopyTextButton text={message.content} label="复制消息" />
                    <IconButton
                      type="button"
                      variant="ghost"
                      aria-label="重新编辑消息"
                      title="重新编辑消息"
                      disabled={streaming !== null}
                      onClick={() => setDraft(message.content)}
                      className="h-11 w-11 rounded-md text-text-muted sm:h-9 sm:w-9"
                    >
                      <SquarePen size={15} />
                    </IconButton>
                    {message.generationPrompt ? (
                      <>
                        <CopyTextButton text={message.generationPrompt} />
                        {onUsePrompt ? (
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() =>
                              onUsePrompt(message.generationPrompt!)
                            }
                            className="h-11 rounded-md px-3 text-sm sm:h-9"
                          >
                            使用提示词
                          </Button>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}

            {pendingUser ? (
              <p className="mb-4 ml-auto max-w-full whitespace-pre-wrap break-words rounded-lg border border-border bg-surface-2 p-3 text-sm leading-6 [overflow-wrap:anywhere] sm:max-w-[95%]">
                {pendingUser}
              </p>
            ) : null}
            {streaming !== null ? (
              <div className="mb-2 flex justify-start">
                <div className="min-w-0 max-w-full rounded-lg border border-border bg-surface px-3 py-3 text-sm leading-6 text-foreground [overflow-wrap:anywhere] sm:max-w-[95%]">
                  {streaming ? (
                    <p className="whitespace-pre-wrap">{streaming}</p>
                  ) : (
                    <Loader2
                      size={14}
                      className="animate-spin text-text-faint"
                    />
                  )}
                </div>
              </div>
            ) : null}

            {conversation &&
            conversation.messages.length === 0 &&
            !streaming ? (
              <div className="flex flex-col items-center gap-2 py-12 text-center">
                <MessageSquare size={18} className="text-text-faint" />
                <p className="text-sm leading-6 text-text-muted">
                  描述画面需求，助手会把对话整理成可生成的提示词
                </p>
              </div>
            ) : null}
          </div>

          <div className="max-h-[55%] min-w-0 shrink-0 overflow-y-auto overscroll-contain border-t border-border px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <ReferenceDropZone
              onFile={(file) => void referenceInput.upload(file)}
              onReference={referenceInput.add}
              disabled={streaming !== null || loadingThread || !conversation}
              className="rounded-lg border border-border-strong bg-surface focus-within:border-brand"
            >
              <div className={styles.attachments}>
                <ReferenceThumbnails
                  references={references}
                  uploading={referenceInput.uploading}
                  onRemove={(key) =>
                    setReferences((items) =>
                      items.filter((item) => item.key !== key),
                    )
                  }
                />
              </div>
              <div className="flex min-w-0 items-end gap-2 p-3">
                <Textarea
                  value={draft}
                  disabled={
                    streaming !== null || loadingThread || !conversation
                  }
                  rows={2}
                  maxLength={CHAT_INPUT_MAX_CHARS}
                  placeholder="继续对话…"
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                  className="max-h-32 min-w-0 flex-1 resize-none rounded-none border-0 bg-transparent p-0 text-sm leading-6 outline-none placeholder:text-text-muted hover:bg-transparent focus:shadow-none"
                  aria-label="对话输入"
                />
                <IconButton
                  variant="primary"
                  type="button"
                  onClick={() => void send()}
                  disabled={
                    !draft.trim() ||
                    streaming !== null ||
                    referenceInput.uploading > 0 ||
                    loadingThread ||
                    !conversation
                  }
                  aria-label="发送"
                  title="发送"
                  className="h-11 w-11 rounded-md sm:h-9 sm:w-9"
                >
                  <Send size={16} />
                </IconButton>
              </div>
              <div className="mx-3 flex flex-wrap items-center justify-between gap-2 border-t border-border py-2">
                {model?.capabilities.supportsReferenceImage ? (
                  <label
                    title="添加参考图"
                    className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-md border border-border-strong bg-surface text-foreground focus-within:ring-2 focus-within:ring-brand sm:h-9 sm:w-9"
                  >
                    <ImagePlus size={16} />
                    <input
                      type="file"
                      aria-label="聊天参考图"
                      accept={REFERENCE_ACCEPT}
                      multiple
                      className="sr-only"
                      disabled={
                        streaming !== null || loadingThread || !conversation
                      }
                      onChange={(event) => {
                        Array.from(event.target.files ?? []).forEach(
                          (file) => void referenceInput.upload(file),
                        );
                        event.target.value = "";
                      }}
                    />
                  </label>
                ) : (
                  <span />
                )}
                <span className="text-xs text-text-muted">
                  {pricing ? `${pricing.standardCredits} 积分/轮` : ""}
                </span>
              </div>
            </ReferenceDropZone>
          </div>
        </>
      )}

      {pendingGeneration ? (
        <div className="absolute inset-0 z-10 flex min-w-0 flex-col bg-surface">
          <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
            <Sparkles size={13} className="text-text-muted" />
            <span className="min-w-0 flex-1 text-xl font-semibold leading-6">
              确认生成
            </span>
            <CopyTextButton text={pendingGeneration.prompt} />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <div className={styles.attachments}>
              <ReferenceThumbnails
                references={references}
                onRemove={(key) =>
                  setReferences((items) =>
                    items.filter((item) => item.key !== key),
                  )
                }
              />
            </div>
            <p className="mb-2 text-xs font-medium text-text-muted">
              根据对话整理出的提示词（可修改）
            </p>
            <Textarea
              value={pendingGeneration.prompt}
              maxLength={4000}
              onChange={(event) =>
                setPendingGeneration((current) =>
                  current
                    ? { ...current, prompt: event.target.value }
                    : current,
                )
              }
              aria-label="生成提示词预览"
              className="h-36 w-full resize-none rounded-md border border-border bg-background p-3 text-sm leading-6 text-foreground"
            />
            <p className="mt-3 text-xs leading-5 text-text-muted [overflow-wrap:anywhere]">
              将使用模型 {model?.displayName ?? "…"} 生成 1 张图片，
              确认后才会扣减额度并进入队列。
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <Button
              variant="secondary"
              type="button"
              onClick={() => setPendingGeneration(null)}
              disabled={submittingPreview}
              className="h-11 rounded-md px-3 text-sm sm:h-9"
            >
              取消
            </Button>
            <Button
              variant="primary"
              type="button"
              onClick={() => void confirmPendingGeneration()}
              disabled={
                submittingPreview ||
                pendingGeneration.prompt.trim().length === 0
              }
              className="h-11 gap-2 rounded-md px-3 text-sm sm:h-9"
            >
              {submittingPreview ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Sparkles size={12} />
              )}
              确认生成
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
