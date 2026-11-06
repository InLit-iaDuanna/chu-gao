"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef } from "react";

import { friendlyErrorMessage } from "@/components/shared/error-copy";
import { isUnauthorizedError } from "@/components/workbench/lib/api-client";
import {
  ALLOWED_REFERENCE_IMAGE_TYPES,
  currentWorkbenchConversationUrl,
  currentWorkbenchPath,
  selectedActiveImage,
} from "@/components/workbench/lib/workbench-action-utils";
import {
  WELCOME_MESSAGE,
  conversationTitleFromText,
  createMessage,
} from "@/components/workbench/lib/messages";
import { applyConversationToStores } from "@/components/workbench/lib/workbench-conversation-hydration";
import {
  archiveConversation as archiveConversationRequest,
  clearConversations as clearConversationsRequest,
  createConversation,
  deleteConversationMessages,
  fetchAccount,
  submitGenerationRequest,
  updateConversationMessage as updateConversationMessageRequest,
  uploadReferenceImageFile,
} from "@/components/workbench/lib/workbench-api";
import {
  closeGenerationStream as closeGenerationStreamRef,
  mergeGeneration,
  openGenerationStream as openGenerationStreamRef,
} from "@/components/workbench/lib/workbench-generation-stream";
import { statusFromGeneration } from "@/components/workbench/lib/workbench-state";
import { useConversationStore } from "@/components/workbench/stores/conversation-store";
import { useErrorStore } from "@/components/workbench/stores/error-store";
import { useGenerationStore } from "@/components/workbench/stores/generation-store";
import { useReferenceImageStore } from "@/components/workbench/stores/reference-image-store";
import { useWorkbenchStore } from "@/components/workbench/stores/workbench-store";
import type { WorkbenchGeneration } from "@/components/workbench/types";
import type { ConversationMessage, ConversationView } from "@/lib/conversation";
import { getImage2ProviderChannelName } from "@/lib/provider-channels";

