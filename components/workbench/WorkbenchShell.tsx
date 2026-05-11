"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MessageSquarePlus,
  Settings,
  SlidersHorizontal,
} from "lucide-react";

import { ActionableStatus } from "@/components/shared/ActionableStatus";
import { friendlyErrorMessage } from "@/components/shared/error-copy";
import { Canvas } from "@/components/workbench/Canvas";
import { ConversationThread } from "@/components/workbench/ConversationThread";
import { CostPreview } from "@/components/workbench/CostPreview";
import {
  DynamicParamsPanel,
  normalizeWorkbenchState,
} from "@/components/workbench/DynamicParamsPanel";
import { ModelSelector } from "@/components/workbench/ModelSelector";
import { PromptInput } from "@/components/workbench/PromptInput";
import { generationStatusLabel } from "@/components/workbench/status";
import type {
  WorkbenchGeneration,
  WorkbenchState,
  WorkbenchTaskStatus,
  UploadedReferenceImage,
} from "@/components/workbench/types";
import type {
  ConversationMessage,
  ConversationSummaryView,
  ConversationView,
} from "@/lib/conversation";
import { estimateCost } from "@/lib/credits";
import type { AspectRatio, PublicModelDefinition } from "@/lib/models/types";
import {
  readWorkbenchPreferences,
  writeWorkbenchPreferences,
  type WorkbenchPreferences,
} from "@/lib/workbench-preferences";

type ApiResponse<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        details?: unknown;
      };
    };

class ClientApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = "ClientApiError";
    this.code = code;
    this.status = status;
  }
}

type UserView = {
  id: string;
  credits: number;
};

type GenerationListView = {
  items: WorkbenchGeneration[];
  nextCursor: string | null;
};

type ConversationListView = {
  items: ConversationSummaryView[];
};

type UploadedReferenceImageView = Omit<UploadedReferenceImage, "previewUrl">;

const WELCOME_MESSAGE: ConversationMessage = {
  id: "welcome",
  role: "assistant",
  content: "你想先做哪张图？直接描述目标画面，也可以连续补充修改要求。",
  createdAt: new Date().toISOString(),
};
const DEFAULT_MODEL_ID = "gpt-image-2";
const WORKBENCH_STATUS_LABEL: Record<WorkbenchTaskStatus, string> = {
  idle: "可输入",
  pending: "排队中",
  running: "生成中",
  succeeded: "已完成",
  failed: "失败",
  canceled: "已取消",
};

