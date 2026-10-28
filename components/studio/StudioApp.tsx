"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Archive,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  SquarePen,
  Search,
} from "lucide-react";
import { z } from "zod";
import type { ReasoningEffort } from "@/lib/chat-model-options";
import type { ChatContextStatus } from "@/lib/chat-context-types";
import { chatIsTerminal, type ChatTurnView } from "@/lib/chat-turn-types";
import {
  cancelManagedChat,
  followChatTurn,
  getActiveChatTurn,
  getChatTurnSnapshot,
  streamManagedChat,
} from "./lib/chat-turn-api";
import {
  chatReceiptKey,
  clearChatReceipt,
  prepareChatSubmission,
  readChatReceipt,
  resolveChatSubmission,
} from "./lib/chat-submission";
import { mergeChatTurn } from "./lib/chat-turn-view";
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  DropdownMenu,
  DropdownMenuItem,
  IconButton,
  Input,
  useToast,
} from "@/components/ui";
import {
  CommandDock,
  type DockParams,
  type ReferenceItem,
} from "./CommandDock";
import { CopyTextButton } from "./CopyTextButton";
import { Lightbox, type LightboxState } from "./Lightbox";
import { TopBar } from "./TopBar";
import { CreationStarters } from "./CreationStarters";
import { ChatContextControl } from "./ChatContextControl";
import { StudioGreeting } from "./StudioGreeting";
import {
  useWorkspaceNavigation,
  WorkspaceSidebarToggle,
} from "./WorkspaceShell";
import { ConversationTimeline } from "./chat/ConversationTimeline";
import { ConversationTimelineV8 } from "./chat/ConversationTimelineV8";
import { CreativeBriefPanel, type AgentTurn } from "./CreativeBriefPanel";
import {
  creativeDraftSchema,
  EMPTY_CREATIVE_DRAFT,
  mergeCreativeBrief,
  type CreativeDraft,
} from "@/lib/creative-brief";
import { messageGeneration } from "./chat/message-generation";
import {
  cancelGeneration,
  compileConversationPrompt,
  createConversation,
  createGeneration,
  getConversation,
  getConversationPricing,
  getChatContext,
  compactChatContext,
  getGenerationForRetry,
  getMe,
  checkCreativeResult,
  inspectCreativeReferences,
  isApiError,
  listModels,
  optimizePrompt,
  planCreativeBrief,
  updateConversation,
} from "./lib/api";
import { subscribeGeneration } from "./lib/sse";
import { writeActiveConversationId } from "./lib/active-conversation";
import { referenceRequest, useReferenceInput } from "./lib/reference-input";
import {
  agentTurnsSchema,
  reasoningEffortSchema,
  studioDraftSchema,
  useSessionDraft,
} from "./lib/use-session-draft";
import { cn } from "@/lib/utils";
import {
  isActiveStatus,
  type ChatMessageInput,
  type CreateGenerationInput,
  type Conversation,
  type ConversationPricing,
  type CreativeQualityCheck,
  type Generation,
  type Me,
  type ModelInfo,
} from "./lib/types";

export interface StudioInitialRecipe {
  negativePrompt?: string;
  modelName?: string;
  aspectRatio?: string;
  resolution?: string;
  seed?: number;
}
const EMPTY_RECIPE: StudioInitialRecipe = {};

const chatPricingSchema = z
  .object({
    standardCredits: z.number().nonnegative(),
    reasoningCredits: z.number().nonnegative(),
    defaultModelId: z.string().min(1),
    models: z.array(
      z.object({
        id: z.string().min(1),
        displayName: z.string().min(1),
        reasoningEfforts: z.array(reasoningEffortSchema),
        defaultReasoningEffort: reasoningEffortSchema.optional(),
        credits: z.number().nonnegative(),
        supportsVision: z.boolean(),
        maxReferenceImages: z.number().int().nonnegative(),
        supportsWebSearch: z.boolean().optional(),
        supportsDurableTurns: z.boolean().optional(),
      }),
    ),
  })
  .refine((data) =>
    data.models.some((item) => item.id === data.defaultModelId),
  );

type AgentQualityTarget = {
  generationId: string;
  imageId: string;
};

function referenceInspectionErrorMessage(error: unknown) {
  const detail =
    error instanceof Error && error.message.trim()
      ? error.message
      : "暂时无法读取参考图";

  if (isApiError(error) && error.code === "VISION_UNAVAILABLE") {
    return `${detail}，Agent 已继续按文字整理。`;
  }

  return `参考图分析失败：${detail}。Agent 已继续按文字整理，重新发送可以重试。`;
}

function recipeSize(model: ModelInfo, recipe: StudioInitialRecipe) {
  if (!recipe.aspectRatio && !recipe.resolution) return undefined;
  const [w, h] = (recipe.aspectRatio ?? "").split(":").map(Number);
  return model.capabilities.sizes.find((size) => {
    const [width, height] = size.split("x").map(Number);
    if (!width || !height) return false;
    const resolution =
      Math.max(width, height) >= 3840
        ? "4K"
        : Math.max(width, height) >= 2048
          ? "2K"
          : "1K";
    return (
      (!w || !h || Math.abs(width / height - w / h) < 0.02) &&
      (!recipe.resolution || resolution === recipe.resolution)
    );
  });
}