export function useWorkbenchActions() {
  const router = useRouter();
  const eventSourceRef = useRef<EventSource | null>(null);

  const setError = useErrorStore((s) => s.setError);
  const clearAllErrors = useErrorStore((s) => s.clearAll);

  const redirectToLogin = useCallback(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    useConversationStore.getState().resetConversation();
    useConversationStore.setState({ conversations: [] });
    useGenerationStore.getState().resetTask();
    useGenerationStore.setState({ history: [] });
    useReferenceImageStore.getState().clearReferenceImages();
    useReferenceImageStore.setState({ useCurrentImageAsReference: false });
    useWorkbenchStore.getState().reset();
    useWorkbenchStore.setState({ isBooting: false });
    const next = `${window.location.pathname}${window.location.search}`;
    router.replace(`/login?next=${encodeURIComponent(next)}`);
  }, [router]);

  const appendAssistantError = useCallback((message: string) => {
    useConversationStore
      .getState()
      .appendMessage(createMessage("assistant", message));
  }, []);

  const closeGenerationStream = useCallback(() => {
    closeGenerationStreamRef(eventSourceRef);
  }, []);

  const clearConversationState = useCallback(() => {
    closeGenerationStream();
    useConversationStore.getState().resetConversation();
    useGenerationStore.getState().resetTask();
    setError("generation", null);
    useReferenceImageStore.getState().clearReferenceImages();
    useReferenceImageStore.setState({ useCurrentImageAsReference: false });
  }, [closeGenerationStream, setError]);

  const resetWorkspaceForNewConversation = useCallback(() => {
    clearConversationState();
    setError("conversation", null);
    router.replace(currentWorkbenchPath());
  }, [clearConversationState, router, setError]);

  const loadMe = useCallback(async () => {
    try {
      const data = await fetchAccount();
      useWorkbenchStore.setState({
        credits: data.credits,
        accountId: data.id,
      });
      setError("account", null);
    } catch (loadError) {
      if (isUnauthorizedError(loadError)) {
        redirectToLogin();
        return;
      }
      setError(
        "account",
        friendlyErrorMessage(
          loadError instanceof Error ? loadError.message : null,
          "账户状态暂时无法读取。",
        ),
      );
    }
  }, [redirectToLogin, setError]);

  const openGenerationStream = useCallback(
    (generationId: string) => {
      openGenerationStreamRef(generationId, {
        eventSourceRef,
        setError,
        appendAssistantError,
        loadMe,
      });
    },
    [appendAssistantError, loadMe, setError],
  );

  const applyConversation = useCallback(
    (conversation: ConversationView) => {
      applyConversationToStores(conversation, {
        closeGenerationStream,
        openGenerationStream,
      });
    },
    [closeGenerationStream, openGenerationStream],
  );

  const ensureConversation = useCallback(
    async (firstUserMessage: string): Promise<string> => {
      const existing = useConversationStore.getState().conversationId;
      if (existing) return existing;

      try {
        const conversation = await createConversation(
          conversationTitleFromText(firstUserMessage),
        );

        const conv = useConversationStore.getState();
        conv.setConversationId(conversation.id);
        conv.setConversationTitle(conversation.title);
        conv.setConversations((current) => [
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
        router.replace(currentWorkbenchConversationUrl(conversation.id));

        return conversation.id;
      } catch (createError) {
        const message = friendlyErrorMessage(
          createError instanceof Error ? createError.message : null,
          "对话创建失败。请稍后重试。",
        );
        setError("conversation", message);
        throw createError;
      }
    },
    [router, setError],
  );

  const clearCurrentConversationMessages = useCallback(async () => {
    const { conversationId, setMessages, setConversations } =
      useConversationStore.getState();

    if (!conversationId) {
      setMessages([WELCOME_MESSAGE]);
      return;
    }

    if (!window.confirm("确定清空当前对话的聊天消息吗？")) return;

    try {
      await deleteConversationMessages(conversationId);
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
      setError("conversation", null);
    } catch (clearError) {
      if (isUnauthorizedError(clearError)) {
        redirectToLogin();
        return;
      }
      setError(
        "conversation",
        friendlyErrorMessage(
          clearError instanceof Error ? clearError.message : null,
          "聊天记录清空失败。",
        ),
      );
    }
  }, [redirectToLogin, setError]);

  const updateConversationMessage = useCallback(
    async (messageId: string, content: string) => {
      const conversationId = useConversationStore.getState().conversationId;
      if (!conversationId || messageId === WELCOME_MESSAGE.id) return;

      try {
        const conversation = await updateConversationMessageRequest(
          conversationId,
          messageId,
          content,
        );

        applyConversation(conversation);
        setError("conversation", null);
      } catch (editError) {
        if (isUnauthorizedError(editError)) {
          redirectToLogin();
          return;
        }
        setError(
          "conversation",
          friendlyErrorMessage(
            editError instanceof Error ? editError.message : null,
            "消息编辑失败。",
          ),
        );
        throw editError;
      }
    },
    [applyConversation, redirectToLogin, setError],
  );

  const archiveConversation = useCallback(
    async (targetConversationId: string) => {
      if (!window.confirm("确定删除这个历史对话吗？")) return;

      try {
        await archiveConversationRequest(targetConversationId);

        const conv = useConversationStore.getState();
        conv.setConversations((current) =>
          current.filter((item) => item.id !== targetConversationId),
        );

        if (targetConversationId === conv.conversationId) {
          resetWorkspaceForNewConversation();
        }

        setError("conversation", null);
      } catch (archiveError) {
        if (isUnauthorizedError(archiveError)) {
          redirectToLogin();
          return;
        }
        setError(
          "conversation",
          friendlyErrorMessage(
            archiveError instanceof Error ? archiveError.message : null,
            "历史对话删除失败。",
          ),
        );
      }
    },
    [redirectToLogin, resetWorkspaceForNewConversation, setError],
  );

  const clearAllConversations = useCallback(async () => {
    const conversations = useConversationStore.getState().conversations;
    if (conversations.length === 0) return;

    if (!window.confirm("确定清空全部历史对话吗？生成记录会保留。")) return;

    try {
      await clearConversationsRequest();
      useConversationStore.getState().setConversations([]);
      resetWorkspaceForNewConversation();
      setError("conversation", null);
    } catch (clearError) {
      if (isUnauthorizedError(clearError)) {
        redirectToLogin();
        return;
      }
      setError(
        "conversation",
        friendlyErrorMessage(
          clearError instanceof Error ? clearError.message : null,
          "历史对话清空失败。",
        ),
      );
    }
  }, [redirectToLogin, resetWorkspaceForNewConversation, setError]);

  const uploadReferenceImages = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;

      const { state, models } = useWorkbenchStore.getState();
      const model = models.find((m) => m.id === state?.modelId);
      const ref = useReferenceImageStore.getState();
      const gen = useGenerationStore.getState();

      if (ref.isUploadingReference) {
        setError("reference", "参考图正在上传。");
        return;
      }

      if (!model?.capabilities.supportsReferenceImage) {
        setError("reference", "当前模型不支持参考图。");
        return;
      }

      const validFiles = files.filter((file) =>
        ALLOWED_REFERENCE_IMAGE_TYPES.has(file.type),
      );
      const invalidCount = files.length - validFiles.length;

      if (validFiles.length === 0) {
        setError("reference", "请拖入 PNG、JPEG 或 WEBP 参考图。");
        return;
      }

      const reservedCurrentImageSlot =
        ref.useCurrentImageAsReference &&
        selectedActiveImage(gen.activeGeneration, gen.activeImageId)?.id
          ? 1
          : 0;
      const maxUploadedReferenceImages = Math.max(
        0,
        model.capabilities.maxReferenceImages - reservedCurrentImageSlot,
      );

      if (ref.uploadedReferenceImages.length >= maxUploadedReferenceImages) {
        setError(
          "reference",
          `参考图最多 ${model.capabilities.maxReferenceImages} 张。`,
        );
        return;
      }

      const availableSlots =
        maxUploadedReferenceImages - ref.uploadedReferenceImages.length;
      const uploadableFiles = validFiles.slice(0, availableSlots);
      const exceededLimit = validFiles.length > availableSlots;

      ref.setIsUploadingReference(true);
      setError("reference", null);

      try {
        for (const file of uploadableFiles) {
          const uploaded = await uploadReferenceImageFile(file);
          const previewUrl = URL.createObjectURL(file);

          useReferenceImageStore
            .getState()
            .addReferenceImage({ ...uploaded, previewUrl });
        }

        if (exceededLimit) {
          setError(
            "reference",
            `参考图最多 ${model.capabilities.maxReferenceImages} 张。`,
          );
        } else if (invalidCount > 0) {
          setError("reference", "请拖入 PNG、JPEG 或 WEBP 参考图。");
        }
      } catch (uploadError) {
        if (isUnauthorizedError(uploadError)) {
          redirectToLogin();
          return;
        }
        setError(
          "reference",
          friendlyErrorMessage(
            uploadError instanceof Error ? uploadError.message : null,
            "参考图上传失败。",
          ),
        );
      } finally {
        useReferenceImageStore.getState().setIsUploadingReference(false);
      }
    },
    [redirectToLogin, setError],
  );

  const uploadReferenceImage = useCallback(
    async (file: File) => {
      await uploadReferenceImages([file]);
    },
    [uploadReferenceImages],
  );

  const removeReferenceImage = useCallback((key: string) => {
    useReferenceImageStore.getState().removeReferenceImage(key);
  }, []);

  const submitGeneration = useCallback(
    async (params: {
      draft: string;
      isSubmitting: boolean;
      setIsSubmitting: (v: boolean) => void;
      setDraft: (v: string) => void;
    }) => {
      const { draft, isSubmitting, setIsSubmitting, setDraft } = params;
      const userText = draft.trim();
      const wb = useWorkbenchStore.getState();
      const state = wb.state;
      const model = state
        ? (wb.models.find((m) => m.available && m.id === state.modelId) ?? null)
        : null;

      if (!userText || isSubmitting || !state || !model) return;

      const userMessage = createMessage("user", userText);
      const conv = useConversationStore.getState();
      const ref = useReferenceImageStore.getState();
      const gen = useGenerationStore.getState();

      const nextMessages: ConversationMessage[] = [
        ...conv.messages,
        userMessage,
      ];
      const requestState = state;

      conv.setMessages(nextMessages);
      setDraft("");
      setError("generation", null);
      gen.setProgress(0);
      setIsSubmitting(true);

      let failureFallback = "生成请求没有提交成功。请稍后重试。";

      try {
        failureFallback = "对话创建失败。请稍后重试。";
        const targetConversationId = await ensureConversation(userText);

        gen.setStatus("pending");
        gen.setProgress(8);
        failureFallback = "生成请求没有提交成功。请稍后重试。";

        // 仅在用户显式勾选「参考当前图」时，将当前图作为来源图。
        const sourceImageId =
          ref.useCurrentImageAsReference &&
          gen.activeGeneration?.conversationId === targetConversationId
            ? selectedActiveImage(gen.activeGeneration, gen.activeImageId)?.id
            : undefined;
        const assistantMessageText = "已收到，开始生成。";

        const payload = await submitGenerationRequest({
          conversationId: targetConversationId,
          userMessage: userText,
          assistantMessage: assistantMessageText,
          modelId: requestState.modelId,
          image2Mode: requestState.image2Mode,
          providerChannelId: requestState.providerChannelId,
          prompt: userText,
          size: requestState.size,
          n: requestState.n,
          outputFormat: requestState.outputFormat,
          background: requestState.background,
          outputCompression: requestState.outputCompression,
          referenceImageKeys: ref.uploadedReferenceImages.map(
            (image) => image.key,
          ),
          sourceImageIds: sourceImageId ? [sourceImageId] : [],
        });

        const acceptedProviderChannelId = model.providerChannels?.length
          ? (payload.providerChannelId ??
            requestState.providerChannelId ??
            model.providerChannels[0]?.id ??
            null)
          : null;

        const pendingGeneration: WorkbenchGeneration = {
          id: payload.generationId,
          conversationId: targetConversationId,
          modelId: requestState.modelId,
          prompt: userText,
          status: payload.status,
          createdAt: new Date().toISOString(),
          providerChannelId: model.providerChannels?.length
            ? acceptedProviderChannelId
            : null,
          providerChannelName: model.providerChannels?.length
            ? (model.providerChannels?.find(
                (channel) => channel.id === acceptedProviderChannelId,
              )?.displayName ??
              getImage2ProviderChannelName(acceptedProviderChannelId))
            : null,
          progress: 0,
          images: [],
        };
        const assistantMessage = createMessage(
          "assistant",
          assistantMessageText,
        );
        assistantMessage.generationId = payload.generationId;
        assistantMessage.generationPrompt = userText;

        useConversationStore.getState().appendMessage(assistantMessage);
        useWorkbenchStore
          .getState()
          .setCredits((current) =>
            Math.max(0, current - payload.estimatedCredits),
          );
        gen.setStatus(statusFromGeneration(payload.status));
        gen.setProgress(0);
        gen.setQueueNotice(
          payload.status === "PENDING"
            ? payload.workerOnline
              ? `任务已入队，前方约 ${payload.queueWaiting ?? 0} 个任务。`
              : "任务已入队，但生成 worker 未在线；请启动 pnpm worker 或 pnpm dev:all。"
            : null,
        );
        useReferenceImageStore.getState().clearReferenceImages();
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
        gen.setStatus("failed");
        gen.setProgress(0);
        gen.setQueueNotice(null);
        setError("generation", message);
        useConversationStore
          .getState()
          .setMessages((current) =>
            current.filter((item) => item.id !== userMessage.id),
          );
        appendAssistantError(`${message} 你可以修改描述后重新发送。`);
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      appendAssistantError,
      ensureConversation,
      openGenerationStream,
      redirectToLogin,
      setError,
    ],
  );

  return {
    eventSourceRef,
    closeGenerationStream,
    redirectToLogin,
    resetWorkspaceForNewConversation,
    applyConversation,
    clearCurrentConversationMessages,
    updateConversationMessage,
    archiveConversation,
    clearAllConversations,
    uploadReferenceImage,
    uploadReferenceImages,
    removeReferenceImage,
    submitGeneration,
    clearAllErrors,
  };
}
