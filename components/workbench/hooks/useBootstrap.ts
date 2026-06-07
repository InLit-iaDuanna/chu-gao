"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect } from "react";

import { friendlyErrorMessage } from "@/components/shared/error-copy";
import {
  isMissingConversationError,
  isUnauthorizedError,
  readApiResponse,
} from "@/components/workbench/lib/api-client";
import { WELCOME_MESSAGE } from "@/components/workbench/lib/messages";
import {
  DEFAULT_MODEL_ID,
  initialStateFor,
} from "@/components/workbench/lib/workbench-state";
import { useConversationStore } from "@/components/workbench/stores/conversation-store";
import { useErrorStore } from "@/components/workbench/stores/error-store";
import { useGenerationStore } from "@/components/workbench/stores/generation-store";
import { useWorkbenchStore } from "@/components/workbench/stores/workbench-store";
import type {
  ConversationSummaryView,
  ConversationView,
} from "@/lib/conversation";
import type { PublicModelDefinition } from "@/lib/models/types";
import { readWorkbenchPreferences } from "@/lib/workbench-preferences";

import type { WorkbenchGeneration } from "@/components/workbench/types";

interface UserView {
  id: string;
  credits: number;
}

interface GenerationListView {
  items: WorkbenchGeneration[];
  nextCursor: string | null;
}

interface ConversationListView {
  items: ConversationSummaryView[];
}

export function useBootstrap(
  requestedConversationId: string | null,
  applyConversation: (conversation: ConversationView) => void,
  redirectToLogin: () => void,
) {
  const router = useRouter();
  const setError = useErrorStore((s) => s.setError);
  const clearAllErrors = useErrorStore((s) => s.clearAll);

  const loadInitialState = useCallback(
    async (isCanceled?: () => boolean) => {
      useWorkbenchStore.setState({ isBooting: true });
      clearAllErrors();

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

      if (isCanceled?.()) return;

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

      const wb = useWorkbenchStore.getState();

      if (modelsResult.status === "fulfilled") {
        wb.setModels(modelsResult.value);
        const preferenceUserId =
          meResult.status === "fulfilled" ? meResult.value.id : wb.accountId;
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
        wb.setState(
          firstAvailable ? initialStateFor(firstAvailable, preferences) : null,
        );
      } else {
        wb.setModels([]);
        wb.setState(null);
        setError(
          "models",
          friendlyErrorMessage(
            modelsResult.reason instanceof Error
              ? modelsResult.reason.message
              : null,
            "模型列表暂时无法读取。",
          ),
        );
      }

      if (meResult.status === "fulfilled") {
        wb.setCredits(meResult.value.credits);
        wb.setAccountId(meResult.value.id);
      } else {
        wb.setCredits(0);
        wb.setAccountId(null);
        setError(
          "account",
          friendlyErrorMessage(
            meResult.reason instanceof Error ? meResult.reason.message : null,
            "账户状态暂时无法读取。",
          ),
        );
      }

      const gen = useGenerationStore.getState();
      const conv = useConversationStore.getState();

      if (generationsResult.status === "fulfilled") {
        gen.setHistory(generationsResult.value.items);
      } else {
        gen.setHistory([]);
        setError(
          "history",
          friendlyErrorMessage(
            generationsResult.reason instanceof Error
              ? generationsResult.reason.message
              : null,
            "历史记录暂时无法读取。",
          ),
        );
      }

      if (conversationsResult.status === "fulfilled") {
        conv.setConversations(conversationsResult.value.items);
      } else {
        conv.setConversations([]);
        setError(
          "conversation",
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
        conv.setConversationId(null);
        conv.setConversationTitle("新的创作对话");
        conv.setMessages([WELCOME_MESSAGE]);
        gen.setActiveGeneration(null);
        gen.setStatus("idle");
        gen.setProgress(0);

        if (isMissingConversationError(activeConversationResult.reason)) {
          router.replace("/app");
          setError(
            "conversation",
            "这个对话不存在，或不属于当前账户。已切回新的创作对话。",
          );
        } else {
          setError(
            "conversation",
            friendlyErrorMessage(
              activeConversationResult.reason instanceof Error
                ? activeConversationResult.reason.message
                : null,
              "对话暂时无法读取。",
            ),
          );
        }
      } else if (!requestedConversationId) {
        conv.setConversationId(null);
        conv.setConversationTitle("新的创作对话");
        conv.setMessages([WELCOME_MESSAGE]);
      }

      if (
        modelsResult.status === "rejected" ||
        meResult.status === "rejected" ||
        generationsResult.status === "rejected" ||
        conversationsResult.status === "rejected" ||
        activeConversationResult.status === "rejected"
      ) {
        conv.setMessages((current) =>
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

      useWorkbenchStore.setState({ isBooting: false });
    },
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
    };
  }, [loadInitialState]);

  return { loadInitialState };
}
