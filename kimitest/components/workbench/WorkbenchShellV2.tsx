"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { History } from "lucide-react";

import { HistoryDrawer } from "@/components/workbench/HistoryDrawer";
import { InfiniteCanvas } from "@/components/workbench/InfiniteCanvas";
import { ConversationMode } from "@/components/workbench/ConversationMode";
import { PPTGenerator } from "@/components/workbench/PPTGenerator";
import type { WorkbenchView } from "@/components/workbench/WorkbenchShellControls";
import {
  CompletionToast,
  ConversationListPopover,
  ParameterPopover,
} from "@/components/workbench/WorkbenchShellOverlays";
import { WorkbenchShellTopBar } from "@/components/workbench/WorkbenchShellTopBar";
import { WorkbenchStudioPanel } from "@/components/workbench/WorkbenchStudioPanel";
import { useBootstrap } from "@/components/workbench/hooks/useBootstrap";
import { useWorkbenchActions } from "@/components/workbench/hooks/useWorkbenchActions";
import {
  parseAspect,
  resolveStageAspect,
} from "@/components/workbench/lib/workbench-shell-utils";
import { useConversationStore } from "@/components/workbench/stores/conversation-store";
import {
  selectAggregatedErrorMessage,
  useErrorStore,
} from "@/components/workbench/stores/error-store";
import { useGenerationStore } from "@/components/workbench/stores/generation-store";
import { useReferenceImageStore } from "@/components/workbench/stores/reference-image-store";
import { useWorkbenchStore } from "@/components/workbench/stores/workbench-store";
import { useToast } from "@/components/ui";
import { estimateCost } from "@/lib/credits";
import {
  aspectRatioForSize,
  resolutionTierForSize,
} from "@/lib/models/options";
import { writeWorkbenchPreferences } from "@/lib/workbench-preferences";
import { cn } from "@/lib/utils";

interface WorkbenchShellV2Props {
  initialConversationId?: string | null;
  initialMode?: "studio" | "canvas" | "ppt";
}