export function StudioApp({
  initialThreadId = null,
  initialPrompt = null,
  initialReferenceKeys = [],
  initialRecipe = EMPTY_RECIPE,
  creativeEnabled = false,
  initialMode,
}: {
  initialThreadId?: string | null;
  initialPrompt?: string | null;
  initialReferenceKeys?: string[];
  initialRecipe?: StudioInitialRecipe;
  creativeEnabled?: boolean;
  initialMode?: "agent";
}) {
  const { toast } = useToast();
  const { refreshThreads, setStudioNavigation, closeMobile } =
    useWorkspaceNavigation();
  const [me, setMe] = useState<Me | null>(null);
  const userId = me?.id;
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelId, setModelId] = useState<string | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(initialThreadId);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const conversationRef = useRef(conversation);
  conversationRef.current = conversation;
  const [threadLoading, setThreadLoading] = useState(Boolean(initialThreadId));
  const [threadError, setThreadError] = useState<string | null>(null);
  const [generations, setGenerations] = useState<Record<string, Generation>>(
    {},
  );
  const [prompt, setPrompt] = useState(initialPrompt ?? "");
  const [mode, setMode] = useState<"image" | "chat" | "agent">(
    creativeEnabled && initialMode ? initialMode : "image",
  );
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const [creative, setCreative] = useState<CreativeDraft>(EMPTY_CREATIVE_DRAFT);
  const [agentTurns, setAgentTurns] = useState<AgentTurn[]>([]);
  const [activeQuestion, setActiveQuestion] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);
  const [pendingAgentInstruction, setPendingAgentInstruction] = useState<
    string | null
  >(null);
  const [agentToolStatus, setAgentToolStatus] = useState<string | null>(null);
  const [agentQuality, setAgentQuality] = useState<CreativeQualityCheck | null>(
    null,
  );
  const [agentQualityTarget, setAgentQualityTarget] =
    useState<AgentQualityTarget | null>(null);
  const [agentQualityChecking, setAgentQualityChecking] = useState(false);
  const [agentQualityError, setAgentQualityError] = useState<string | null>(
    null,
  );
  const [quotingCreative, setQuotingCreative] = useState(false);
  const [chatPricing, setChatPricing] = useState<ConversationPricing | null>(
    null,
  );
  const [chatModelError, setChatModelError] = useState<string | null>(null);
  const [chatModelId, setChatModelId] = useState<string | null>(null);
  const [chatReasoningEffort, setChatReasoningEffort] =
    useState<ReasoningEffort>();
  const [chatContext, setChatContext] = useState<ChatContextStatus | null>(
    null,
  );
  const [chatContextLoading, setChatContextLoading] = useState(false);
  const [chatContextError, setChatContextError] = useState<string | null>(null);
  const [chatCompacting, setChatCompacting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);
  const [focusVersion, setFocusVersion] = useState(0);
  const [rename, setRename] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [usePrevious, setUsePrevious] = useState(true);
  const [params, setParams] = useState<DockParams>({
    n: 1,
    negativePrompt: initialRecipe.negativePrompt,
    seed: initialRecipe.seed,
    referenceImages: [...new Set(initialReferenceKeys)]
      .slice(0, 16)
      .map((key) => ({
        kind: "upload",
        key,
        previewUrl: "/api/upload?key=" + encodeURIComponent(key),
      })),
  });
  const streams = useRef(new Map<string, () => void>());
  const activeRef = useRef(activeId);
  activeRef.current = activeId;
  const mounted = useRef(true);
  const sendLock = useRef(false);
  const loadVersion = useRef(0);
  const chatAbort = useRef<AbortController | null>(null);
  const managedChatTurn = useRef<ChatTurnView | null>(null);
  const recoveryRequested = useRef(false);
  const recoveryAction = useRef<() => void>(() => undefined);
  const flushDeferredRecovery = useCallback(() => {
    if (!recoveryRequested.current) return;
    recoveryRequested.current = false;
    queueMicrotask(() => recoveryAction.current());
  }, []);
  const [managedTurnId, setManagedTurnId] = useState<string | null>(null);
  const [chatRecoverable, setChatRecoverable] = useState(false);
  const [chatConnection, setChatConnection] = useState<
    "connected" | "reconnecting" | "disconnected"
  >("connected");
  const agentGenerationIds = useRef(new Set<string>());
  const agentTerminalGenerationIds = useRef(new Set<string>());
  const referenceInsightCache = useRef(new Map<string, string>());
  const creativeBriefRef = useRef(creative.brief);
  creativeBriefRef.current = creative.brief;
  const recipe = useRef(initialRecipe);
  const externalDraft = useRef(
    initialPrompt !== null || initialReferenceKeys.length > 0,
  );
  const model =
    models.find((item) => item.id === modelId) ??
    models.find((item) => item.available) ??
    models[0] ??
    null;
  const chatModel =
    chatPricing?.models.find((item) => item.id === chatModelId) ??
    chatPricing?.models.find(
      (item) => item.id === chatPricing.defaultModelId,
    ) ??
    null;
  const reasoningEffort =
    chatModel?.id === chatModelId &&
    chatReasoningEffort &&
    chatModel.reasoningEfforts.includes(chatReasoningEffort)
      ? chatReasoningEffort
      : chatModel?.defaultReasoningEffort &&
          chatModel.reasoningEfforts.includes(chatModel.defaultReasoningEffort)
        ? chatModel.defaultReasoningEffort
        : chatModel?.reasoningEfforts[0];
  // The shared reference hook expects ModelInfo; chat capabilities never come from image models.
  const inputModel: ModelInfo | null =
    mode === "chat"
      ? chatModel
        ? {
            id: "chat:" + chatModel.id,
            displayName: chatModel.displayName,
            vendor: "",
            protocol: "",
            available: true,
            defaults: {
              size: "auto",
              responseFormat: "",
              outputFormat: "",
              background: "",
            },
            capabilities: {
              sizes: [],
              responseFormats: [],
              resolutions: [],
              supportsReferenceImage: chatModel.supportsVision,
              maxReferenceImages: chatModel.maxReferenceImages,
              supportsNegativePrompt: false,
              supportsSeed: false,
              maxN: 1,
              outputFormats: [],
              backgrounds: [],
              supportsOutputCompression: false,
            },
          }
        : null
      : model;
  const references = useReferenceInput({
    model: inputModel,
    references: params.referenceImages,
    onChange: (referenceImages) =>
      setParams((current) => ({ ...current, referenceImages })),
  });

  const runAgentQualityCheck = useCallback(
    async (target: AgentQualityTarget, brief: CreativeDraft["brief"]) => {
      if (!mounted.current) return;
      setAgentQualityChecking(true);
      setAgentQualityError(null);
      try {
        const result = await checkCreativeResult({
          ...target,
          brief,
        });
        if (mounted.current) setAgentQuality(result);
      } catch (error) {
        if (mounted.current) {
          setAgentQualityError(
            error instanceof Error
              ? error.message
              : "自动质量检查暂时失败，可以稍后重试",
          );
        }
      } finally {
        if (mounted.current) setAgentQualityChecking(false);
      }
    },
    [],
  );

  const handleAgentGenerationUpdate = useCallback(
    (generation: Generation) => {
      if (
        !agentGenerationIds.current.has(generation.id) ||
        isActiveStatus(generation.status) ||
        agentTerminalGenerationIds.current.has(generation.id)
      ) {
        return;
      }
      agentTerminalGenerationIds.current.add(generation.id);

      if (generation.status !== "SUCCEEDED") {
        setAgentTurns((current) => [
          ...current,
          {
            id: `agent-result-${generation.id}`,
            role: "assistant",
            content: `这次生成${generation.status === "CANCELED" ? "已取消" : "未完成"}，我没有替换当前基图。你可以调整要求后重新确认。`,
          },
        ]);
        return;
      }

      const image = generation.images[0];
      if (!image) {
        setAgentTurns((current) => [
          ...current,
          {
            id: `agent-result-${generation.id}`,
            role: "assistant",
            content: "生成任务已完成，但结果图片还在读取中，请稍后查看。",
          },
        ]);
        return;
      }

      const target = { generationId: generation.id, imageId: image.id };
      setCreative((current) => ({
        ...current,
        operationId: null,
        baseReference: { kind: "source", key: image.id },
      }));
      setAgentQuality(null);
      setAgentQualityTarget(target);
      setAgentQualityError(null);
      setAgentTurns((current) => [
        ...current,
        {
          id: `agent-result-${generation.id}`,
          role: "assistant",
          content:
            "图片已生成，我已经把它接回当前创作流程，并设为下一轮的基图。你可以继续说要改哪里；我正在自动检查它是否符合当前方案。",
        },
      ]);
      void runAgentQualityCheck(target, creativeBriefRef.current);
    },
    [runAgentQualityCheck],
  );

  useSessionDraft(
    me ? "chugao.dialogue-draft.v1." + me.id + "." + (activeId ?? "new") : null,
    {
      prompt,
      modelId,
      params,
      mode,
      activeQuestion,
      chatModelId: chatModel?.id ?? chatModelId,
      chatReasoningEffort: chatModel ? reasoningEffort : chatReasoningEffort,
    },
    studioDraftSchema,
    (saved) => {
      if (sendLock.current) return;
      setPrompt(saved?.prompt ?? "");
      setParams(
        (current) => saved?.params ?? { ...current, referenceImages: [] },
      );
      if (saved?.modelId) setModelId(saved.modelId);
      setChatModelId(saved?.chatModelId ?? null);
      setChatReasoningEffort(saved?.chatReasoningEffort);
      setActiveQuestion(saved?.activeQuestion ?? null);
      const restoredMode = initialMode ?? saved?.mode;
      if (restoredMode)
        setMode(
          restoredMode === "agent" && !creativeEnabled ? "image" : restoredMode,
        );
    },
    externalDraft.current,
  );
  useSessionDraft(
    me ? "chugao.creative-draft.v1." + me.id + "." + (activeId ?? "new") : null,
    creative,
    creativeDraftSchema,
    (saved) => {
      if (!sendLock.current) setCreative(saved ?? EMPTY_CREATIVE_DRAFT);
    },
  );
  useSessionDraft(
    me ? "chugao.agent-turns.v1." + me.id + "." + (activeId ?? "new") : null,
    agentTurns,
    agentTurnsSchema,
    (saved) => {
      if (!sendLock.current) setAgentTurns(saved ?? []);
    },
  );

  const refreshMe = useCallback(() => {
    void getMe()
      .then((data) => {
        if (mounted.current) setMe(data);
      })
      .catch(() => undefined);
  }, []);
  const loadModels = useCallback(async () => {
    try {
      const data = await listModels();
      if (!mounted.current) return;
      setModels(data);
      if (!data.length) {
        setModelError("暂无可用模型");
        return;
      }
      setModelError(null);
      const preferred =
        data.find(
          (item) =>
            item.available && item.displayName === recipe.current.modelName,
        ) ??
        data.find((item) => item.available) ??
        data[0];
      setModelId((current) =>
        data.some((item) => item.id === current) ? current : preferred.id,
      );
      const size = recipeSize(preferred, recipe.current);
      if (size)
        setParams((current) => ({ ...current, size: current.size ?? size }));
    } catch {
      if (mounted.current) setModelError("模型加载失败，请重试");
    }
  }, []);
  const loadChatModels = useCallback(async () => {
    setChatPricing(null);
    setChatModelError(null);
    try {
      const data = chatPricingSchema.parse(await getConversationPricing());
      if (mounted.current) setChatPricing(data);
    } catch {
      if (mounted.current)
        setChatModelError("聊天模型加载失败，暂不能发送，请重试");
    }
  }, []);
  useEffect(() => {
    setChatContext(null);
    setChatContextError(null);
    if (
      mode !== "chat" ||
      !activeId ||
      conversation?.id !== activeId ||
      !chatModel?.id
    ) {
      setChatContextLoading(false);
      return;
    }
    let current = true;
    setChatContextLoading(true);
    getChatContext(activeId, chatModel?.id)
      .then((data) => {
        if (current) setChatContext(data);
      })
      .catch(() => {
        if (current) setChatContextError("上下文状态暂时不可用");
      })
      .finally(() => {
        if (current) setChatContextLoading(false);
      });
    return () => {
      current = false;
    };
  }, [
    activeId,
    mode,
    conversation?.id,
    conversation?.messages.length,
    chatModel?.id,
  ]);
  const track = useCallback(
    (id: string) => {
      if (streams.current.has(id)) return;
      const close = subscribeGeneration(id, {
        onUpdate: (generation) => {
          if (!mounted.current) return;
          setGenerations((current) => ({ ...current, [id]: generation }));
          handleAgentGenerationUpdate(generation);
          if (!isActiveStatus(generation.status)) {
            refreshMe();
            void refreshThreads();
          }
        },
        onError: (_code, message) => {
          if (mounted.current)
            toast({
              title: "任务进度更新中断",
              description: message,
              variant: "danger",
            });
        },
        onClose: () => {
          streams.current.delete(id);
        },
      });
      streams.current.set(id, close);
    },
    [handleAgentGenerationUpdate, refreshMe, refreshThreads, toast],
  );

  const loadThread = useCallback(
    async (id: string) => {
      chatAbort.current?.abort();
      chatAbort.current = null;
      managedChatTurn.current = null;
      recoveryRequested.current = false;
      setManagedTurnId(null);
      setChatRecoverable(false);
      setChatConnection("connected");
      sendLock.current = false;
      setBusy(false);
      setStreaming(null);
      setPending(null);
      setStatus(null);
      const version = ++loadVersion.current;
      setActiveId(id);
      activeRef.current = id;
      setConversation(null);
      setAgentTurns([]);
      setActiveQuestion(null);
      setAgentQuality(null);
      setAgentQualityTarget(null);
      setAgentQualityError(null);
      setAgentQualityChecking(false);
      agentGenerationIds.current.clear();
      agentTerminalGenerationIds.current.clear();
      setThreadLoading(true);
      setThreadError(null);
      setSendError(null);
      setUsePrevious(true);
      try {
        const data = await getConversation(id);
        if (!mounted.current || version !== loadVersion.current) return;
        setConversation(data);
        const items = data.messages
          .map((message) => messageGeneration(message, id))
          .filter((item): item is Generation => Boolean(item));
        setGenerations((current) => ({
          ...current,
          ...Object.fromEntries(items.map((item) => [item.id, item])),
        }));
        items
          .filter((item) => isActiveStatus(item.status))
          .forEach((item) => track(item.id));
      } catch {
        if (mounted.current && version === loadVersion.current)
          setThreadError("这段对话暂时无法加载");
      } finally {
        if (mounted.current && version === loadVersion.current)
          setThreadLoading(false);
      }
    },
    [track],
  );

  const resumeChatTurn = useCallback(
    async (turn: ChatTurnView, userContent?: string) => {
      if (
        sendLock.current ||
        !mounted.current ||
        activeRef.current !== turn.conversationId
      )
        return;
      sendLock.current = true;
      const version = loadVersion.current;
      const controller = new AbortController();
      chatAbort.current = controller;
      managedChatTurn.current = turn;
      setManagedTurnId(turn.id);
      setMode("chat");
      setBusy(true);
      setStreaming("");
      setPending(null);
      setChatRecoverable(false);
      setSendError(null);
      setConversation((value) => mergeChatTurn(value, turn, userContent));
      const current = () =>
        mounted.current &&
        version === loadVersion.current &&
        activeRef.current === turn.conversationId;
      try {
        await followChatTurn(
          turn,
          {
            onTurn: (value) => {
              if (current()) {
                const changedAttempt =
                  managedChatTurn.current?.attemptId !== value.attemptId;
                managedChatTurn.current = value;
                setManagedTurnId(value.id);
                setConversation((previous) =>
                  mergeChatTurn(previous, value, userContent),
                );
                if (changedAttempt)
                  void getConversation(value.conversationId)
                    .then((history) => {
                      if (current() && managedChatTurn.current)
                        setConversation(
                          mergeChatTurn(
                            history,
                            managedChatTurn.current,
                            userContent,
                          ),
                        );
                    })
                    .catch(() => undefined);
              }
            },
            onDelta: () => undefined,
            onConnection: (value) => {
              if (current()) {
                setChatConnection(value);
                if (value === "disconnected") setChatRecoverable(true);
              }
            },
            onStatus: (value) => {
              if (current()) setStatus(value);
            },
            onContext: (value) => {
              if (current()) setChatContext(value);
            },
            onBilling: () => refreshMe(),
            onDone: () => undefined,
            onError: (value) => {
              if (current()) setSendError(value);
            },
          },
          controller.signal,
        );
        if (current()) {
          const history = await getConversation(turn.conversationId);
          if (current())
            setConversation(
              mergeChatTurn(
                history,
                managedChatTurn.current ?? turn,
                userContent,
              ),
            );
        }
        refreshMe();
        void refreshThreads();
      } catch (error) {
        if (current()) {
          const cleared = isApiError(error) && error.code === "CONTENT_CLEARED";
          setChatRecoverable(!cleared);
          if (cleared) {
            managedChatTurn.current = null;
            setManagedTurnId(null);
            try {
              if (userId)
                clearChatReceipt(userId, turn.conversationId, {
                  turnId: turn.id,
                });
            } catch {
              /* Keep the receipt if storage is unavailable. */
            }
            void getConversation(turn.conversationId)
              .then((history) => {
                if (current()) setConversation(history);
              })
              .catch(() => undefined);
          }
          setSendError(
            error instanceof Error
              ? error.message
              : "任务恢复失败，服务端结果已保留",
          );
        }
      } finally {
        if (chatAbort.current === controller) {
          chatAbort.current = null;
          sendLock.current = false;
          if (current()) {
            setBusy(false);
            setStreaming(null);
            setStatus(null);
            flushDeferredRecovery();
          }
        }
      }
    },
    [refreshMe, refreshThreads, userId, flushDeferredRecovery],
  );

  const durableChatEnabled = Boolean(chatPricing?.models.length);
  const recoverChat = useCallback(async () => {
    const id = activeRef.current;
    if (!id || !userId || sendLock.current) return;
    let receipt;
    try {
      receipt = readChatReceipt(userId, id);
    } catch (error) {
      if (modeRef.current === "chat") {
        setChatRecoverable(true);
        setSendError(
          error instanceof Error ? error.message : "无法读取发送凭据",
        );
      }
      return;
    }
    if (
      modeRef.current !== "chat" &&
      !receipt &&
      !conversationRef.current?.messages.some((message) => message.chatTurnId)
    )
      return;
    sendLock.current = true;
    const version = loadVersion.current;
    const current = () =>
      mounted.current &&
      activeRef.current === id &&
      loadVersion.current === version;
    setBusy(true);
    setSendError(null);
    try {
      const userContent =
        receipt?.pending?.kind === "create"
          ? receipt.pending.input.content
          : undefined;
      let turn = receipt?.pending
        ? await resolveChatSubmission(userId, id)
        : null;
      if (!turn) turn = await getActiveChatTurn(id);
      // A fresh history read closes the history/active=null completion race.
      const history = await getConversation(id);
      const knownId =
        history.messages.filter((message) => message.chatTurnId).at(-1)
          ?.chatTurnId ?? receipt?.turnId;
      if (!turn && knownId) turn = await getChatTurnSnapshot(knownId);
      if (!current()) return;
      setConversation(history);
      setChatRecoverable(false);
      sendLock.current = false;
      if (turn) await resumeChatTurn(turn, userContent);
    } catch (error) {
      if (current()) {
        const cleared = isApiError(error) && error.code === "CONTENT_CLEARED";
        setChatRecoverable(!cleared);
        if (cleared) {
          try {
            clearChatReceipt(userId, id, { turnId: receipt?.turnId });
          } catch {
            /* Storage can be unavailable. */
          }
          managedChatTurn.current = null;
          setManagedTurnId(null);
        }
        setSendError(
          error instanceof Error
            ? error.message
            : "回复恢复失败，发送凭据已保留",
        );
      }
    } finally {
      if (current() && !chatAbort.current) {
        sendLock.current = false;
        setBusy(false);
        flushDeferredRecovery();
      }
    }
  }, [userId, resumeChatTurn, flushDeferredRecovery]);
  useEffect(() => {
    recoveryAction.current = () => void recoverChat();
  }, [recoverChat]);
  useEffect(() => {
    if (
      !activeId ||
      conversation?.id !== activeId ||
      !durableChatEnabled ||
      !userId ||
      sendLock.current
    )
      return;
    void recoverChat();
  }, [
    activeId,
    conversation?.id,
    mode,
    durableChatEnabled,
    userId,
    recoverChat,
  ]);

  useEffect(() => {
    if (!activeId || !userId || !durableChatEnabled) return;
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      if (chatAbort.current || (sendLock.current && modeRef.current === "chat"))
        recoveryRequested.current = true;
      else void recoverChat();
    };
    const storage = (event: StorageEvent) => {
      if (event.key === chatReceiptKey(userId, activeId)) refresh();
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", storage);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", storage);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [activeId, userId, durableChatEnabled, recoverChat]);

  const retryChatTurn = async (
    id: string,
    expectedPreviousAttemptId: string,
  ) => {
    if (sendLock.current || !me || !activeId) return;
    const conversationId = activeId;
    const version = loadVersion.current;
    const current = () =>
      mounted.current &&
      activeRef.current === conversationId &&
      version === loadVersion.current;
    sendLock.current = true;
    setBusy(true);
    setSendError(null);
    try {
      prepareChatSubmission(me.id, activeId, () => ({
        kind: "retry",
        turnId: id,
        clientRequestId: crypto.randomUUID(),
        expectedPreviousAttemptId,
      }));
      const turn = await resolveChatSubmission(me.id, activeId);
      if (!current()) return;
      sendLock.current = false;
      if (turn) await resumeChatTurn(turn);
    } catch (error) {
      if (current()) {
        setChatRecoverable(
          !(isApiError(error) && error.code === "CONTENT_CLEARED"),
        );
        setSendError(error instanceof Error ? error.message : "重试失败");
      }
    } finally {
      if (current() && !chatAbort.current) {
        sendLock.current = false;
        setBusy(false);
      }
    }
  };

  useEffect(() => {
    mounted.current = true;
    refreshMe();
    void loadModels();
    void loadChatModels();
    const tracked = streams.current;
    return () => {
      mounted.current = false;
      chatAbort.current?.abort();
      loadVersion.current += 1;
      for (const close of tracked.values()) close();
      tracked.clear();
    };
  }, [loadModels, loadChatModels, refreshMe]);
  useEffect(() => {
    if (initialThreadId) void loadThread(initialThreadId);
  }, [initialThreadId, loadThread]);
  useEffect(() => {
    try {
      writeActiveConversationId(activeId);
    } catch {
      /* Storage is optional. */
    }
    const url = new URL(window.location.href);
    if (activeId) url.searchParams.set("thread", activeId);
    else url.searchParams.delete("thread");
    window.history.replaceState(window.history.state, "", url);
  }, [activeId]);

  const locked =
    busy ||
    chatCompacting ||
    planning ||
    quotingCreative ||
    references.uploading > 0 ||
    optimizing ||
    renaming ||
    archiving ||
    restoring;
  const selectThread = useCallback(
    (id: string) => {
      if (locked) return;
      externalDraft.current = false;
      closeMobile();
      void loadThread(id);
    },
    [locked, closeMobile, loadThread],
  );
  const newConversation = useCallback(() => {
    if (locked) return;
    externalDraft.current = false;
    loadVersion.current += 1;
    chatAbort.current?.abort();
    chatAbort.current = null;
    managedChatTurn.current = null;
    recoveryRequested.current = false;
    setManagedTurnId(null);
    setChatRecoverable(false);
    setChatConnection("connected");
    setActiveId(null);
    activeRef.current = null;
    setConversation(null);
    setThreadLoading(false);
    setThreadError(null);
    setSendError(null);
    setPrompt("");
    setCreative(EMPTY_CREATIVE_DRAFT);
    setAgentTurns([]);
    setActiveQuestion(null);
    setAgentQuality(null);
    setAgentQualityTarget(null);
    setAgentQualityError(null);
    setAgentQualityChecking(false);
    agentGenerationIds.current.clear();
    agentTerminalGenerationIds.current.clear();
    setPendingAgentInstruction(null);
    setParams((value) => ({ ...value, referenceImages: [] }));
    setUsePrevious(true);
    closeMobile();
    setFocusVersion((value) => value + 1);
    const url = new URL(window.location.href);
    for (const key of [
      "prompt",
      "negativePrompt",
      "reference",
      "modelName",
      "aspectRatio",
      "resolution",
      "seed",
    ])
      url.searchParams.delete(key);
    window.history.replaceState(window.history.state, "", url);
  }, [locked, closeMobile]);
  useEffect(() => {
    setStudioNavigation({
      activeId,
      disabled: locked,
      onSelect: selectThread,
      onNew: newConversation,
    });
    return () => setStudioNavigation(null);
  }, [activeId, locked, selectThread, newConversation, setStudioNavigation]);
  const latestImage = [...(conversation?.messages ?? [])]
    .reverse()
    .map((message) =>
      message.generationId && message.role === "assistant"
        ? (generations[message.generationId] ??
          messageGeneration(message, conversation!.id))
        : null,
    )
    .find((item) => item?.status === "SUCCEEDED" && item.images.length)
    ?.images[0];
  const autoReference: ReferenceItem | null =
    usePrevious &&
    !params.referenceImages.length &&
    latestImage &&
    inputModel?.capabilities.supportsReferenceImage &&
    inputModel.capabilities.maxReferenceImages > 0
      ? {
          kind: "source",
          key: latestImage.id,
          previewUrl: latestImage.thumbnailUrl || latestImage.url,
        }
      : null;
  const effectiveReferences = autoReference
    ? [autoReference]
    : params.referenceImages;

  const creativeReferences = [
    ...new Map(
      [
        ...params.referenceImages,
        ...(conversation?.messages ?? []).flatMap((message) => {
          const generation = message.generationId
            ? (generations[message.generationId] ??
              messageGeneration(message, conversation!.id))
            : null;
          return generation?.status === "SUCCEEDED"
            ? generation.images.map((image) => ({
                kind: "source" as const,
                key: image.id,
                previewUrl: image.thumbnailUrl || image.url,
              }))
            : [];
        }),
      ].map((reference) => [`${reference.kind}:${reference.key}`, reference]),
    ).values(),
  ];
  const activeGeneration = (conversation?.messages ?? []).some(
    (message) =>
      message.generationId &&
      isActiveStatus(
        generations[message.generationId]?.status ??
          message.generationStatus ??
          "SUCCEEDED",
      ),
  );
  const agentGeneration =
    Object.values(generations)
      .filter((generation) => agentGenerationIds.current.has(generation.id))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .at(-1) ?? null;
  const chatUnavailableReason = !chatModel
    ? (chatModelError ?? "正在加载聊天模型，暂不能发送")
    : effectiveReferences.length && !chatModel.supportsVision
      ? "当前聊天模型不支持参考图，请移除参考图或切换模型"
      : effectiveReferences.length > chatModel.maxReferenceImages
        ? `当前聊天模型最多使用 ${chatModel.maxReferenceImages} 张参考图，请移除多余参考图`
        : null;
  const disabledReason = chatRecoverable
    ? "请先恢复上次提交的结果"
    : chatCompacting
      ? "正在压缩上下文"
      : threadLoading
        ? "正在加载对话"
        : threadError
          ? "请先重新加载对话"
          : optimizing
            ? "正在优化提示词"
            : references.uploading
              ? "参考图上传中"
              : mode === "image" && !model?.available
                ? (modelError ?? "模型暂不可用")
                : mode === "image" && activeGeneration
                  ? "请等待当前图片生成完成"
                  : mode === "chat" && chatUnavailableReason
                    ? chatUnavailableReason
                    : !prompt.trim()
                      ? "请输入内容"
                      : null;

  const creativeDisabledReason =
    threadLoading || threadError
      ? "请先加载对话"
      : !model?.available
        ? (modelError ?? "模型暂不可用")
        : activeGeneration
          ? "请等待当前图片生成完成"
          : references.uploading
            ? "参考图上传中"
            : creative.baseReference &&
                !model.capabilities.supportsReferenceImage
              ? "当前模型不支持基图"
              : null;

  const plan = async () => {
    if (
      !prompt.trim() ||
      locked ||
      sendLock.current ||
      threadLoading ||
      threadError
    )
      return;
    sendLock.current = true;
    const revision = loadVersion.current;
    const answer = prompt.trim();
    const instruction = activeQuestion
      ? `正在回答的问题：${activeQuestion}\n用户回答：${answer}`
      : answer;
    const mentionsExistingImage =
      /(上一张|刚才|这张|当前图|原图|基图|参考图|在图上|图中|保留原)/.test(
        answer,
      );
    const implicitBaseReference =
      creative.baseReference ??
      (mentionsExistingImage
        ? (params.referenceImages[0] ?? autoReference)
        : null);
    const inspectionReference = implicitBaseReference
      ? (creativeReferences.find(
          (reference) =>
            reference.kind === implicitBaseReference.kind &&
            reference.key === implicitBaseReference.key,
        ) ?? null)
      : null;
    setPlanning(true);
    setPendingAgentInstruction(answer);
    setSendError(null);
    setAgentToolStatus(null);
    try {
      let referenceSummary = "";
      if (inspectionReference) {
        const cacheKey = `${inspectionReference.kind}:${inspectionReference.key}`;
        referenceSummary = referenceInsightCache.current.get(cacheKey) ?? "";
        if (!referenceSummary) {
          setAgentToolStatus("Agent 正在读取参考图…");
          try {
            const insight = await inspectCreativeReferences(
              referenceRequest([inspectionReference]),
            );
            referenceSummary = insight.referenceSummary;
            referenceInsightCache.current.set(cacheKey, referenceSummary);
          } catch (error) {
            if (mounted.current && revision === loadVersion.current) {
              // Text-only models can still plan, but transport and reference errors must be visible.
              setSendError(referenceInspectionErrorMessage(error));
            }
          }
        }
      }
      setAgentToolStatus("Agent 正在整理创作方案…");
      const result = await planCreativeBrief({
        instruction,
        brief: creative.brief,
        locked: creative.locked,
        hasBase: Boolean(implicitBaseReference),
        referenceSummary,
        history: agentTurns.slice(-12).map(({ role, content }) => ({
          role,
          content: content.slice(0, 1200),
        })),
      });
      if (!mounted.current || revision !== loadVersion.current) return;
      const nextBrief = mergeCreativeBrief(
        creative.brief,
        result.brief,
        creative.locked,
      );
      setCreative((current) => ({
        ...current,
        operationId: null,
        brief: mergeCreativeBrief(current.brief, result.brief, current.locked),
        questions: result.questions,
        baseReference:
          current.baseReference ??
          (implicitBaseReference
            ? {
                kind: implicitBaseReference.kind,
                key: implicitBaseReference.key,
              }
            : null),
      }));
      setAgentTurns((current) => [
        ...current,
        {
          id: `agent-user-${Date.now()}`,
          role: "user",
          content: answer,
        },
        {
          id: `agent-assistant-${Date.now() + 1}`,
          role: "assistant",
          content:
            result.message?.trim() ||
            (result.questions.length
              ? `我先整理了当前方向，还需要你确认 ${result.questions.length} 个细节。`
              : `我先整理好了：${nextBrief.goal.trim()}`),
        },
      ]);
      setPrompt((current) => (current.trim() === answer ? "" : current));
      setActiveQuestion(null);
    } catch (error) {
      if (mounted.current && revision === loadVersion.current)
        setSendError(
          error instanceof Error ? error.message : "方案整理失败，原方案已保留",
        );
    } finally {
      sendLock.current = false;
      if (mounted.current) {
        setPlanning(false);
        setPendingAgentInstruction(null);
        setAgentToolStatus(null);
      }
    }
  };

  const compactContext = async () => {
    if (!activeId || !chatModel || locked || sendLock.current) return;
    sendLock.current = true;
    setChatCompacting(true);
    setChatContextError(null);
    try {
      const result = await compactChatContext(activeId, chatModel.id);
      if (mounted.current) setChatContext(result);
    } catch (error) {
      if (mounted.current)
        setChatContextError(
          error instanceof Error ? error.message : "压缩失败，历史记录已保留",
        );
    } finally {
      sendLock.current = false;
      if (mounted.current) setChatCompacting(false);
    }
  };

  const send = async (confirmed?: CreateGenerationInput): Promise<boolean> => {
    const content = confirmed?.prompt ?? prompt.trim();
    if (
      !content ||
      (confirmed ? creativeDisabledReason : disabledReason) ||
      (!confirmed && mode === "chat" && !chatModel) ||
      sendLock.current
    )
      return false;
    if (mode === "chat" && !confirmed && userId && activeId) {
      try {
        if (readChatReceipt(userId, activeId)?.pending) {
          await recoverChat();
          return false;
        }
      } catch (error) {
        setChatRecoverable(true);
        setSendError(
          error instanceof Error ? error.message : "无法读取发送凭据",
        );
        return false;
      }
    }
    sendLock.current = true;
    const revision = ++loadVersion.current;
    const isNew = !conversation;
    setBusy(true);
    setPending(content);
    setSendError(null);
    const submittedReferences = confirmed
      ? creativeReferences.filter(
          (reference) =>
            reference.kind === confirmed.creative?.baseReference?.kind &&
            reference.key === confirmed.creative.baseReference.key,
        )
      : effectiveReferences;
    let current = conversation;
    try {
      if (!current) {
        setStatus("正在创建对话…");
        current = await createConversation({ title: content.slice(0, 28) });
        if (!mounted.current) return false;
        if (confirmed && me) {
          try {
            sessionStorage.setItem(
              "chugao.agent-turns.v1." + me.id + "." + current.id,
              JSON.stringify(agentTurns),
            );
          } catch {
            /* Storage is optional. */
          }
        }
        setConversation(current);
        setActiveId(current.id);
        activeRef.current = current.id;
        void refreshThreads();
      }
      const id = current.id;
      const messages: ChatMessageInput[] = [
        ...current.messages.slice(-39).map((message) => ({
          role: message.role,
          content: message.content.slice(0, 4000),
          generationId: message.generationId,
        })),
        { role: "user", content },
      ];
      if (mode === "chat" && !confirmed) {
        if (!userId) throw new Error("登录信息尚未恢复，暂未提交任务");
        setStatus(null);
        setStreaming("");
        setManagedTurnId(null);
        setChatConnection("connected");
        const controller = new AbortController();
        chatAbort.current = controller;
        let streamError = "";
        const currentChat = () =>
          mounted.current &&
          revision === loadVersion.current &&
          activeRef.current === id;
        await streamManagedChat({
          userId,
          content,
          conversationId: id,
          webSearch: Boolean(chatModel?.supportsWebSearch),
          modelId: chatModel!.id,
          reasoningEffort,
          ...referenceRequest(submittedReferences),
          references: submittedReferences.map((reference, index) =>
            reference.kind === "upload"
              ? {
                  kind: "upload" as const,
                  key: reference.key,
                  label: `图${index + 1}`,
                }
              : {
                  kind: "generated" as const,
                  id: reference.key,
                  label: `图${index + 1}`,
                },
          ),
          signal: controller.signal,
          handlers: {
            onTurn: (turn) => {
              if (currentChat()) {
                const changedAttempt =
                  managedChatTurn.current?.id === turn.id &&
                  managedChatTurn.current.attemptId !== turn.attemptId;
                managedChatTurn.current = turn;
                setManagedTurnId(turn.id);
                setPending(null);
                setConversation((value) => mergeChatTurn(value, turn, content));
                if (changedAttempt)
                  void getConversation(id)
                    .then((history) => {
                      if (currentChat() && managedChatTurn.current)
                        setConversation(
                          mergeChatTurn(
                            history,
                            managedChatTurn.current,
                            content,
                          ),
                        );
                    })
                    .catch(() => undefined);
              }
            },
            onConnection: (value) => {
              if (currentChat()) {
                setChatConnection(value);
                if (value === "disconnected") setChatRecoverable(true);
              }
            },
            onStatus: (message) => {
              if (currentChat()) setStatus(message);
            },
            onContext: (context) => {
              if (currentChat()) setChatContext(context);
            },
            onDelta: () => undefined,
            onBilling: (event) => {
              if (currentChat())
                setMe((value) =>
                  value ? { ...value, credits: event.balance } : value,
                );
            },
            onDone: () => undefined,
            onError: (message) => {
              streamError = message;
            },
          },
        });
        if (!currentChat()) return false;
        const history = await getConversation(id);
        if (!currentChat()) return false;
        setConversation(
          managedChatTurn.current
            ? mergeChatTurn(history, managedChatTurn.current, content)
            : history,
        );
        refreshMe();
        if (streamError) setSendError(streamError);
      } else {
        if (!model) return false;
        let generationPrompt = content;
        let assistantMessage = confirmed
          ? "按已确认的创作方案生成"
          : "正在生成图片";
        let shouldGenerate = true;
        if (current.messages.length && !confirmed) {
          setStatus("正在整理画面要求…");
          const compiled = await compileConversationPrompt({
            modelId: model.id,
            messages,
          });
          generationPrompt = compiled.prompt;
          assistantMessage = compiled.assistantMessage;
          shouldGenerate = compiled.shouldGenerate;
        }
        if (!mounted.current) return false;
        if (!shouldGenerate) {
          setSendError(assistantMessage || "请补充画面要求后再生成");
          return false;
        } else {
          setStatus("正在提交生成…");
          const result = await createGeneration({
            modelId: model.id,
            prompt: generationPrompt,
            conversationId: id,
            userMessage: content,
            assistantMessage: assistantMessage.slice(0, 400),
            n: params.n,
            size: params.size,
            quality: params.quality,
            outputFormat: params.outputFormat,
            ...(model.capabilities.supportsNegativePrompt
              ? { negativePrompt: params.negativePrompt }
              : {}),
            ...(model.capabilities.supportsSeed ? { seed: params.seed } : {}),
            ...referenceRequest(submittedReferences),
            ...confirmed,
          });
          if (!mounted.current) return false;
          if (confirmed) {
            agentGenerationIds.current.add(result.generationId);
            setCreative((value) => ({ ...value, operationId: null }));
            setAgentTurns((current) => [
              ...current,
              {
                id: `agent-submit-${result.generationId}`,
                role: "assistant",
                content: isActiveStatus(result.status)
                  ? "已提交生成。任务完成后我会自动把结果接回当前方案，你可以继续用自然语言描述下一步修改。"
                  : "已收到生成结果，正在把它接回当前方案。",
              },
            ]);
          }
          const terminal = !isActiveStatus(result.status);
          if (terminal && result.status !== "SUCCEEDED") {
            setSendError(
              "这次生成未完成，请查看任务状态后再决定是否重新生成。",
            );
          } else {
            toast({
              title:
                result.status === "SUCCEEDED" ? "生成已完成" : "已提交生成",
              description: `本次预计消耗 ${result.estimatedCredits} 积分`,
              variant: "success",
            });
          }
          const createdAt = new Date().toISOString();
          const reply = {
            id: "generation-" + result.generationId,
            role: "assistant" as const,
            content: assistantMessage,
            generationId: result.generationId,
            generationPrompt,
            generationStatus: result.status,
            generationProgress: 0,
            generationModelId: model.id,
            generationSize: params.size ?? model.defaults.size,
            generationCount: confirmed ? 1 : params.n,
            createdAt,
          };
          const alreadyShown = current.messages.some(
            (message) => message.generationId === result.generationId,
          );
          if (!alreadyShown) {
            setConversation({
              ...current,
              messages: [
                ...current.messages,
                {
                  id: "user-" + result.generationId,
                  role: "user",
                  content,
                  createdAt,
                },
                reply,
              ],
            });
          }
          if (!alreadyShown)
            setGenerations((items) => ({
              ...items,
              [result.generationId]: messageGeneration(reply, id)!,
            }));
          if (!terminal) track(result.generationId);
          // A refresh failure must never turn an accepted, billed task into a retry.
          void getConversation(id)
            .then((data) => {
              if (
                mounted.current &&
                activeRef.current === id &&
                loadVersion.current === revision
              )
                setConversation(data);
              const refreshed = data.messages
                .map((message) => messageGeneration(message, id))
                .find((item) => item?.id === result.generationId);
              if (refreshed) {
                setGenerations((items) => ({
                  ...items,
                  [refreshed.id]: refreshed,
                }));
                handleAgentGenerationUpdate(refreshed);
              }
            })
            .catch(() => undefined);
          refreshMe();
          if (confirmed) {
            setCreative((value) => ({ ...value, operationId: null }));
          }
        }
      }
      setPrompt((value) => (value.trim() === content ? "" : value));
      if (mode === "image" || confirmed) {
        setParams((value) => ({
          ...value,
          referenceImages: value.referenceImages.filter(
            (item) =>
              !submittedReferences.some(
                (submitted) =>
                  submitted.kind === item.kind && submitted.key === item.key,
              ),
          ),
        }));
      }
      setUsePrevious(true);
      if (isNew && me) {
        try {
          sessionStorage.removeItem(
            "chugao.dialogue-draft.v1." + me.id + ".new",
          );
          sessionStorage.removeItem(
            "chugao.creative-draft.v1." + me.id + ".new",
          );
          sessionStorage.removeItem("chugao.agent-turns.v1." + me.id + ".new");
        } catch {
          /* Storage is optional. */
        }
      }
      void refreshThreads();
      return true;
    } catch (error) {
      if (mounted.current && revision === loadVersion.current) {
        if (mode === "chat" && !confirmed) {
          const cleared = isApiError(error) && error.code === "CONTENT_CLEARED";
          setChatRecoverable(!cleared);
          if (cleared) {
            const turnId = managedChatTurn.current?.id;
            managedChatTurn.current = null;
            setManagedTurnId(null);
            try {
              if (userId && activeRef.current)
                clearChatReceipt(userId, activeRef.current, {
                  turnId,
                });
            } catch {
              /* Storage can be unavailable. */
            }
          }
        }
        setSendError(
          error instanceof Error ? error.message : "发送失败，请重试",
        );
        setPrompt((value) => value || content);
        setParams((value) => ({
          ...value,
          referenceImages: value.referenceImages.length
            ? value.referenceImages
            : submittedReferences,
        }));
      }
      return false;
    } finally {
      if (revision === loadVersion.current) {
        sendLock.current = false;
        chatAbort.current = null;
        if (mounted.current) {
          setBusy(false);
          setPending(null);
          setStreaming(null);
          setStatus(null);
          flushDeferredRecovery();
        }
      }
    }
  };

  const handleUsePrompt = (text: string) => {
    setPrompt(text);
    setFocusVersion((value) => value + 1);
  };
  const addReference = (reference: ReferenceItem) => {
    if (references.add(reference)) {
      setUsePrevious(false);
      setMode("image");
      setFocusVersion((value) => value + 1);
    }
  };
  const handleUseAsReference = (generation: Generation) => {
    const image = generation.images[0];
    if (image)
      addReference({
        kind: "source",
        key: image.id,
        previewUrl: image.thumbnailUrl || image.url,
      });
  };
  const retry = async (generation: Generation) => {
    if (locked) return;
    setRestoring(true);
    try {
      const previous = await getGenerationForRetry(generation.id);
      if (
        !models.some((item) => item.id === previous.modelId && item.available)
      )
        throw new Error("原模型当前不可用");
      setMode("image");
      setUsePrevious(false);
      setModelId(previous.modelId);
      handleUsePrompt(previous.prompt);
      setParams({
        n: previous.n,
        size: previous.size ?? undefined,
        negativePrompt: previous.negativePrompt ?? undefined,
        seed: previous.seed ?? undefined,
        outputFormat: previous.outputFormat ?? undefined,
        referenceImages: previous.retryReferences,
      });
    } catch (error) {
      toast({
        title: "无法还原生成参数",
        description: error instanceof Error ? error.message : "请重试",
        variant: "danger",
      });
    } finally {
      setRestoring(false);
    }
  };
  const cancel = async (id: string) => {
    try {
      await cancelGeneration(id);
      setGenerations((items) =>
        items[id]
          ? { ...items, [id]: { ...items[id], status: "CANCELED" } }
          : items,
      );
      streams.current.get(id)?.();
      refreshMe();
    } catch (error) {
      toast({
        title: "取消失败",
        description: error instanceof Error ? error.message : "请重试",
        variant: "danger",
      });
    }
  };
  const optimize = async () => {
    if (locked || !prompt.trim()) return;
    const content = prompt;
    setOptimizing(true);
    try {
      const result = await optimizePrompt(content);
      setPrompt((value) => (value === content ? result.prompt : value));
    } catch (error) {
      toast({
        title: "优化失败",
        description: error instanceof Error ? error.message : "请重试",
        variant: "danger",
      });
    } finally {
      setOptimizing(false);
    }
  };
  const archive = async () => {
    if (!activeId || locked) return;
    setArchiving(true);
    try {
      await updateConversation(activeId, { archived: true });
      newConversation();
      void refreshThreads();
    } catch {
      toast({ title: "归档失败", variant: "danger" });
    } finally {
      setArchiving(false);
    }
  };
  const saveTitle = async () => {
    if (!activeId || !rename?.trim() || renaming) return;
    setRenaming(true);
    try {
      const data = await updateConversation(activeId, { title: rename.trim() });
      setConversation(data);
      setRename(null);
      void refreshThreads();
    } catch {
      toast({ title: "重命名失败", variant: "danger" });
    } finally {
      setRenaming(false);
    }
  };
  const empty =
    !conversation?.messages.length &&
    !pending &&
    !threadLoading &&
    !threadError;

  return (
    <div className="flex h-full min-h-0 min-w-0 bg-background">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <TopBar
          me={me}
          model={model}
          title={conversation?.title ?? "创作工作台"}
          leading={<WorkspaceSidebarToggle />}
        />
        {conversation ? (
          <div className="flex h-11 shrink-0 items-center justify-end gap-3 px-5">
            <CopyTextButton
              label="复制整段对话"
              text={conversation.messages
                .map(
                  (message) =>
                    (message.role === "user" ? "我：\n" : "助手：\n") +
                    message.content +
                    (message.generationPrompt
                      ? "\n提示词：\n" + message.generationPrompt
                      : ""),
                )
                .join("\n\n")}
            />
            <DropdownMenu
              trigger={
                <IconButton
                  variant="ghost"
                  aria-label="对话操作"
                  title="对话操作"
                  disabled={locked}
                  className="h-9 w-9 rounded-full text-text-muted"
                >
                  <MoreHorizontal size={18} />
                </IconButton>
              }
            >
              <DropdownMenuItem
                className="h-11"
                onClick={() => setRename(conversation.title)}
              >
                <Pencil size={16} />
                重命名对话
              </DropdownMenuItem>
              <DropdownMenuItem className="h-11" onClick={() => void archive()}>
                <Archive size={16} />
                归档对话
              </DropdownMenuItem>
              <DropdownMenuItem className="h-11" onClick={newConversation}>
                <SquarePen size={16} />
                新对话
              </DropdownMenuItem>
            </DropdownMenu>
          </div>
        ) : null}
        {modelError && mode !== "chat" ? (
          <div
            role="alert"
            className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-2 text-sm text-danger"
          >
            {modelError}
            <Button variant="ghost" size="sm" onClick={() => void loadModels()}>
              重试
            </Button>
          </div>
        ) : null}
        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col",
            empty && "overflow-y-auto",
          )}
        >
          {threadLoading || threadError ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 text-sm text-text-muted">
              <p role={threadError ? "alert" : "status"}>
                {threadError ?? "正在加载对话…"}
              </p>
              {threadError && activeId ? (
                <Button
                  variant="secondary"
                  onClick={() => void loadThread(activeId)}
                >
                  重新加载
                </Button>
              ) : null}
            </div>
          ) : mode === "agent" ? (
            <div className="min-h-0 flex-1 overflow-y-auto px-4 md:px-6 lg:px-8">
              <CreativeBriefPanel
                draft={creative}
                onChange={setCreative}
                turns={agentTurns}
                pendingInstruction={pendingAgentInstruction}
                agentToolStatus={agentToolStatus}
                onSuggestion={(text) => {
                  setActiveQuestion(text);
                  setPrompt("");
                  setFocusVersion((value) => value + 1);
                }}
                onContinue={(text) => {
                  setActiveQuestion(null);
                  if (text) setPrompt(text);
                  setFocusVersion((value) => value + 1);
                }}
                references={creativeReferences}
                model={model}
                params={params}
                busy={locked}
                disabledReason={creativeDisabledReason}
                errorMessage={sendError}
                onBusyChange={setQuotingCreative}
                onConfirm={send}
                agentGeneration={agentGeneration}
                qualityCheck={agentQuality}
                qualityChecking={agentQualityChecking}
                qualityError={agentQualityError}
                onRecheckQuality={() => {
                  if (agentQualityTarget)
                    void runAgentQualityCheck(
                      agentQualityTarget,
                      creative.brief,
                    );
                }}
              />
            </div>
          ) : empty ? (
            <>
              <div aria-hidden className="min-h-5 flex-[0.6] sm:min-h-6" />
              <div className="shrink-0 px-4 pb-7 md:px-6 lg:px-8">
                <div className="mx-auto w-full max-w-[52rem]">
                  {mode === "chat" ? (
                    <StudioGreeting />
                  ) : (
                    <h1 className="text-center text-2xl font-medium leading-9 tracking-normal sm:text-[26px] sm:leading-10">
                      今天，想创作什么？
                    </h1>
                  )}
                </div>
              </div>
            </>
          ) : (
            <ConversationTimelineV8
              conversation={conversation}
              generations={generations}
              models={models}
              pending={pending}
              streaming={streaming}
              status={status}
              managedTurnId={managedTurnId}
              connection={chatConnection}
              disabled={locked}
              onEdit={handleUsePrompt}
              onReference={handleUseAsReference}
              onOpen={(generation, index) => setLightbox({ generation, index })}
              onRetry={(generation) => void retry(generation)}
              onCancel={(id) => void cancel(id)}
              onRetryChat={(id, attemptId) => void retryChatTurn(id, attemptId)}
            />
          )}
          <div
            className={cn(
              "shrink-0 px-3 pb-[max(1rem,env(safe-area-inset-bottom))] md:px-6 lg:px-8",
              !empty && mode !== "agent" && "max-h-[60%] overflow-y-auto pt-2",
              mode === "agent" && "max-h-[55%] overflow-y-auto pt-2",
            )}
          >
            <div
              className={cn(
                "mx-auto w-full",
                mode === "chat" ? "max-w-[46rem]" : "max-w-[52rem]",
              )}
            >
              {sendError ? (
                <p
                  role="alert"
                  className="mb-3 whitespace-pre-wrap break-words text-sm leading-6 text-danger"
                >
                  {sendError}
                </p>
              ) : null}
              {chatRecoverable ? (
                <Button
                  variant="secondary"
                  size="sm"
                  className="mb-3 gap-2"
                  disabled={busy}
                  onClick={() => void recoverChat()}
                >
                  <RotateCcw size={15} />
                  恢复连接
                </Button>
              ) : null}
              <CommandDock
                prompt={prompt}
                onPromptChange={setPrompt}
                agentQuestion={activeQuestion}
                onClearAgentQuestion={() => setActiveQuestion(null)}
                models={models}
                model={model}
                onSelectModel={(id) => {
                  const next = models.find((item) => item.id === id);
                  setModelId(id);
                  setCreative((value) => ({ ...value, operationId: null }));
                  if (next)
                    setParams((value) => ({
                      ...value,
                      size: next.capabilities.sizes.includes(value.size ?? "")
                        ? value.size
                        : next.defaults.size,
                      quality: next.capabilities.qualities?.includes(
                        value.quality ?? "",
                      )
                        ? value.quality
                        : next.defaults.quality,
                      n: Math.min(value.n, next.capabilities.maxN),
                      referenceImages: next.capabilities.supportsReferenceImage
                        ? value.referenceImages.slice(
                            0,
                            next.capabilities.maxReferenceImages,
                          )
                        : [],
                    }));
                }}
                params={{
                  ...params,
                  n: mode === "agent" ? 1 : params.n,
                  referenceImages:
                    mode === "agent"
                      ? params.referenceImages
                      : effectiveReferences,
                }}
                onParamsChange={(patch) => {
                  setParams((value) => ({ ...value, ...patch }));
                  setCreative((value) => ({ ...value, operationId: null }));
                }}
                busy={
                  busy ||
                  chatCompacting ||
                  planning ||
                  quotingCreative ||
                  threadLoading ||
                  archiving ||
                  renaming ||
                  restoring
                }
                optimizing={optimizing}
                onOptimize={() => void optimize()}
                uploading={references.uploading}
                focusVersion={focusVersion}
                onUploadFile={(file) => void references.upload(file)}
                onAddReference={references.add}
                onRemoveReference={(key) => {
                  if (autoReference?.key === key) setUsePrevious(false);
                  setParams((value) => ({
                    ...value,
                    referenceImages: value.referenceImages.filter(
                      (item) => item.key !== key,
                    ),
                  }));
                }}
                onSubmit={() => {
                  if (mode === "agent") {
                    void plan();
                  } else if (mode === "image") {
                    // 在 image 模式下，普通发送切换到 chat 对话，不触发生图
                    setMode("chat");
                    void send();
                  } else {
                    void send();
                  }
                }}
                onGenerateImage={
                  mode === "image" || mode === "chat"
                    ? () => {
                        // 强制走 image 生成分支：先更新 ref（send() 读 modeRef），再调用
                        modeRef.current = "image";
                        setMode("image");
                        void send();
                      }
                    : undefined
                }
                disabledReason={disabledReason}
                mode={mode}
                creativeEnabled={creativeEnabled}
                centered={empty}
                onModeChange={setMode}
                chatModels={chatPricing?.models ?? []}
                chatModel={chatModel}
                chatReasoningEffort={reasoningEffort}
                chatTools={
                  mode === "chat" ? (
                    <>
                      <ChatContextControl
                        modelId={chatModel?.id}
                        status={chatContext}
                        loading={chatContextLoading}
                        compacting={chatCompacting}
                        disabled={locked || !activeId || !chatModel}
                        error={chatContextError}
                        onCompact={() => void compactContext()}
                      />
                      {me?.role === "ADMIN" ? <Button variant="ghost" size="sm" asChild><Link href="/app/research" onClick={() => { const refs = referenceRequest(effectiveReferences); sessionStorage.setItem("chugao.research.seed.v1", JSON.stringify({ question: prompt, conversationId: activeId ?? undefined, attachmentKeys: refs.referenceImageKeys ?? [], sourceImageIds: refs.sourceImageIds ?? [], modelId: chatModel?.id, reasoningEffort })); }}><Search size={15} />研究</Link></Button> : null}
                    </>
                  ) : undefined
                }
                onSelectChatModel={(id) => {
                  if (!chatPricing?.models.some((item) => item.id === id))
                    return;
                  setChatModelId(id);
                  setChatReasoningEffort(undefined);
                }}
                onChatReasoningEffortChange={(effort) => {
                  if (!chatModel?.reasoningEfforts.includes(effort)) return;
                  setChatModelId(chatModel.id);
                  setChatReasoningEffort(effort);
                }}
                chatUnavailableReason={chatUnavailableReason}
                onRetryChatModels={
                  chatModelError ? () => void loadChatModels() : undefined
                }
                onStop={
                  managedTurnId !== null &&
                  managedChatTurn.current &&
                  !chatIsTerminal(managedChatTurn.current.status)
                    ? () => {
                        const turn = managedChatTurn.current;
                        if (turn)
                          void cancelManagedChat(turn.id, turn.attemptId)
                            .then((value) => {
                              // The next snapshot/event is authoritative, not the delayed cancel response.
                              if (
                                activeRef.current === value.conversationId &&
                                !chatAbort.current
                              )
                                void recoverChat();
                            })
                            .catch((error) =>
                              setSendError(
                                error instanceof Error
                                  ? error.message
                                  : "停止失败，请重试",
                              ),
                            );
                      }
                    : undefined
                }
              />
            </div>
          </div>
          {empty && mode === "image" ? (
            <div className="shrink-0 px-3 md:px-6 lg:px-8">
              <CreationStarters
                disabled={locked}
                onSelect={(text) => {
                  setPrompt((value) =>
                    (value.trim() ? `${value}\n\n${text}` : text).slice(
                      0,
                      4000,
                    ),
                  );
                  setFocusVersion((value) => value + 1);
                }}
              />
            </div>
          ) : null}
          {empty && mode !== "agent" ? (
            <div aria-hidden className="min-h-6 flex-1" />
          ) : null}
        </div>
      </div>
      <Dialog
        open={rename !== null}
        onOpenChange={(open) => {
          if (!open && !renaming) setRename(null);
        }}
      >
        <DialogContent aria-describedby={undefined} className="space-y-4 p-5">
          <DialogTitle>重命名对话</DialogTitle>
          <Input
            aria-label="对话名称"
            value={rename ?? ""}
            onChange={(event) => setRename(event.target.value)}
            maxLength={80}
          />
          <div className="flex justify-end">
            <Button
              disabled={!rename?.trim()}
              loading={renaming}
              onClick={() => void saveTitle()}
            >
              保存
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {lightbox ? (
        <Lightbox
          state={lightbox}
          onClose={() => setLightbox(null)}
          onNavigate={(index) =>
            setLightbox((value) => (value ? { ...value, index } : value))
          }
          onUsePrompt={(text) => {
            handleUsePrompt(text);
            setMode("image");
            setLightbox(null);
          }}
          onUseAsReference={(image) => {
            if (image.id)
              addReference({
                kind: "source",
                key: image.id,
                previewUrl: image.url ?? "",
              });
            setLightbox(null);
          }}
        />
      ) : null}
    </div>
  );
}
