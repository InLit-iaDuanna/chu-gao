"use client";

// 对话模式：与「单图生成」「PPT」并列的第三种顶层模式。
// 设计要点：
//  - 普通多轮 AI 聊天：流式渲染（/api/conversations/chat，SSE）、多模态图片输入、可选「思考模式」。
//  - 预览出图：先 POST /api/conversations/compile 取编译后的出图 prompt，进入可编辑预览；
//    用户确认后复用标准出图链路（POST /api/generations + GET /api/generations/{id}/stream）。
//  - 历史记录：文本消息与出图卡片落库到既有 Conversation/ConversationMessage（复用 /api/conversations*）。
//    左侧历史会话列表可切换/新建/归档；刷新或切回后消息与出图卡片自动恢复。
//    多模态图片附件与思考链仅用于即时请求，不落库（端点只存文本）。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MessageSquarePlus, PanelLeft } from "lucide-react";

import type { PublicModelDefinition } from "@/lib/models/types";
import { ConversationComposer } from "@/components/workbench/ConversationComposer";
import {
  AssistantBubble,
  ConversationEmpty,
  PreviewPanel,
  UserBubble,
} from "@/components/workbench/ConversationMessages";
import { ConversationSidebar } from "@/components/workbench/ConversationSidebar";
import {
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  fromStoredMessages,
  nextId,
  readFileAsDataUrl,
  toChatRequestMessages,
  toPlainMessages,
} from "@/components/workbench/conversation-mode-utils";
import {
  appendConversationMessages,
  archiveConversationById,
  clientErrorMessage,
  compileConversationPrompt,
  createConversationFromFirstMessage,
  fetchConversationPricing,
  fetchConversationMessages,
  fetchConversationSummaries,
  requestConversationChat,
  submitConversationGeneration,
  type PersistableConversationMessage,
} from "@/components/workbench/conversation-mode-api";
import { consumeSse } from "@/components/workbench/conversation-sse";
import { watchConversationGeneration } from "@/components/workbench/conversation-generation-stream";
import type {
  ChatMessage,
  PendingAttachment,
} from "@/components/workbench/conversation-types";
import type { ConversationSummaryView } from "@/lib/conversation";
import { useWorkbenchStore } from "@/components/workbench/stores/workbench-store";

interface ConversationModeProps {
  models: PublicModelDefinition[];
  selectedModelId: string;
  credits: number;
  conversationId?: string | null;
}