export function WorkbenchShellV2({
  initialConversationId = null,
  initialMode = "studio",
}: WorkbenchShellV2Props): React.ReactElement {
  const models = useWorkbenchStore((s) => s.models);
  const state = useWorkbenchStore((s) => s.state);
  const credits = useWorkbenchStore((s) => s.credits);
  const accountId = useWorkbenchStore((s) => s.accountId);
  const isBooting = useWorkbenchStore((s) => s.isBooting);
  const setWorkbenchState = useWorkbenchStore((s) => s.setState);

  const conversationId = useConversationStore((s) => s.conversationId);
  const conversationTitle = useConversationStore((s) => s.conversationTitle);
  const messages = useConversationStore((s) => s.messages);
  const conversations = useConversationStore((s) => s.conversations);

  const status = useGenerationStore((s) => s.status);
  const generationProgress = useGenerationStore((s) => s.progress);
  const queueNotice = useGenerationStore((s) => s.queueNotice);
  const history = useGenerationStore((s) => s.history);
  const activeGeneration = useGenerationStore((s) => s.activeGeneration);
  const activeImageId = useGenerationStore((s) => s.activeImageId);
  const selectGeneration = useGenerationStore((s) => s.selectGeneration);
  const setActiveImageId = useGenerationStore((s) => s.setActiveImageId);

  const uploadedReferenceImages = useReferenceImageStore(
    (s) => s.uploadedReferenceImages,
  );
  const isUploadingReference = useReferenceImageStore(
    (s) => s.isUploadingReference,
  );
  const useCurrentImageAsReference = useReferenceImageStore(
    (s) => s.useCurrentImageAsReference,
  );
  const setUseCurrentImageAsReference = useReferenceImageStore(
    (s) => s.setUseCurrentImageAsReference,
  );

  const errors = useErrorStore((s) => s.errors);
  const referenceUploadError = errors.reference ?? null;
  const generationError = errors.generation ?? null;
  const modelsError = errors.models ?? null;

  const [draft, setDraft] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [paramsOpen, setParamsOpen] = useState(false);
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [conversationsOpen, setConversationsOpen] = useState(false);
  const [completionToast, setCompletionToast] = useState<string | null>(null);
  const { toast } = useToast();
  const previousStatusRef = useRef(status);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isCanvasMode = initialMode === "canvas";
  // 工作台内部视图：单图生成 / PPT 生成 / 对话（画布模式是独立页面，不参与此切换）。
  const [view, setView] = useState<WorkbenchView>(
    initialMode === "ppt" ? "ppt" : "studio",
  );
  const showPPT = !isCanvasMode && view === "ppt";
  const showChat = !isCanvasMode && view === "chat";
  // 单图专属 UI（命令栏、时间线、历史抽屉）在 PPT / 对话模式下隐藏。
  const showStudioChrome = !isCanvasMode && !showPPT && !showChat;

  const actions = useWorkbenchActions();
  const { closeGenerationStream } = actions;
  useBootstrap(
    initialConversationId,
    actions.applyConversation,
    actions.redirectToLogin,
  );

  const availableModels = useMemo(
    () => models.filter((m) => m.available),
    [models],
  );
  const model = state
    ? (availableModels.find((m) => m.id === state.modelId) ?? null)
    : null;

  const activeImages = activeGeneration?.images ?? [];
  const activeImage =
    activeImages.find((image) => image.id && image.id === activeImageId) ??
    activeImages.at(-1) ??
    null;
  const activeSelectedImageId = activeImage?.id ?? null;
  const activeImageIndex = Math.max(
    activeImages.findIndex(
      (image) =>
        image === activeImage ||
        (activeSelectedImageId &&
          image.id &&
          image.id === activeSelectedImageId),
    ),
    0,
  );
  const activeImageReferenceLabel =
    activeImages.length > 1
      ? `参考选中图 v${activeImageIndex + 1}`
      : "参考当前图";

  const estimate = useMemo(() => {
    if (!model || !state) return 0;
    const usesReference =
      uploadedReferenceImages.length > 0 ||
      Boolean(
        model.capabilities.supportsReferenceImage &&
        activeSelectedImageId &&
        useCurrentImageAsReference,
      );
    return estimateCost(model, {
      n: state.n,
      size: state.size,
      image2Mode: state.image2Mode,
      resolution: resolutionTierForSize(state.size),
      aspectRatio: aspectRatioForSize(state.size),
      outputFormat: state.outputFormat,
      background: state.background,
      usesReference,
    });
  }, [
    activeSelectedImageId,
    model,
    state,
    uploadedReferenceImages.length,
    useCurrentImageAsReference,
  ]);
  const hasInsufficientCredits = Boolean(model && state && estimate > credits);

  useEffect(() => {
    if (isBooting || !state) return;
    writeWorkbenchPreferences(
      {
        modelId: state.modelId,
        size: state.size,
        providerChannelId: state.providerChannelId,
      },
      accountId,
    );
  }, [accountId, isBooting, state]);

  useEffect(
    () => () => {
      closeGenerationStream();
      const refs = useReferenceImageStore.getState().uploadedReferenceImages;
      for (const image of refs) {
        URL.revokeObjectURL(image.previewUrl);
      }
    },
    [closeGenerationStream],
  );

  // Completion toast
  useEffect(() => {
    const prev = previousStatusRef.current;
    if (prev === "running" && status === "succeeded") {
      const used =
        activeGeneration?.startedAt && activeGeneration?.finishedAt
          ? Math.max(
              0.1,
              (new Date(activeGeneration.finishedAt).getTime() -
                new Date(activeGeneration.startedAt).getTime()) /
                1000,
            )
          : null;
      setCompletionToast(
        `已生成 · ${used ? `用时 ${used.toFixed(1)}s · ` : ""}${activeGeneration?.costCredits ?? 0} 点`,
      );
      const t = setTimeout(() => setCompletionToast(null), 3200);
      previousStatusRef.current = status;
      return () => clearTimeout(t);
    }
    if (prev === "running" && (status === "failed" || status === "canceled")) {
      toast({
        title: status === "failed" ? "生成失败" : "生成已取消",
        description:
          status === "failed"
            ? (generationError ?? "任务没有完成，请调整描述后再试一次。")
            : "任务已取消，未开始的点数会退回账户余额。",
        variant: "danger",
      });
      previousStatusRef.current = status;
      return;
    }
    previousStatusRef.current = status;
  }, [status, activeGeneration, toast, generationError]);

  const supportsReferenceImage = Boolean(
    model?.capabilities.supportsReferenceImage,
  );
  const canUseCurrentImageReference = Boolean(
    supportsReferenceImage && activeSelectedImageId,
  );
  const currentImageReferenceSlotUsed =
    canUseCurrentImageReference && useCurrentImageAsReference ? 1 : 0;
  const maxUploadedReferenceImages = model
    ? Math.max(
        0,
        model.capabilities.maxReferenceImages - currentImageReferenceSlotUsed,
      )
    : 0;

  const conversationGenerations = useMemo(() => {
    const fromHistory = history.filter(
      (item) =>
        conversationId &&
        item.conversationId === conversationId &&
        item.images.some((img) => img.src ?? img.url),
    );
    const fromMessages = messages
      .filter((message) => message.generationId)
      .map((message) => ({
        id: message.generationId!,
        conversationId,
        prompt: message.generationPrompt ?? message.content,
        status: message.generationStatus ?? "SUCCEEDED",
        createdAt: message.createdAt ?? new Date().toISOString(),
        provider: message.generationProvider ?? null,
        providerChannelId: message.generationProviderChannelId ?? null,
        providerChannelName: message.generationProviderChannelName ?? null,
        providerAccountName: message.generationProviderAccountName ?? null,
        startedAt: message.generationStartedAt ?? null,
        finishedAt: message.generationFinishedAt ?? null,
        progress: message.generationProgress ?? null,
        images: message.images ?? [],
      }));

    const merged = [...fromHistory, ...fromMessages];
    const unique = new Map<string, (typeof merged)[number]>();
    for (const item of merged) {
      unique.set(item.id, item);
    }

    return [...unique.values()].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }, [conversationId, history, messages]);
  const activeGenIndex = activeGeneration
    ? conversationGenerations.findIndex((g) => g.id === activeGeneration.id)
    : -1;
  const hasActivePrompt = Boolean(activeGeneration?.prompt);

  const submitDisabled =
    isSubmitting ||
    isUploadingReference ||
    !draft.trim() ||
    !state ||
    !model ||
    isBooting ||
    hasInsufficientCredits;
  const submitDisabledReason = hasInsufficientCredits
    ? `余额不足，本次预计需要 ${estimate} 点，当前余额 ${credits} 点。请降低张数或分辨率，或联系管理员充值。`
    : null;

  const submit = useCallback(() => {
    if (submitDisabled) return;
    void actions.submitGeneration({
      draft,
      isSubmitting,
      setIsSubmitting,
      setDraft,
    });
  }, [actions, draft, isSubmitting, submitDisabled]);

  // 「优化提示词」：用 DeepSeek 把当前草稿润色成更具体的出图 prompt。
  // 未配置 DeepSeek 时端点回退原文，前端无感降级。
  const optimizeDraft = useCallback(async () => {
    const prompt = draft.trim();
    if (!prompt || isOptimizing || isSubmitting) return;

    setIsOptimizing(true);
    try {
      const response = await fetch("/api/prompt/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const payload = (await response.json().catch(() => null)) as {
        data?: { prompt?: string; optimized?: boolean };
      } | null;

      if (response.ok && payload?.data?.prompt) {
        setDraft(payload.data.prompt);
        setCompletionToast(
          payload.data.optimized
            ? "提示词已优化 ✨"
            : "DeepSeek 未配置，提示词未改动",
        );
      } else {
        setCompletionToast("优化失败，已保留原提示词");
      }
    } catch {
      setCompletionToast("优化失败，已保留原提示词");
    } finally {
      setIsOptimizing(false);
    }
  }, [draft, isOptimizing, isSubmitting]);

  // 通用：任何提示 toast 显示后自动消失（生成完成 toast 自带定时器，这里兜底其余来源）。
  useEffect(() => {
    if (!completionToast) return;
    const t = setTimeout(() => setCompletionToast(null), 3200);
    return () => clearTimeout(t);
  }, [completionToast]);

  // Global keyboard shortcuts
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key === "/") {
        e.preventDefault();
        setParamsOpen((v) => !v);
      } else if (meta && e.key === "k") {
        e.preventDefault();
        setConversationsOpen((v) => !v);
      } else if (e.key === "Escape") {
        setParamsOpen(false);
        setHistoryDrawerOpen(false);
        setConversationsOpen(false);
      } else if (
        !meta &&
        document.activeElement?.tagName !== "TEXTAREA" &&
        document.activeElement?.tagName !== "INPUT"
      ) {
        if (e.key === "ArrowLeft" && activeGenIndex > 0) {
          const prev = conversationGenerations[activeGenIndex - 1];
          if (prev) selectGeneration(prev);
        } else if (
          e.key === "ArrowRight" &&
          activeGenIndex >= 0 &&
          activeGenIndex < conversationGenerations.length - 1
        ) {
          const nextGen = conversationGenerations[activeGenIndex + 1];
          if (nextGen) selectGeneration(nextGen);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeGenIndex, conversationGenerations, selectGeneration]);

  const isBusy = status === "pending" || status === "running";
  const aggregatedServiceError = selectAggregatedErrorMessage(errors, [
    "models",
    "account",
    "history",
    "conversation",
  ]);

  const aspectLabel = state ? aspectRatioForSize(state.size) : "—";
  const stageAspect = useMemo(() => {
    if (isBusy) {
      return parseAspect(aspectLabel);
    }

    return resolveStageAspect(
      activeImage,
      activeGeneration?.aspectRatio ?? null,
      aspectLabel,
    );
  }, [activeGeneration?.aspectRatio, activeImage, aspectLabel, isBusy]);

  return (
    <div className="relative flex min-h-full w-full flex-col overflow-x-hidden overflow-y-auto bg-background">
      <WorkbenchShellTopBar
        conversationTitle={conversationTitle}
        isCanvasMode={isCanvasMode}
        model={model}
        state={state}
        view={view}
        onNewConversation={actions.resetWorkspaceForNewConversation}
        onToggleConversations={() => setConversationsOpen((v) => !v)}
        onToggleParams={() => setParamsOpen((v) => !v)}
        onViewChange={setView}
      />

      {/* 主区：Studio 两栏（左历史 + 右舞台/命令栏）；PPT/对话/画布单栏 */}
      {showStudioChrome ? (
        <WorkbenchStudioPanel
          activeGeneration={activeGeneration}
          activeGenIndex={activeGenIndex}
          activeImage={activeImage}
          activeImageReferenceLabel={activeImageReferenceLabel}
          activeImages={activeImages}
          activeSelectedImageId={activeSelectedImageId}
          aggregatedServiceError={aggregatedServiceError}
          aspectLabel={aspectLabel}
          canUseCurrentImageReference={canUseCurrentImageReference}
          conversationGenerations={conversationGenerations}
          credits={credits}
          draft={draft}
          estimate={estimate}
          generationError={generationError}
          generationProgress={generationProgress}
          isBooting={isBooting}
          isBusy={isBusy}
          isOptimizing={isOptimizing}
          isSubmitting={isSubmitting}
          isUploadingReference={isUploadingReference}
          maxUploadedReferenceImages={maxUploadedReferenceImages}
          modelName={model?.displayName ?? null}
          modelsError={modelsError}
          queueNotice={queueNotice}
          referenceUploadError={referenceUploadError}
          showActivePrompt={hasActivePrompt}
          stageAspect={stageAspect}
          status={status}
          submitDisabled={submitDisabled}
          submitDisabledReason={submitDisabledReason}
          supportsReferenceImage={supportsReferenceImage}
          textareaRef={textareaRef}
          uploadedReferenceImages={uploadedReferenceImages}
          useCurrentImageAsReference={useCurrentImageAsReference}
          onDraftChange={setDraft}
          onOptimize={optimizeDraft}
          onRemoveReference={actions.removeReferenceImage}
          onSelectGeneration={selectGeneration}
          onSelectedImageIdChange={setActiveImageId}
          onSubmit={submit}
          onToggleCurrentImageReference={setUseCurrentImageAsReference}
          onUploadReference={
            supportsReferenceImage ? actions.uploadReferenceImage : undefined
          }
          onUploadReferences={
            supportsReferenceImage ? actions.uploadReferenceImages : undefined
          }
        />
      ) : (
        <main
          className={cn(
            "relative flex min-h-[460px] shrink-0 py-8 md:py-10",
            isCanvasMode
              ? "items-stretch justify-stretch px-3 md:px-4"
              : "items-start justify-center px-4 md:px-12",
          )}
        >
          {showPPT ? (
            <div className="w-full max-w-5xl">
              <PPTGenerator
                models={availableModels}
                selectedModelId={state?.modelId ?? ""}
                credits={credits}
                conversationId={conversationId ?? undefined}
                onGenerationComplete={() =>
                  setCompletionToast("PPT 生成完成 ✨")
                }
              />
            </div>
          ) : showChat ? (
            <div className="w-full max-w-5xl">
              <ConversationMode
                models={availableModels}
                selectedModelId={state?.modelId ?? ""}
                credits={credits}
                conversationId={conversationId ?? undefined}
              />
            </div>
          ) : (
            <InfiniteCanvas
              accountId={accountId}
              conversationId={conversationId}
              generations={conversationGenerations}
              activeGeneration={activeGeneration}
              activeImage={activeImage}
              className="h-full"
            />
          )}
        </main>
      )}

      {/* Right edge: history rail trigger (mobile only — md+ 用常驻左栏) */}
      {showStudioChrome ? (
        <button
          type="button"
          aria-label="打开历史画廊"
          onClick={() => setHistoryDrawerOpen(true)}
          className="group absolute right-0 top-1/2 z-30 flex h-24 w-7 -translate-y-1/2 items-center justify-center rounded-l-[14px] border border-r-0 border-ink/[0.09] bg-surface-2/70 text-text-muted shadow-[inset_0_1px_0_rgb(255_255_255/0.05)] transition-[transform,background-color,color] hover:bg-ink/[0.08] hover:text-foreground md:hidden"
        >
          <History
            size={13}
            strokeWidth={1.5}
            className="transition-transform duration-[var(--duration-fast)] group-hover:scale-x-110"
          />
        </button>
      ) : null}

      <ParameterPopover
        open={paramsOpen}
        state={state}
        models={models}
        availableModels={availableModels}
        isBooting={isBooting}
        onClose={() => setParamsOpen(false)}
        onStateChange={setWorkbenchState}
      />

      <ConversationListPopover
        open={conversationsOpen}
        conversations={conversations}
        activeId={conversationId}
        onClose={() => setConversationsOpen(false)}
        onClearAll={actions.clearAllConversations}
        onArchive={actions.archiveConversation}
      />

      {/* Backdrop close */}
      {paramsOpen || conversationsOpen ? (
        <div
          className="absolute inset-0 z-10"
          onClick={() => {
            setParamsOpen(false);
            setConversationsOpen(false);
          }}
        />
      ) : null}

      {/* History drawer */}
      <HistoryDrawer
        open={historyDrawerOpen}
        onClose={() => setHistoryDrawerOpen(false)}
        history={history}
        activeId={activeGeneration?.id ?? null}
        onSelect={(g) => {
          selectGeneration(g);
          setHistoryDrawerOpen(false);
        }}
      />

      <CompletionToast
        message={completionToast}
        hasActivePrompt={hasActivePrompt}
      />
    </div>
  );
}