function createMessage(
  role: ConversationMessage["role"],
  content: string,
): ConversationMessage {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.random()}`,
    role,
    content,
    createdAt: new Date().toISOString(),
  };
}

function conversationTitleFromText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "新的创作对话";
  }

  return normalized.length > 28 ? `${normalized.slice(0, 28)}...` : normalized;
}

function statusFromGeneration(status: string): WorkbenchTaskStatus {
  if (status === "PENDING") {
    return "pending";
  }

  if (status === "RUNNING") {
    return "running";
  }

  if (status === "SUCCEEDED") {
    return "succeeded";
  }

  if (status === "FAILED") {
    return "failed";
  }

  if (status === "CANCELED") {
    return "canceled";
  }

  return "idle";
}

function initialStateFor(
  model: PublicModelDefinition,
  preferences: WorkbenchPreferences = {},
): WorkbenchState {
  return {
    modelId: model.id,
    aspectRatio:
      preferences.aspectRatio &&
      model.capabilities.aspectRatios.includes(preferences.aspectRatio as never)
        ? preferences.aspectRatio
        : model.defaults.aspectRatio,
    resolution:
      preferences.resolution &&
      model.capabilities.resolutions.includes(preferences.resolution as never)
        ? (preferences.resolution as WorkbenchState["resolution"])
        : model.defaults.resolution,
    n: 1,
    outputFormat: model.defaults.outputFormat,
    background: model.defaults.background,
    outputCompression: model.defaults.outputCompression,
    referenceImageKeys: [],
  };
}

async function readApiResponse<T>(
  response: Response,
  fallback: string,
): Promise<T> {
  let payload: ApiResponse<T>;

  try {
    payload = (await response.json()) as ApiResponse<T>;
  } catch {
    throw new ClientApiError(
      friendlyErrorMessage({ code: "SERVICE_UNAVAILABLE" }, fallback),
      "SERVICE_UNAVAILABLE",
      response.status,
    );
  }

  if (!payload.ok) {
    throw new ClientApiError(
      friendlyErrorMessage(payload.error, fallback),
      payload.error.code,
      response.status,
    );
  }

  return payload.data;
}

function isClientApiError(error: unknown): error is ClientApiError {
  return error instanceof ClientApiError;
}

function isUnauthorizedError(error: unknown): boolean {
  return (
    isClientApiError(error) &&
    (error.status === 401 || error.code === "UNAUTHORIZED")
  );
}

function isMissingConversationError(error: unknown): boolean {
  return (
    isClientApiError(error) &&
    (error.status === 404 ||
      error.code === "NOT_FOUND" ||
      error.code === "CONVERSATION_NOT_FOUND")
  );
}

export function WorkbenchShell({
  initialConversationId = null,
}: {
  initialConversationId?: string | null;
}) {
  const router = useRouter();
  const requestedConversationId = initialConversationId;
  const [models, setModels] = useState<PublicModelDefinition[]>([]);
  const [state, setState] = useState<WorkbenchState | null>(null);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<WorkbenchTaskStatus>("idle");
  const [credits, setCredits] = useState(0);
  const [history, setHistory] = useState<WorkbenchGeneration[]>([]);
  const [conversations, setConversations] = useState<ConversationSummaryView[]>(
    [],
  );
  const [conversationId, setConversationId] = useState<string | null>(
    requestedConversationId,
  );
  const [conversationTitle, setConversationTitle] = useState("新的创作对话");
  const [activeGeneration, setActiveGeneration] =
    useState<WorkbenchGeneration | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([
    WELCOME_MESSAGE,
  ]);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploadingReference, setIsUploadingReference] = useState(false);
  const [referenceUploadError, setReferenceUploadError] = useState<
    string | null
  >(null);
  const [uploadedReferenceImages, setUploadedReferenceImages] = useState<
    UploadedReferenceImage[]
  >([]);
  const [useCurrentImageAsReference, setUseCurrentImageAsReference] =
    useState(true);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [conversationError, setConversationError] = useState<string | null>(
    null,
  );
  const [isBooting, setIsBooting] = useState(true);
  const eventSourceRef = useRef<EventSource | null>(null);
  const uploadedReferenceImagesRef = useRef<UploadedReferenceImage[]>([]);

  const availableModels = useMemo(
    () => models.filter((model) => model.available),
    [models],
  );
  const model = state
    ? (availableModels.find((item) => item.id === state.modelId) ?? null)
    : null;
  const estimate = useMemo(() => {
    if (!model || !state) {
      return 0;
    }

    const usesReference =
      uploadedReferenceImages.length > 0 ||
      Boolean(
        model.capabilities.supportsReferenceImage &&
          activeGeneration?.images[0]?.id &&
          useCurrentImageAsReference,
      );

    return estimateCost(model, {
      n: state.n,
      resolution: state.resolution,
      aspectRatio: state.aspectRatio as AspectRatio,
      outputFormat: state.outputFormat,
      background: state.background,
      usesReference,
    });
  }, [
    activeGeneration?.images[0]?.id,
    model,
    state,
    uploadedReferenceImages.length,
    useCurrentImageAsReference,
  ]);
  const hasInsufficientCredits = Boolean(model && state && estimate > credits);

  function clearConversationState() {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setConversationId(null);
    setConversationTitle("新的创作对话");
    setMessages([WELCOME_MESSAGE]);
    setActiveGeneration(null);
    setStatus("idle");
    setGenerationProgress(0);
    setError(null);
    setDraft("");
    clearUploadedReferenceImages();
    setUseCurrentImageAsReference(true);
  }

  function resetWorkspaceForNewConversation() {
    clearConversationState();
    setConversationError(null);
    router.replace("/app");
  }

  function redirectToLogin() {
    clearConversationState();
    setConversations([]);
    setHistory([]);
    setModels([]);
    setState(null);
    setCredits(0);
    setIsBooting(false);
    const next = `${window.location.pathname}${window.location.search}`;
    router.replace(`/login?next=${encodeURIComponent(next)}`);
  }

  async function loadMe() {
    try {
      const response = await fetch("/api/me", { cache: "no-store" });
      const data = await readApiResponse<UserView>(
        response,
        "账户状态暂时无法读取。",
      );

      setCredits(data.credits);
      setAccountId(data.id);
      setAccountError(null);
    } catch (loadError) {
      if (isUnauthorizedError(loadError)) {
        redirectToLogin();
        return;
      }

      setAccountError(
        friendlyErrorMessage(
          loadError instanceof Error ? loadError.message : null,
          "账户状态暂时无法读取。",
        ),
      );
    }
  }

  function clearUploadedReferenceImages() {
    setUploadedReferenceImages((current) => {
      for (const image of current) {
        URL.revokeObjectURL(image.previewUrl);
      }

      return [];
    });
    setReferenceUploadError(null);
  }

  function applyConversation(conversation: ConversationView) {
    setConversationId(conversation.id);
    setConversationTitle(conversation.title);
    setMessages(
      conversation.messages.length ? conversation.messages : [WELCOME_MESSAGE],
    );

    const lastImageMessage = [...conversation.messages]
      .reverse()
      .find((message) => message.generationId && message.imageUrl);

    if (lastImageMessage?.generationId && lastImageMessage.imageUrl) {
      const nextStatus = statusFromGeneration(
        lastImageMessage.generationStatus ?? "SUCCEEDED",
      );

      setActiveGeneration({
        id: lastImageMessage.generationId,
        conversationId: conversation.id,
        prompt: lastImageMessage.content,
        status: lastImageMessage.generationStatus ?? "SUCCEEDED",
        createdAt: lastImageMessage.createdAt ?? new Date().toISOString(),
        images: [
          {
            id: lastImageMessage.imageId,
            src: lastImageMessage.imageUrl,
            url: lastImageMessage.imageUrl,
          },
        ],
      });
      setStatus(nextStatus);
      setGenerationProgress(nextStatus === "succeeded" ? 100 : 0);
      setUseCurrentImageAsReference(true);
    } else {
      setActiveGeneration(null);
      setStatus("idle");
      setGenerationProgress(0);
    }
  }

  async function ensureConversation(
    firstUserMessage: string,
  ): Promise<string> {
    if (conversationId) {
      return conversationId;
    }

    try {
      const conversation = await readApiResponse<ConversationView>(
        await fetch("/api/conversations", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title: conversationTitleFromText(firstUserMessage),
          }),
        }),
        "对话创建失败。请稍后重试。",
      );

      setConversationId(conversation.id);
      setConversationTitle(conversation.title);
      setConversations((current) => [
        {
          id: conversation.id,
          title: conversation.title,
          lastMessageAt: conversation.lastMessageAt,
          createdAt: conversation.createdAt,
          latestMessage: firstUserMessage,
          thumbnailUrl: null,
          generationCount: 0,
        },
        ...current.filter((item) => item.id !== conversation.id),
      ]);
      router.replace(`/app?conversation=${conversation.id}`);

      return conversation.id;
    } catch (createError) {
      const message = friendlyErrorMessage(
        createError instanceof Error ? createError.message : null,
        "对话创建失败。请稍后重试。",
      );
      setConversationError(message);
      throw createError;
    }
  }

  async function appendConversationMessages(
    targetConversationId: string,
    nextMessages: Array<
      Pick<ConversationMessage, "role" | "content" | "generationId">
    >,
  ) {
    try {
      const conversation = await readApiResponse<ConversationView>(
        await fetch(`/api/conversations/${targetConversationId}/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ messages: nextMessages }),
        }),
        "对话保存失败。",
      );

      applyConversation(conversation);
      setConversationError(null);
    } catch (saveError) {
      if (isUnauthorizedError(saveError)) {
        redirectToLogin();
        return;
      }

      setConversationError(
        friendlyErrorMessage(
          saveError instanceof Error ? saveError.message : null,
          "对话保存失败。",
        ),
      );
    }
  }

  async function clearCurrentConversationMessages() {
    if (!conversationId) {
      setMessages([WELCOME_MESSAGE]);
      return;
    }

    const confirmed = window.confirm("确定清空当前对话的聊天消息吗？");

    if (!confirmed) {
      return;
    }

    try {
      await readApiResponse<{ deleted: number }>(
        await fetch(`/api/conversations/${conversationId}/messages`, {
          method: "DELETE",
        }),
        "聊天记录清空失败。",
      );
      setMessages([WELCOME_MESSAGE]);
      setConversations((current) =>
        current.map((item) =>
          item.id === conversationId
            ? {
                ...item,
                latestMessage: null,
                lastMessageAt: new Date().toISOString(),
              }
            : item,
        ),
      );
      setConversationError(null);
    } catch (clearError) {
      if (isUnauthorizedError(clearError)) {
        redirectToLogin();
        return;
      }

      setConversationError(
        friendlyErrorMessage(
          clearError instanceof Error ? clearError.message : null,
          "聊天记录清空失败。",
        ),
      );
    }
  }

  async function uploadReferenceImage(file: File) {
    if (!model?.capabilities.supportsReferenceImage) {
      setReferenceUploadError("当前模型不支持参考图。");
      return;
    }

    const reservedCurrentImageSlot =
      useCurrentImageAsReference && activeGeneration?.images[0]?.id ? 1 : 0;
    const maxUploadedReferenceImages = Math.max(
      0,
      model.capabilities.maxReferenceImages - reservedCurrentImageSlot,
    );

    if (uploadedReferenceImages.length >= maxUploadedReferenceImages) {
      setReferenceUploadError(
        `参考图最多 ${model.capabilities.maxReferenceImages} 张。`,
      );
      return;
    }

    setIsUploadingReference(true);
    setReferenceUploadError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const uploaded = await readApiResponse<UploadedReferenceImageView>(
        await fetch("/api/upload", {
          method: "POST",
          body: formData,
        }),
        "参考图上传失败。",
      );
      const previewUrl = URL.createObjectURL(file);

      setUploadedReferenceImages((current) => [
        ...current,
        {
          ...uploaded,
          previewUrl,
        },
      ]);
    } catch (uploadError) {
      if (isUnauthorizedError(uploadError)) {
        redirectToLogin();
        return;
      }

      setReferenceUploadError(
        friendlyErrorMessage(
          uploadError instanceof Error ? uploadError.message : null,
          "参考图上传失败。",
        ),
      );
    } finally {
      setIsUploadingReference(false);
    }
  }

  function removeReferenceImage(key: string) {
    setUploadedReferenceImages((current) => {
      const image = current.find((item) => item.key === key);

      if (image) {
        URL.revokeObjectURL(image.previewUrl);
      }

      return current.filter((item) => item.key !== key);
    });
  }

  function mergeGeneration(next: WorkbenchGeneration) {
    setActiveGeneration(next);
    setHistory((current) => [
      next,
      ...current.filter((item) => item.id !== next.id),
    ]);

    if (next.conversationId) {
      const imageUrl = next.images[0]?.src ?? next.images[0]?.url ?? null;

      setConversations((current) =>
        current.map((item) =>
          item.id === next.conversationId
            ? {
                ...item,
                lastMessageAt: new Date().toISOString(),
                thumbnailUrl: imageUrl ?? item.thumbnailUrl,
                generationCount: Math.max(item.generationCount, 1),
              }
            : item,
        ),
      );
    }
  }

  function appendAssistantError(message: string) {
    setMessages((current) => [...current, createMessage("assistant", message)]);
  }

  function openGenerationStream(generationId: string) {
    eventSourceRef.current?.close();

    const events = new EventSource(`/api/generations/${generationId}/stream`);
    eventSourceRef.current = events;

    events.addEventListener("update", (event) => {
      const next = JSON.parse(
        (event as MessageEvent).data,
      ) as WorkbenchGeneration;
      mergeGeneration(next);
      const nextStatus = statusFromGeneration(next.status);
      setStatus(nextStatus);

      if (nextStatus === "pending") {
        setGenerationProgress((current) => Math.max(current, 12));
      }

      if (nextStatus === "running") {
        setGenerationProgress((current) => Math.max(current, 62));
      }

      if (nextStatus === "failed") {
        setGenerationProgress(0);
        const message = friendlyErrorMessage(
          {
            code: next.errorCode ?? undefined,
            message: next.errorMessage ?? undefined,
          },
          "生成没有完成。请稍后重试，或换一个模型再发送。",
        );
        setError(message);
        appendAssistantError(message);
      }

      if (nextStatus === "succeeded") {
        setGenerationProgress(100);
        setMessages((current) =>
          current.map((message) =>
            message.generationId === next.id
              ? {
                  ...message,
                  imageId: next.images[0]?.id,
                  imageUrl: next.images[0]?.src ?? next.images[0]?.url,
                  generationStatus: next.status,
                }
              : message,
          ),
        );
      }

      if (
        nextStatus === "succeeded" ||
        nextStatus === "failed" ||
        nextStatus === "canceled"
      ) {
        events.close();
        eventSourceRef.current = null;
        void loadMe();
      }
    });

    events.addEventListener("error", (event) => {
      let message = "无法继续接收任务状态。请刷新页面查看结果，或稍后重试。";
      const data = (event as MessageEvent).data;

      if (typeof data === "string" && data) {
        try {
          const parsed = JSON.parse(data) as {
            code?: string;
            message?: string;
          };
          message = friendlyErrorMessage(parsed, message);
        } catch {
          message = friendlyErrorMessage(data, message);
        }
      }

      setStatus("failed");
      setGenerationProgress(0);
      setError(message);
      appendAssistantError(message);
      events.close();
      eventSourceRef.current = null;
      void loadMe();
    });
  }

  const loadInitialState = useCallback(
    async (isCanceled?: () => boolean) => {
      setIsBooting(true);
      setError(null);
      setModelsError(null);
      setAccountError(null);
      setHistoryError(null);
      setConversationError(null);

      const [
        modelsResult,
        meResult,
        generationsResult,
        conversationsResult,
        activeConversationResult,
      ] = await Promise.allSettled([
        fetch("/api/public/models", { cache: "no-store" }).then((response) =>
          readApiResponse<PublicModelDefinition[]>(
            response,
            "模型列表暂时无法读取。",
          ),
        ),
        fetch("/api/me", { cache: "no-store" }).then((response) =>
          readApiResponse<UserView>(response, "账户状态暂时无法读取。"),
        ),
        fetch("/api/generations?limit=20", { cache: "no-store" }).then(
          (response) =>
            readApiResponse<GenerationListView>(
              response,
              "历史记录暂时无法读取。",
            ),
        ),
        fetch("/api/conversations?limit=12", { cache: "no-store" }).then(
          (response) =>
            readApiResponse<ConversationListView>(
              response,
              "对话列表暂时无法读取。",
            ),
        ),
        requestedConversationId
          ? fetch(`/api/conversations/${requestedConversationId}`, {
              cache: "no-store",
            }).then((response) =>
              readApiResponse<ConversationView>(response, "对话暂时无法读取。"),
            )
          : Promise.resolve(null),
      ]);

      if (isCanceled?.()) {
        return;
      }

      const settledResults = [
        modelsResult,
        meResult,
        generationsResult,
        conversationsResult,
        activeConversationResult,
      ];

      if (
        settledResults.some(
          (result) =>
            result.status === "rejected" && isUnauthorizedError(result.reason),
        )
      ) {
        redirectToLogin();
        return;
      }

      if (modelsResult.status === "fulfilled") {
        setModels(modelsResult.value);
        const preferenceUserId =
          meResult.status === "fulfilled" ? meResult.value.id : accountId;
        const preferences = readWorkbenchPreferences(preferenceUserId);
        const preferredModelId = preferences.modelId;
        const preferred = preferredModelId
          ? modelsResult.value.find(
              (item) => item.available && item.id === preferredModelId,
            )
          : null;
        const defaultModel = modelsResult.value.find(
          (item) => item.available && item.id === DEFAULT_MODEL_ID,
        );
        const firstAvailable =
          preferred ??
          defaultModel ??
          modelsResult.value.find((item) => item.available);
        setState(
          firstAvailable ? initialStateFor(firstAvailable, preferences) : null,
        );
      } else {
        setModels([]);
        setState(null);
        setModelsError(
          friendlyErrorMessage(
            modelsResult.reason instanceof Error
              ? modelsResult.reason.message
              : null,
            "模型列表暂时无法读取。",
          ),
        );
      }

      if (meResult.status === "fulfilled") {
        setCredits(meResult.value.credits);
        setAccountId(meResult.value.id);
      } else {
        setCredits(0);
        setAccountId(null);
        setAccountError(
          friendlyErrorMessage(
            meResult.reason instanceof Error ? meResult.reason.message : null,
            "账户状态暂时无法读取。",
          ),
        );
      }

      if (generationsResult.status === "fulfilled") {
        setHistory(generationsResult.value.items);
      } else {
        setHistory([]);
        setHistoryError(
          friendlyErrorMessage(
            generationsResult.reason instanceof Error
              ? generationsResult.reason.message
              : null,
            "历史记录暂时无法读取。",
          ),
        );
      }

      if (conversationsResult.status === "fulfilled") {
        setConversations(conversationsResult.value.items);
      } else {
        setConversations([]);
        setConversationError(
          friendlyErrorMessage(
            conversationsResult.reason instanceof Error
              ? conversationsResult.reason.message
              : null,
            "对话列表暂时无法读取。",
          ),
        );
      }

      if (
        activeConversationResult.status === "fulfilled" &&
        activeConversationResult.value
      ) {
        applyConversation(activeConversationResult.value);
      } else if (activeConversationResult.status === "rejected") {
        setConversationId(null);
        setConversationTitle("新的创作对话");
        setMessages([WELCOME_MESSAGE]);
        setActiveGeneration(null);
        setStatus("idle");
        setGenerationProgress(0);

        if (isMissingConversationError(activeConversationResult.reason)) {
          router.replace("/app");
          setConversationError(
            "这个对话不存在，或不属于当前账户。已切回新的创作对话。",
          );
        } else {
          setConversationError(
            friendlyErrorMessage(
              activeConversationResult.reason instanceof Error
                ? activeConversationResult.reason.message
                : null,
              "对话暂时无法读取。",
            ),
          );
        }
      } else if (!requestedConversationId) {
        setConversationId(null);
        setConversationTitle("新的创作对话");
        setMessages([WELCOME_MESSAGE]);
      }

      if (
        modelsResult.status === "rejected" ||
        meResult.status === "rejected" ||
        generationsResult.status === "rejected" ||
        conversationsResult.status === "rejected" ||
        activeConversationResult.status === "rejected"
      ) {
        setMessages((current) =>
          current.some((message) => message.id === "service-status")
            ? current
            : [
                ...current,
                {
                  id: "service-status",
                  role: "assistant",
                  content:
                    "部分服务暂时不可用。页面会保留可操作区域；恢复后可以重试或刷新。",
                  createdAt: new Date().toISOString(),
                },
              ],
        );
      }

      setIsBooting(false);
    },
    // The boot loader intentionally runs when the URL-selected conversation changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [requestedConversationId],
  );

  useEffect(() => {
    let canceled = false;
    const timer = window.setTimeout(() => {
      void loadInitialState(() => canceled);
    }, 0);

    return () => {
      canceled = true;
      window.clearTimeout(timer);
      eventSourceRef.current?.close();
    };
  }, [loadInitialState]);

  useEffect(() => {
    uploadedReferenceImagesRef.current = uploadedReferenceImages;
  }, [uploadedReferenceImages]);

  useEffect(
    () => () => {
      for (const image of uploadedReferenceImagesRef.current) {
        URL.revokeObjectURL(image.previewUrl);
      }
    },
    [],
  );

  useEffect(() => {
    if (isBooting || !state) {
      return;
    }

    writeWorkbenchPreferences(
      {
        modelId: state.modelId,
        aspectRatio: state.aspectRatio,
        resolution: state.resolution,
      },
      accountId,
    );
  }, [accountId, isBooting, state]);

  async function submitGeneration() {
    const userText = draft.trim();

    if (!userText || isSubmitting || !state || !model) {
      return;
    }

    const userMessage = createMessage("user", userText);
    const nextMessages = [...messages, userMessage];
    const requestState = state;

    setMessages(nextMessages);
    setDraft("");
    setError(null);
    setGenerationProgress(0);
    setIsSubmitting(true);

    let failureFallback = "生成请求没有提交成功。请稍后重试。";

    try {
      failureFallback = "对话创建失败。请稍后重试。";
      const targetConversationId = await ensureConversation(userText);

      setStatus("pending");
      setGenerationProgress(8);
      failureFallback = "生成请求没有提交成功。请稍后重试。";
      const sourceImageId =
        useCurrentImageAsReference &&
        activeGeneration?.conversationId === targetConversationId
          ? activeGeneration.images[0]?.id
          : undefined;
      const assistantMessageText = "已收到，开始生成。";

      const payload = await readApiResponse<{
        generationId: string;
        status: string;
        estimatedCredits: number;
      }>(
        await fetch("/api/generations", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            conversationId: targetConversationId,
            userMessage: userText,
            assistantMessage: assistantMessageText,
            modelId: requestState.modelId,
            prompt: userText,
            aspectRatio: requestState.aspectRatio,
            resolution: requestState.resolution,
            n: requestState.n,
            outputFormat: requestState.outputFormat,
            background: requestState.background,
            outputCompression: requestState.outputCompression,
            referenceImageKeys: uploadedReferenceImages.map(
              (image) => image.key,
            ),
            sourceImageIds: sourceImageId ? [sourceImageId] : [],
          }),
        }),
        "生成请求没有提交成功。请稍后重试。",
      );

      const pendingGeneration: WorkbenchGeneration = {
        id: payload.generationId,
        conversationId: targetConversationId,
        modelId: requestState.modelId,
        prompt: userText,
        status: payload.status,
        createdAt: new Date().toISOString(),
        images: [],
      };
      const assistantMessage = createMessage(
        "assistant",
        assistantMessageText,
      );
      assistantMessage.generationId = payload.generationId;

      setMessages((current) => [...current, assistantMessage]);
      setCredits((current) => Math.max(0, current - payload.estimatedCredits));
      setStatus(statusFromGeneration(payload.status));
      setGenerationProgress(payload.status === "PENDING" ? 12 : 62);
      clearUploadedReferenceImages();
      mergeGeneration(pendingGeneration);
      openGenerationStream(payload.generationId);
    } catch (submitError) {
      if (isUnauthorizedError(submitError)) {
        redirectToLogin();
        return;
      }

      const message = friendlyErrorMessage(
        submitError instanceof Error ? submitError.message : null,
        failureFallback,
      );
      setStatus("failed");
      setGenerationProgress(0);
      setError(message);
      setMessages((current) =>
        current.filter((messageItem) => messageItem.id !== userMessage.id),
      );
      appendAssistantError(`${message} 你可以修改描述后重新发送。`);
    } finally {
      setIsSubmitting(false);
    }
  }

  const activeImage =
    activeGeneration?.images[0]?.src ?? activeGeneration?.images[0]?.url;
  const activeImageId = activeGeneration?.images[0]?.id;
  const supportsReferenceImage = Boolean(
    model?.capabilities.supportsReferenceImage,
  );
  const canUseCurrentImageReference = Boolean(
    supportsReferenceImage && activeImageId,
  );
  const currentImageReferenceSlotUsed =
    canUseCurrentImageReference && useCurrentImageAsReference ? 1 : 0;
  const maxUploadedReferenceImages = model
    ? Math.max(
        0,
        model.capabilities.maxReferenceImages - currentImageReferenceSlotUsed,
      )
    : 0;
  const disabledReason = (() => {
    if (isBooting) {
      return "正在读取账户和模型状态。";
    }

    if (!model || !state) {
      return modelsError ?? "当前没有可用模型。模型恢复后即可发送。";
    }

    if (hasInsufficientCredits) {
      return `余额不足，本次预计需要 ${estimate} 点，当前余额 ${credits} 点。`;
    }

    if (isSubmitting) {
      return "任务正在提交。";
    }

    if (isUploadingReference) {
      return "参考图正在上传。";
    }

    if (!draft.trim()) {
      return "描述你想生成或修改的画面后即可发送。";
    }

    return null;
  })();
  const submitDisabled = Boolean(
    isSubmitting ||
    isUploadingReference ||
    !draft.trim() ||
    !state ||
    !model ||
    isBooting ||
    hasInsufficientCredits,
  );
  const hasModels = models.length > 0;
  const hasAvailableModels = availableModels.length > 0;
  const cannotReadServices = Boolean(
    modelsError || accountError || historyError || conversationError,
  );
  const serviceErrorDescription = [
    ...new Set(
      [modelsError, accountError, historyError, conversationError].filter(
        Boolean,
      ),
    ),
  ].join(" ");

  return (
    <div className="workbench-shell space-y-4">
      {cannotReadServices ? (
        <ActionableStatus
          tone="warning"
          title="部分状态暂时无法读取"
          description={serviceErrorDescription}
          onRetry={() => void loadInitialState()}
        />
      ) : null}

      {!isBooting && !hasAvailableModels ? (
        <ActionableStatus
          tone={modelsError ? "warning" : "muted"}
          title={hasModels ? "模型暂不可用" : "还没有可用模型"}
          description={
            modelsError
              ? "模型列表暂时无法读取。你可以先保留输入内容，服务恢复后重试。"
              : hasModels
                ? "当前模型没有可用渠道。你可以稍后重试，或联系管理员启用模型。"
                : "创作入口已保留。模型恢复后，你可以直接在这里继续输入。"
          }
          action={
            <Link
              href="/app/settings"
              className="tool-button h-9 text-text-muted"
            >
              <Settings className="h-4 w-4 stroke-[1.5]" />
              设置
            </Link>
          }
        />
      ) : null}

      {hasInsufficientCredits ? (
        <ActionableStatus
          tone="warning"
          title="余额不足"
          description={`本次预计需要 ${estimate} 点，当前余额 ${credits} 点。请降低张数或分辨率，或联系管理员充值。`}
        />
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          <div className="workbench-hero flex items-start justify-between gap-4 max-sm:flex-col">
            <div className="min-w-0">
              <p className="eyebrow">创作工作台</p>
              <h1 className="mt-2 truncate text-[32px] font-normal leading-tight max-sm:text-2xl">
                {conversationTitle}
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-text-muted">
                <span>{model?.displayName ?? "等待可用模型"}</span>
                <span className="h-1 w-1 rounded-full bg-border-strong" />
                <span>{WORKBENCH_STATUS_LABEL[status]}</span>
                {canUseCurrentImageReference && useCurrentImageAsReference ? (
                  <>
                    <span className="h-1 w-1 rounded-full bg-border-strong" />
                    <span>下一轮会参考当前画布</span>
                  </>
                ) : null}
              </div>
            </div>
            <CostPreview
              estimate={estimate}
              credits={credits}
              unavailable={Boolean(accountError)}
            />
          </div>

          <div className="grid min-h-[calc(100vh-230px)] gap-4 lg:grid-cols-[minmax(360px,0.95fr)_minmax(420px,1.05fr)]">
            <ConversationThread
              className="min-h-[560px] lg:h-[calc(100vh-230px)]"
              messages={messages}
              taskStatus={status}
              progress={generationProgress}
              onClearMessages={clearCurrentConversationMessages}
              canClearMessages={
                messages.some((message) => message.id !== WELCOME_MESSAGE.id)
              }
              footer={
                <PromptInput
                  value={draft}
                  onChange={setDraft}
                  onSubmit={submitGeneration}
                  referenceImages={uploadedReferenceImages}
                  onUploadReference={
                    supportsReferenceImage ? uploadReferenceImage : undefined
                  }
                  onRemoveReference={removeReferenceImage}
                  uploadDisabled={
                    isBooting ||
                    isSubmitting ||
                    isUploadingReference ||
                    !supportsReferenceImage ||
                    uploadedReferenceImages.length >= maxUploadedReferenceImages
                  }
                  isUploadingReference={isUploadingReference}
                  referenceUploadError={referenceUploadError}
                  useCurrentImageAsReference={useCurrentImageAsReference}
                  onToggleCurrentImageReference={setUseCurrentImageAsReference}
                  canUseCurrentImageReference={canUseCurrentImageReference}
                  currentImageReferenceDisabled={isSubmitting}
                  disabled={submitDisabled}
                  disabledReason={disabledReason}
                  inputDisabled={isBooting || isSubmitting}
                  isBusy={isSubmitting}
                  placeholder={
                    model
                      ? "像聊天一样描述画面，或继续说你想怎么改。"
                      : "可以先写下画面描述，模型恢复后再发送。"
                  }
                />
              }
            />

            <Canvas imageUrl={activeImage} status={status} error={error} />
          </div>

          {error ? (
            <ActionableStatus
              tone="danger"
              title="生成没有完成"
              description={`${error} 你可以调整描述、降低张数或稍后重新发送。`}
            />
          ) : null}

          <div className="surface-panel p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="eyebrow">历史</p>
                <h3 className="mt-1 text-lg font-medium">最近任务</h3>
              </div>
              <Link
                href="/app/history"
                className="tool-button h-9 text-text-muted"
              >
                全部
              </Link>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {history.slice(0, 4).map((item) => (
                <Link
                  key={item.id}
                  href={
                    item.conversationId
                      ? `/app?conversation=${item.conversationId}`
                      : `/app/g/${item.id}`
                  }
                  className="surface-panel block p-3 text-sm leading-6 transition-colors hover:-translate-y-0.5 hover:bg-surface-2"
                >
                  <span className="font-mono text-xs text-text-muted">
                    {generationStatusLabel(item.status)}
                  </span>
                  <span className="mt-1 line-clamp-2 block">{item.prompt}</span>
                </Link>
              ))}
              {history.length === 0 ? (
                <div className="surface-panel-soft p-3 text-sm leading-6 text-text-muted md:col-span-2">
                  {historyError
                    ? "历史记录暂时无法读取，新的生成完成后仍会显示在画布中。"
                    : "还没有生成记录。先在输入框里描述第一张图。"}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <aside className="space-y-3 xl:sticky xl:top-20 xl:h-fit">
          <div className="surface-panel p-3">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="eyebrow">对话</p>
                <h3 className="mt-1 truncate text-base font-medium">
                  {conversationTitle}
                </h3>
              </div>
              <button
                type="button"
                className="tool-button h-9 w-9 shrink-0 px-0 text-text-muted"
                aria-label="新建对话"
                onClick={resetWorkspaceForNewConversation}
              >
                <MessageSquarePlus className="h-4 w-4 stroke-[1.5]" />
              </button>
            </div>
            <div className="space-y-2">
              {conversations.slice(0, 5).map((item) => (
                <Link
                  key={item.id}
                  href={`/app?conversation=${item.id}`}
                  className={`block rounded-[6px] border px-3 py-2 text-sm leading-5 transition-colors ${
                    item.id === conversationId
                      ? "border-border-strong bg-surface-2 text-foreground"
                      : "border-border bg-surface-2 text-text-muted hover:text-foreground"
                  }`}
                >
                  <span className="block truncate font-medium">
                    {item.title}
                  </span>
                  {item.latestMessage ? (
                    <span className="mt-1 line-clamp-1 block text-xs opacity-75">
                      {item.latestMessage}
                    </span>
                  ) : null}
                </Link>
              ))}
              {conversations.length === 0 ? (
                <p className="text-sm leading-6 text-text-muted">
                  {conversationError
                    ? "对话列表暂时无法读取。"
                    : "发送第一条消息后会自动创建对话。"}
                </p>
              ) : null}
            </div>
          </div>
          <ModelSelector
            models={models}
            activeId={state?.modelId ?? ""}
            onChange={(modelId) => {
              if (!state) {
                const selected = availableModels.find(
                  (item) => item.id === modelId,
                );
                setState(
                  selected
                    ? initialStateFor(
                        selected,
                        readWorkbenchPreferences(accountId),
                      )
                    : null,
                );
                return;
              }

              setState((current) =>
                current
                  ? normalizeWorkbenchState(modelId, current, models)
                  : current,
              );
            }}
          />
          {state ? (
            <details className="surface-panel group overflow-hidden" open>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-3 text-sm marker:hidden">
                <span className="inline-flex items-center gap-2 text-text-muted">
                  <SlidersHorizontal className="h-4 w-4 stroke-[1.5]" />
                  生成参数
                </span>
                <span className="font-mono text-xs text-text-faint group-open:hidden">
                  展开
                </span>
                <span className="hidden font-mono text-xs text-text-faint group-open:inline">
                  收起
                </span>
              </summary>
              <DynamicParamsPanel
                value={state}
                onChange={setState}
                models={models}
              />
            </details>
          ) : (
            <div className="surface-panel p-4 text-sm leading-6 text-text-muted">
              {isBooting
                ? "正在读取模型列表..."
                : modelsError
                  ? "模型列表暂时无法读取。"
                  : "当前没有可用模型。"}
            </div>
          )}
        </aside>
      </section>
    </div>
  );
}