export function ConversationMode({
  models,
  selectedModelId,
  credits,
  conversationId,
}: ConversationModeProps): React.ReactElement {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [reasoning, setReasoning] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);

  // 历史会话。
  const [activeId, setActiveId] = useState<string | null>(
    conversationId ?? null,
  );
  const [conversations, setConversations] = useState<ConversationSummaryView[]>(
    [],
  );
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // 预览出图状态。
  const [preview, setPreview] = useState<{ prompt: string } | null>(null);
  const [isCompiling, setIsCompiling] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [chatPricing, setChatPricing] = useState<{
    standardCredits: number;
    reasoningCredits: number;
  } | null>(null);
  const setCredits = useWorkbenchStore((state) => state.setCredits);

  const abortRef = useRef<AbortController | null>(null);
  const generationStreamRef = useRef<EventSource | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // activeId 的可变引用，供异步回调读取最新值（避免闭包旧值）。
  const activeIdRef = useRef<string | null>(activeId);
  activeIdRef.current = activeId;

  const selectedModel = useMemo(
    () => models.find((m) => m.id === selectedModelId) ?? null,
    [models, selectedModelId],
  );

  const hasConversation = messages.some(
    (message) => !message.isError && message.content.trim().length > 0,
  );

  // ── 历史持久化 helpers ────────────────────────────────────────
  const loadConversations = useCallback(async () => {
    try {
      setConversations(await fetchConversationSummaries(30));
    } catch {
      // 历史列表加载失败不影响聊天。
    }
  }, []);

  const loadConversation = useCallback(async (id: string) => {
    setIsLoadingHistory(true);
    try {
      setMessages(fromStoredMessages(await fetchConversationMessages(id)));
    } catch {
      // 忽略：保留当前消息。
    } finally {
      setIsLoadingHistory(false);
    }
  }, []);

  // 确保存在会话 id：无则创建（seed 作为首条用户消息落库）。返回 id 或 null（DB 不可用）。
  const ensureConversationId = useCallback(
    async (seed: string): Promise<string | null> => {
      if (activeIdRef.current) {
        return activeIdRef.current;
      }
      try {
        const id = await createConversationFromFirstMessage(seed);
        setActiveId(id);
        activeIdRef.current = id;
        void loadConversations();
        return id;
      } catch {
        return null;
      }
    },
    [loadConversations],
  );

  // 追加消息（best-effort，失败不阻断聊天）。
  const persistMessages = useCallback(
    async (id: string, toPersist: PersistableConversationMessage[]) => {
      if (toPersist.length === 0) return;
      try {
        await appendConversationMessages(id, toPersist);
        void loadConversations();
      } catch {
        // 忽略持久化失败。
      }
    },
    [loadConversations],
  );

  const selectConversation = useCallback(
    (id: string) => {
      if (id === activeIdRef.current) {
        setSidebarOpen(false);
        return;
      }
      abortRef.current?.abort();
      generationStreamRef.current?.close();
      setActiveId(id);
      activeIdRef.current = id;
      setPreview(null);
      setComposerError(null);
      setSidebarOpen(false);
      void loadConversation(id);
    },
    [loadConversation],
  );

  const startNewConversation = useCallback(() => {
    abortRef.current?.abort();
    generationStreamRef.current?.close();
    setActiveId(null);
    activeIdRef.current = null;
    setMessages([]);
    setPreview(null);
    setComposerError(null);
    setSidebarOpen(false);
  }, []);

  const archiveConversation = useCallback(
    async (id: string) => {
      try {
        await archiveConversationById(id);
      } catch {
        // 忽略。
      }
      if (id === activeIdRef.current) {
        startNewConversation();
      }
      void loadConversations();
    },
    [loadConversations, startNewConversation],
  );

  // 挂载：拉取历史列表；若带入 conversationId 则加载其消息。
  useEffect(() => {
    void loadConversations();
    void fetchConversationPricing()
      .then(setChatPricing)
      .catch(() => undefined);
    if (conversationId) {
      void loadConversation(conversationId);
    }
    // 仅在挂载时执行一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 自动滚动到底部。
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, isStreaming]);

  // 卸载时中断流与生成监听。
  useEffect(
    () => () => {
      abortRef.current?.abort();
      generationStreamRef.current?.close();
    },
    [],
  );

  const updateMessage = useCallback(
    (id: string, patch: Partial<ChatMessage>) => {
      setMessages((current) =>
        current.map((message) =>
          message.id === id ? { ...message, ...patch } : message,
        ),
      );
    },
    [],
  );

  const appendDelta = useCallback(
    (id: string, key: "content" | "reasoning", token: string) => {
      setMessages((current) =>
        current.map((message) =>
          message.id === id
            ? { ...message, [key]: (message[key] ?? "") + token }
            : message,
        ),
      );
    },
    [],
  );

  // ── 发送一条聊天消息并消费 SSE 流 ──────────────────────────────
  const sendMessage = useCallback(
    async (overrideText?: string) => {
      const text = (overrideText ?? draft).trim();
      if ((!text && attachments.length === 0) || isStreaming) {
        return;
      }

      setComposerError(null);

      const userMessage: ChatMessage = {
        id: nextId("user"),
        role: "user",
        content: text,
        images: attachments.length
          ? attachments.map((item) => item.dataUrl)
          : undefined,
      };

      const assistantId = nextId("assistant");
      const assistantMessage: ChatMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        pending: true,
      };

      const history = [...messages, userMessage];
      setMessages([...history, assistantMessage]);
      setDraft("");
      setAttachments([]);
      setIsStreaming(true);

      // 记录发送时是否已有会话；累计助手文本用于落库（思考链不落库）。
      const hadConversation = Boolean(activeIdRef.current);
      let assistantText = "";

      const abort = new AbortController();
      abortRef.current = abort;

      try {
        const response = await requestConversationChat({
          messages: toChatRequestMessages(history),
          reasoning,
          signal: abort.signal,
        });

        if (!response.ok || !response.body) {
          const payload = (await response.json().catch(() => null)) as {
            error?: { message?: string };
          } | null;
          updateMessage(assistantId, {
            pending: false,
            isError: true,
            content:
              payload?.error?.message ?? "对话服务暂时不可用，请稍后重试。",
          });
          return;
        }

        await consumeSse(response.body, {
          onDelta: (token) => {
            assistantText += token;
            appendDelta(assistantId, "content", token);
          },
          onReasoning: (token) => appendDelta(assistantId, "reasoning", token),
          onBilling: ({ balance }) => setCredits(balance),
          onError: (message) =>
            updateMessage(assistantId, {
              pending: false,
              isError: true,
              content: message || "对话出错，请重试。",
            }),
          signal: abort.signal,
        });

        // 流结束：清除 pending；若助手没有任何输出，给一句兜底。
        setMessages((current) =>
          current.map((message) => {
            if (message.id !== assistantId) {
              return message;
            }
            const hasOutput =
              message.content.trim().length > 0 ||
              (message.reasoning ?? "").trim().length > 0;
            return {
              ...message,
              pending: false,
              content: hasOutput ? message.content : "（未收到回复）",
            };
          }),
        );

        // 持久化（best-effort）：新会话由创建接口落首条用户消息，已存在会话补存用户消息。
        void (async () => {
          const convId = await ensureConversationId(text || "（图片消息）");
          if (!convId) return;
          const toPersist: PersistableConversationMessage[] = [];
          if (hadConversation && text) {
            toPersist.push({ role: "user", content: text });
          }
          const finalAssistant = assistantText.trim();
          if (finalAssistant) {
            toPersist.push({ role: "assistant", content: finalAssistant });
          }
          await persistMessages(convId, toPersist);
        })();
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          updateMessage(assistantId, { pending: false });
          return;
        }
        updateMessage(assistantId, {
          pending: false,
          isError: true,
          content: "网络错误，对话中断。请重试。",
        });
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [
      appendDelta,
      attachments,
      draft,
      ensureConversationId,
      isStreaming,
      messages,
      persistMessages,
      reasoning,
      setCredits,
      updateMessage,
    ],
  );

  const sendOption = useCallback(
    (value: string) => {
      void sendMessage(value);
    },
    [sendMessage],
  );

  // ── 多模态附件 ────────────────────────────────────────────────
  const addFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) {
      return;
    }
    setComposerError(null);

    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    const nonImageNote = files.length - imageFiles.length;

    const accepted: PendingAttachment[] = [];
    for (const file of imageFiles) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setComposerError("单张图片需小于 8MB。");
        continue;
      }
      try {
        const dataUrl = await readFileAsDataUrl(file);
        accepted.push({ id: nextId("att"), dataUrl, name: file.name });
      } catch {
        setComposerError("图片读取失败，请重试。");
      }
    }

    if (nonImageNote > 0) {
      setComposerError("仅支持图片附件，已忽略非图片文件。");
    }

    if (accepted.length > 0) {
      setAttachments((current) =>
        [...current, ...accepted].slice(0, MAX_ATTACHMENTS),
      );
    }
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((current) => current.filter((item) => item.id !== id));
  }, []);

  // ── 预览出图提示词 ────────────────────────────────────────────
  const openPreview = useCallback(async () => {
    if (!selectedModel || isCompiling || isGenerating) {
      return;
    }
    setComposerError(null);
    setIsCompiling(true);

    try {
      const prompt = await compileConversationPrompt({
        modelId: selectedModel.id,
        image2Mode: selectedModel.defaults.image2Mode,
        messages: toPlainMessages(messages),
      });
      setPreview({ prompt });
    } catch (error) {
      setComposerError(
        clientErrorMessage(error, "提示词编译失败，请检查网络后重试。"),
      );
    } finally {
      setIsCompiling(false);
    }
  }, [isCompiling, isGenerating, messages, selectedModel]);

  const closePreview = useCallback(() => {
    if (isGenerating) {
      return;
    }
    setPreview(null);
  }, [isGenerating]);

  // ── 监听出图任务状态 ──────────────────────────────────────────
  const watchGeneration = useCallback(
    (messageId: string, generationId: string) => {
      watchConversationGeneration({
        generationId,
        generationStreamRef,
        messageId,
        setIsGenerating,
        setMessages,
        updateMessage,
      });
    },
    [updateMessage],
  );

  // ── 确认生成（复用标准出图链路）─────────────────────────────
  const confirmGenerate = useCallback(async () => {
    if (!preview || !selectedModel || isGenerating) {
      return;
    }
    const prompt = preview.prompt.trim();
    if (!prompt) {
      setComposerError("提示词不能为空。");
      return;
    }

    setIsGenerating(true);
    setComposerError(null);

    const messageId = nextId("gen");

    try {
      // 确保会话存在，使生成与会话关联，且出图卡片可落库。
      const convId = await ensureConversationId(prompt);

      const result = await submitConversationGeneration({
        conversationId: convId ?? undefined,
        modelId: selectedModel.id,
        prompt,
        n: 1,
        size: selectedModel.defaults.size,
        responseFormat: selectedModel.defaults.responseFormat,
        outputFormat: selectedModel.defaults.outputFormat,
        background: selectedModel.defaults.background,
        outputCompression: selectedModel.defaults.outputCompression,
      });
      const generationId = result.generationId;

      // 关闭预览，插入一条「出图中」的助手卡片消息。
      setPreview(null);
      setMessages((current) => [
        ...current,
        {
          id: messageId,
          role: "assistant",
          content: "",
          generation: {
            id: generationId,
            status: (result.status ?? "PENDING").toUpperCase(),
            progress: 0,
            prompt,
          },
        },
      ]);

      // 落库出图卡片（关联 generationId，刷新后可恢复）。best-effort。
      if (convId) {
        void persistMessages(convId, [
          {
            role: "assistant",
            content: "已根据上下文生成图片。",
            generationId,
          },
        ]);
      }

      watchGeneration(messageId, generationId);
    } catch (error) {
      setComposerError(
        clientErrorMessage(error, "出图请求提交失败，请检查网络后重试。"),
      );
      setIsGenerating(false);
    }
  }, [
    ensureConversationId,
    isGenerating,
    persistMessages,
    preview,
    selectedModel,
    watchGeneration,
  ]);

  const messageCredits = chatPricing
    ? reasoning
      ? chatPricing.reasoningCredits
      : chatPricing.standardCredits
    : null;
  const hasInsufficientCredits =
    messageCredits !== null && credits < messageCredits;
  const canSend =
    !isStreaming &&
    !hasInsufficientCredits &&
    (draft.trim().length > 0 || attachments.length > 0);

  return (
    <div className="mx-auto flex h-[calc(100vh-12rem)] min-h-[480px] w-full max-w-5xl gap-3">
      <ConversationSidebar
        conversations={conversations}
        activeId={activeId}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onSelect={selectConversation}
        onNew={startNewConversation}
        onArchive={archiveConversation}
      />

      <section aria-label="对话模式" className="flex min-w-0 flex-1 flex-col">
        {/* 顶栏：移动端历史开关 + 新建对话 */}
        <div className="mb-1 flex shrink-0 items-center justify-between gap-2 px-1">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[12px] text-text-muted transition-colors hover:text-foreground md:hidden"
            aria-label="历史对话"
          >
            <PanelLeft size={13} strokeWidth={1.5} />
            历史
          </button>
          <span className="hidden text-[12px] text-text-faint md:block">
            {isLoadingHistory ? "加载历史…" : null}
          </span>
          <button
            type="button"
            onClick={startNewConversation}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[12px] text-text-muted transition-colors hover:text-foreground"
            aria-label="新建对话"
          >
            <MessageSquarePlus size={13} strokeWidth={1.5} />
            新建对话
          </button>
        </div>

        {/* 消息区 */}
        <div
          ref={scrollRef}
          role="log"
          aria-live="polite"
          className="flex-1 space-y-5 overflow-y-auto px-1 py-2 scroll-smooth"
        >
          {messages.length === 0 ? (
            <ConversationEmpty modelName={selectedModel?.displayName ?? null} />
          ) : (
            messages.map((message) =>
              message.role === "user" ? (
                <UserBubble key={message.id} message={message} />
              ) : (
                <AssistantBubble
                  key={message.id}
                  message={message}
                  onSelectOption={sendOption}
                />
              ),
            )
          )}
        </div>

        {/* 预览出图面板 */}
        {preview ? (
          <PreviewPanel
            prompt={preview.prompt}
            modelName={selectedModel?.displayName ?? "无模型"}
            isGenerating={isGenerating}
            onChange={(value) => setPreview({ prompt: value })}
            onConfirm={confirmGenerate}
            onCancel={closePreview}
          />
        ) : null}

        <ConversationComposer
          attachments={attachments}
          canPreview={hasConversation && Boolean(selectedModel)}
          canSend={canSend}
          composerError={
            composerError ??
            (hasInsufficientCredits
              ? `余额不足，本次需要 ${messageCredits} 点`
              : null)
          }
          credits={credits}
          draft={draft}
          isCompiling={isCompiling}
          isGenerating={isGenerating}
          isStreaming={isStreaming}
          modelName={selectedModel?.displayName ?? null}
          messageCredits={messageCredits}
          previewOpen={Boolean(preview)}
          reasoning={reasoning}
          onAddFiles={(files) => {
            void addFiles(files);
          }}
          onDraftChange={setDraft}
          onPreview={() => {
            void openPreview();
          }}
          onReasoningChange={setReasoning}
          onRemoveAttachment={removeAttachment}
          onSend={() => {
            void sendMessage();
          }}
        />
      </section>
    </div>
  );
}
