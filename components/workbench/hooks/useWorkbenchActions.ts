"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef } from "react";

import { friendlyErrorMessage } from "@/components/shared/error-copy";
import {
  isUnauthorizedError,
  readApiResponse,
} from "@/components/workbench/lib/api-client";
import {
  WELCOME_MESSAGE,
  conversationTitleFromText,
  createMessage,
} from "@/components/workbench/lib/messages";
import { statusFromGeneration } from "@/components/workbench/lib/workbench-state";
import { useConversationStore } from "@/components/workbench/stores/conversation-store";
import { useErrorStore } from "@/components/workbench/stores/error-store";
import { useGenerationStore } from "@/components/workbench/stores/generation-store";
import { useReferenceImageStore } from "@/components/workbench/stores/reference-image-store";
import { useWorkbenchStore } from "@/components/workbench/stores/workbench-store";
import type {
  UploadedReferenceImage,
  WorkbenchGeneration,
} from "@/components/workbench/types";
import type {
  ConversationMessage,
  ConversationView,
} from "@/lib/conversation";
import { getImage2ProviderChannelName } from "@/lib/provider-channels";

type UploadedReferenceImageView = Omit<UploadedReferenceImage, "previewUrl">;

interface UserView {
  id: string;
  credits: number;
}

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
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
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
    router.replace("/app");
  }, [clearConversationState, router, setError]);

  const loadMe = useCallback(async () => {
    try {
      const response = await fetch("/api/me", { cache: "no-store" });
      const data = await readApiResponse<UserView>(
        response,
        "账户状态暂时无法读取。",
      );
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

  const mergeGeneration = useCallback((next: WorkbenchGeneration) => {
    useGenerationStore.getState().mergeGeneration(next);

    if (next.conversationId) {
      const latestImage = next.images.at(-1);
      const imageUrl = latestImage?.src ?? latestImage?.url ?? null;
      const thumbnailUrl = latestImage?.thumbnailUrl ?? imageUrl;

      useConversationStore.getState().setConversations((current) =>
        current.map((item) =>
          item.id === next.conversationId
            ? {
                ...item,
                lastMessageAt: new Date().toISOString(),
                thumbnailUrl: thumbnailUrl ?? item.thumbnailUrl,
                generationCount: Math.max(item.generationCount, 1),
              }
            : item,
        ),
      );
    }
  }, []);

  const openGenerationStream = useCallback(
    (generationId: string) => {
      eventSourceRef.current?.close();

      const events = new EventSource(
        `/api/generations/${generationId}/stream`,
      );
      eventSourceRef.current = events;

      events.addEventListener("update", (event) => {
        const next = JSON.parse(
          (event as MessageEvent).data,
        ) as WorkbenchGeneration;
        mergeGeneration(next);
        const nextStatus = statusFromGeneration(next.status);
        const gen = useGenerationStore.getState();
        gen.setStatus(nextStatus);

        if (nextStatus === "pending") {
          gen.setProgress(next.progress ?? 12);
          gen.setQueueNotice((current) => current ?? "任务正在等待生成 worker 消费。");
        }

        if (nextStatus === "running") {
          gen.setProgress(next.progress ?? 62);
          gen.setQueueNotice(null);
        }

        if (nextStatus === "failed") {
          gen.setProgress(0);
          gen.setQueueNotice(null);
          const message = friendlyErrorMessage(
            {
              code: next.errorCode ?? undefined,
              message: next.errorMessage ?? undefined,
            },
            "生成没有完成。请稍后重试，或换一个模型再发送。",
          );
          setError("generation", message);
          appendAssistantError(message);
        }

        if (nextStatus === "succeeded") {
          const latestImage = next.images.at(-1);
          gen.setProgress(100);
          gen.setQueueNotice(null);
          useConversationStore.getState().setMessages((current) =>
            current.map((message) =>
              message.generationId === next.id
                ? {
                    ...message,
                    imageId: latestImage?.id,
                    imageUrl: latestImage?.src ?? latestImage?.url,
                    images: next.images,
                    thumbnailUrl: latestImage?.thumbnailUrl,
                    generationStatus: next.status,
                    generationProvider: next.provider ?? null,
                    generationProviderChannelId:
                      next.providerChannelId ?? null,
                    generationProviderChannelName:
                      next.providerChannelName ?? null,
                    generationProviderAccountName:
                      next.providerAccountName ?? null,
                    generationStartedAt: next.startedAt ?? null,
                    generationFinishedAt: next.finishedAt ?? null,
                    generationProgress: next.progress ?? 100,
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

        const gen = useGenerationStore.getState();
        gen.setStatus("failed");
        gen.setProgress(0);
        setError("generation", message);
        appendAssistantError(message);
        events.close();
        eventSourceRef.current = null;
        void loadMe();
      });
    },
    [appendAssistantError, loadMe, mergeGeneration, setError],
  );

  const applyConversation = useCallback(
    (conversation: ConversationView) => {
      closeGenerationStream();

      const conv = useConversationStore.getState();
      conv.setConversationId(conversation.id);
      conv.setConversationTitle(conversation.title);
      useReferenceImageStore.setState({ useCurrentImageAsReference: false });
      conv.setMessages(
        conversation.messages.length
          ? conversation.messages
          : [WELCOME_MESSAGE],
      );

      const lastGenerationMessage = [...conversation.messages]
        .reverse()
        .find((message) => message.generationId);

      const gen = useGenerationStore.getState();

      if (lastGenerationMessage?.generationId) {
        const nextStatus = statusFromGeneration(
          lastGenerationMessage.generationStatus ?? "SUCCEEDED",
        );
        const image =
          lastGenerationMessage.images ??
          (lastGenerationMessage.imageUrl || lastGenerationMessage.imageId
            ? [
                {
                  id: lastGenerationMessage.imageId,
                  src: lastGenerationMessage.imageUrl,
                  url: lastGenerationMessage.imageUrl,
                  downloadUrl: lastGenerationMessage.imageUrl,
                  thumbnailUrl: lastGenerationMessage.thumbnailUrl,
                },
              ]
            : []);

        gen.setActiveGeneration({
          id: lastGenerationMessage.generationId,
          conversationId: conversation.id,
          prompt: lastGenerationMessage.content,
          status: lastGenerationMessage.generationStatus ?? "SUCCEEDED",
          createdAt:
            lastGenerationMessage.createdAt ?? new Date().toISOString(),
          provider: lastGenerationMessage.generationProvider ?? null,
          providerChannelId:
            lastGenerationMessage.generationProviderChannelId ?? null,
          providerChannelName:
            lastGenerationMessage.generationProviderChannelName ?? null,
          providerAccountName:
            lastGenerationMessage.generationProviderAccountName ?? null,
          startedAt: lastGenerationMessage.generationStartedAt ?? null,
          finishedAt: lastGenerationMessage.generationFinishedAt ?? null,
          progress: lastGenerationMessage.generationProgress ?? null,
          images: image,
        });
        gen.setStatus(nextStatus);
        gen.setProgress(
          lastGenerationMessage.generationProgress ??
            (nextStatus === "succeeded" ? 100 : 0),
        );

        if (nextStatus === "pending" || nextStatus === "running") {
          openGenerationStream(lastGenerationMessage.generationId);
        }
      } else {
        gen.setActiveGeneration(null);
        gen.setStatus("idle");
        gen.setProgress(0);
      }
    },
    [closeGenerationStream, openGenerationStream],
  );

  const ensureConversation = useCallback(
    async (firstUserMessage: string): Promise<string> => {
      const existing = useConversationStore.getState().conversationId;
      if (existing) return existing;

      try {
        const conversation = await readApiResponse<ConversationView>(
          await fetch("/api/conversations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: conversationTitleFromText(firstUserMessage),
            }),
          }),
          "对话创建失败。请稍后重试。",
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
        router.replace(`/app?conversation=${conversation.id}`);

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
        const conversation = await readApiResponse<ConversationView>(
          await fetch(
            `/api/conversations/${conversationId}/messages/${messageId}`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ content }),
            },
          ),
          "消息编辑失败。",
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
        await readApiResponse<ConversationView>(
          await fetch(`/api/conversations/${targetConversationId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ archived: true }),
          }),
          "历史对话删除失败。",
        );

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
      await readApiResponse<{ archived: number }>(
        await fetch("/api/conversations", { method: "DELETE" }),
        "历史对话清空失败。",
      );
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

  const uploadReferenceImage = useCallback(
    async (file: File) => {
      const { state, models } = useWorkbenchStore.getState();
      const model = models.find((m) => m.id === state?.modelId);
      const ref = useReferenceImageStore.getState();
      const gen = useGenerationStore.getState();

      if (!model?.capabilities.supportsReferenceImage) {
        setError("reference", "当前模型不支持参考图。");
        return;
      }

      const reservedCurrentImageSlot =
        ref.useCurrentImageAsReference && gen.activeGeneration?.images.at(-1)?.id
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

      ref.setIsUploadingReference(true);
      setError("reference", null);

      try {
        const formData = new FormData();
        formData.append("file", file);

        const uploaded = await readApiResponse<UploadedReferenceImageView>(
          await fetch("/api/upload", { method: "POST", body: formData }),
          "参考图上传失败。",
        );
        const previewUrl = URL.createObjectURL(file);

        useReferenceImageStore
          .getState()
          .addReferenceImage({ ...uploaded, previewUrl });
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
        ? wb.models.find((m) => m.available && m.id === state.modelId) ?? null
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
        const sourceImageId =
          ref.useCurrentImageAsReference &&
          gen.activeGeneration?.conversationId === targetConversationId
            ? gen.activeGeneration.images.at(-1)?.id
            : undefined;
        const assistantMessageText = "已收到，开始生成。";

        const payload = await readApiResponse<{
          generationId: string;
          status: string;
          estimatedCredits: number;
          providerChannelId?:
            | typeof requestState.providerChannelId
            | null;
          workerOnline?: boolean;
          queueWaiting?: number;
        }>(
          await fetch("/api/generations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              conversationId: targetConversationId,
              userMessage: userText,
              assistantMessage: assistantMessageText,
              modelId: requestState.modelId,
              providerChannelId: requestState.providerChannelId,
              prompt: userText,
              aspectRatio: requestState.aspectRatio,
              resolution: requestState.resolution,
              n: requestState.n,
              outputFormat: requestState.outputFormat,
              background: requestState.background,
              outputCompression: requestState.outputCompression,
              referenceImageKeys: ref.uploadedReferenceImages.map(
                (image) => image.key,
              ),
              sourceImageIds: sourceImageId ? [sourceImageId] : [],
            }),
          }),
          "生成请求没有提交成功。请稍后重试。",
        );

        const acceptedProviderChannelId = model.providerChannels?.length
          ? payload.providerChannelId ??
            requestState.providerChannelId ??
            model.providerChannels[0]?.id ??
            null
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
            ? model.providerChannels?.find(
                (channel) => channel.id === acceptedProviderChannelId,
              )?.displayName ??
              getImage2ProviderChannelName(acceptedProviderChannelId)
            : null,
          progress: 0,
          images: [],
        };
        const assistantMessage = createMessage(
          "assistant",
          assistantMessageText,
        );
        assistantMessage.generationId = payload.generationId;

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
      mergeGeneration,
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
    removeReferenceImage,
    submitGeneration,
    clearAllErrors,
  };
}
