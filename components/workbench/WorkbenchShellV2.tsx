"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  History,
  ImagePlus,
  Layers,
  MessageSquarePlus,
  Settings as SettingsIcon,
  Sliders,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

import { ImageGallery } from "@/components/workbench/ImageGallery";
import { InfiniteCanvas } from "@/components/workbench/InfiniteCanvas";
import {
  DynamicParamsPanel,
  normalizeWorkbenchState,
} from "@/components/workbench/DynamicParamsPanel";
import { previewImageUrl } from "@/components/workbench/gallery-images";
import { useBootstrap } from "@/components/workbench/hooks/useBootstrap";
import { useWorkbenchActions } from "@/components/workbench/hooks/useWorkbenchActions";
import { WELCOME_MESSAGE } from "@/components/workbench/lib/messages";
import { WORKBENCH_STATUS_LABEL } from "@/components/workbench/lib/workbench-state";
import { useConversationStore } from "@/components/workbench/stores/conversation-store";
import {
  selectAggregatedErrorMessage,
  useErrorStore,
} from "@/components/workbench/stores/error-store";
import { useGenerationStore } from "@/components/workbench/stores/generation-store";
import { useReferenceImageStore } from "@/components/workbench/stores/reference-image-store";
import { useWorkbenchStore } from "@/components/workbench/stores/workbench-store";
import { estimateCost } from "@/lib/credits";
import { IMAGE2_MODE_LABEL } from "@/lib/models/options";
import type { AspectRatio } from "@/lib/models/types";
import { writeWorkbenchPreferences } from "@/lib/workbench-preferences";
import { cn } from "@/lib/utils";

interface WorkbenchShellV2Props {
  initialConversationId?: string | null;
  initialMode?: "studio" | "canvas";
}

const SUBMIT_HINT = "⌘ Enter";

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
  const [paramsOpen, setParamsOpen] = useState(false);
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [conversationsOpen, setConversationsOpen] = useState(false);
  const [completionToast, setCompletionToast] = useState<string | null>(null);
  const previousStatusRef = useRef(status);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isCanvasMode = initialMode === "canvas";

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
      resolution: state.resolution,
      image2Mode: state.image2Mode,
      aspectRatio: state.aspectRatio as AspectRatio,
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
        aspectRatio: state.aspectRatio,
        resolution: state.resolution,
        image2Mode: state.image2Mode,
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
    previousStatusRef.current = status;
  }, [status, activeGeneration]);

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

  const aspectLabel = state?.aspectRatio ?? "—";
  const stageAspect = useMemo(
    () =>
      resolveStageAspect(
        activeImage,
        activeGeneration?.aspectRatio ?? null,
        aspectLabel,
      ),
    [activeGeneration?.aspectRatio, activeImage, aspectLabel],
  );

  return (
    <div className="relative flex h-full min-h-screen w-full flex-col overflow-hidden bg-background">
      {/* Top-left: conversation switcher */}
      <div className="absolute left-4 top-4 z-30">
        <button
          type="button"
          className="group flex h-9 items-center gap-2 rounded-full border border-border bg-surface/80 px-3 text-[12.5px] text-foreground backdrop-blur-md transition-all hover:border-border-strong hover:bg-surface active:scale-[0.97]"
          onClick={() => setConversationsOpen((v) => !v)}
          aria-label="对话切换"
        >
          <Layers size={13} strokeWidth={1.5} className="text-text-muted" />
          <span className="max-w-[180px] truncate font-medium">
            {conversationTitle}
          </span>
          <span className="hidden font-mono text-[10px] text-text-faint sm:inline">
            ⌘K
          </span>
        </button>
      </div>

      {/* Top-right: mini toolbar */}
      <div className="absolute right-4 top-4 z-30 flex items-center gap-2">
        <ToolbarPill
          label={model?.displayName ?? "无模型"}
          sub={
            state
              ? `${state.n}×${state.resolution}${state.image2Mode ? ` · ${IMAGE2_MODE_LABEL[state.image2Mode]}` : ""}`
              : undefined
          }
          icon={Sparkles}
          onClick={() => setParamsOpen((v) => !v)}
        />
        <button
          type="button"
          aria-label="参数面板"
          onClick={() => setParamsOpen((v) => !v)}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface/80 text-text-muted backdrop-blur-md transition-all hover:border-border-strong hover:text-foreground active:scale-[0.97]"
        >
          <Sliders size={14} strokeWidth={1.5} />
        </button>
        <button
          type="button"
          aria-label="新建对话"
          onClick={actions.resetWorkspaceForNewConversation}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface/80 text-text-muted backdrop-blur-md transition-all hover:border-border-strong hover:text-foreground active:scale-[0.97]"
        >
          <MessageSquarePlus size={14} strokeWidth={1.5} />
        </button>
        <Link
          href="/app/settings"
          aria-label="设置"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface/80 text-text-muted backdrop-blur-md transition-all hover:border-border-strong hover:text-foreground active:scale-[0.97]"
        >
          <SettingsIcon size={14} strokeWidth={1.5} />
        </Link>
      </div>

      {/* Conversation timeline (left rail) */}
      <div
        className={cn(
          "pointer-events-none absolute left-4 top-20 z-20 hidden w-10 flex-col items-center justify-center md:flex",
          hasActivePrompt ? "bottom-[31rem]" : "bottom-72",
        )}
      >
        <ConversationTimeline
          messages={messages}
          generations={conversationGenerations}
          activeGenId={activeGeneration?.id ?? null}
          onJump={(g) => selectGeneration(g)}
        />
      </div>

      {/* Stage / Canvas */}
      <main
        className={cn(
          "relative flex min-h-0 flex-1 pt-20",
          isCanvasMode
            ? "items-stretch justify-stretch px-3 md:px-4"
            : "items-center justify-center px-4 md:px-20",
          hasActivePrompt ? "pb-[23rem] md:pb-[31rem]" : "pb-72 md:pb-80",
        )}
      >
        {isCanvasMode ? (
          <InfiniteCanvas
            accountId={accountId}
            conversationId={conversationId}
            generations={conversationGenerations}
            activeGeneration={activeGeneration}
            activeImage={activeImage}
            className="h-full"
          />
        ) : (
          <Stage
            status={status}
            progress={generationProgress}
            images={activeImages}
            selectedImageId={activeSelectedImageId}
            onSelectedImageIdChange={setActiveImageId}
            aspect={stageAspect}
            error={generationError}
            isBusy={isBusy}
          />
        )}
      </main>

      {/* Bottom command bar */}
      <div className="absolute bottom-0 left-0 right-0 z-20 px-4 pb-5 pt-2 md:px-20">
        <div className="pointer-events-none absolute inset-x-0 -top-16 h-16 bg-gradient-to-t from-background to-transparent" />
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-3">
          {activeGeneration?.prompt ? (
            <ActivePromptStrip
              prompt={activeGeneration.prompt}
              activeIndex={activeGenIndex}
              total={conversationGenerations.length}
              onPrevious={() => {
                const prev = conversationGenerations[activeGenIndex - 1];
                if (prev) selectGeneration(prev);
              }}
              onNext={() => {
                const next = conversationGenerations[activeGenIndex + 1];
                if (next) selectGeneration(next);
              }}
            />
          ) : null}
          <CommandBar
            textareaRef={textareaRef}
            value={draft}
            onChange={setDraft}
            onSubmit={submit}
            submitDisabled={submitDisabled}
            submitDisabledReason={submitDisabledReason}
            inputDisabled={isBooting || isSubmitting}
            isBusy={isSubmitting || isBusy}
            referenceImages={uploadedReferenceImages}
            onUploadReference={
              supportsReferenceImage ? actions.uploadReferenceImage : undefined
            }
            onUploadReferences={
              supportsReferenceImage ? actions.uploadReferenceImages : undefined
            }
            onRemoveReference={actions.removeReferenceImage}
            uploadDisabled={
              isBooting ||
              isSubmitting ||
              isUploadingReference ||
              !supportsReferenceImage ||
              uploadedReferenceImages.length >= maxUploadedReferenceImages
            }
            isUploadingReference={isUploadingReference}
            referenceUploadError={referenceUploadError}
            canUseCurrentImageReference={canUseCurrentImageReference}
            useCurrentImageAsReference={useCurrentImageAsReference}
            onToggleCurrentImageReference={setUseCurrentImageAsReference}
            currentImageReferencePreviewUrl={previewImageUrl(
              activeImage ?? undefined,
            )}
            currentImageReferenceLabel={activeImageReferenceLabel}
            credits={credits}
            estimate={estimate}
            aspectLabel={aspectLabel}
            modelName={model?.displayName ?? null}
            status={WORKBENCH_STATUS_LABEL[status]}
            queueNotice={queueNotice}
            serviceError={
              aggregatedServiceError ??
              (modelsError && !model ? modelsError : null)
            }
            generationError={generationError}
          />
        </div>
      </div>

      {/* Right edge: history rail trigger */}
      <button
        type="button"
        aria-label="打开历史画廊"
        onClick={() => setHistoryDrawerOpen(true)}
        className="group absolute right-0 top-1/2 z-30 flex h-24 w-7 -translate-y-1/2 items-center justify-center rounded-l-xl border border-r-0 border-border bg-surface/70 text-text-muted backdrop-blur-md transition-all hover:w-8 hover:bg-surface hover:text-foreground"
      >
        <History size={13} strokeWidth={1.5} />
      </button>

      {/* Params popover */}
      <AnimatePresence>
        {paramsOpen ? (
          <motion.div
            key="params"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="absolute right-4 top-16 z-40 w-[360px] origin-top-right overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-lg)]"
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <Sliders
                  size={13}
                  strokeWidth={1.5}
                  className="text-text-muted"
                />
                <span className="text-[13px] font-medium">生成参数</span>
              </div>
              <button
                type="button"
                aria-label="关闭"
                onClick={() => setParamsOpen(false)}
                className="flex h-6 w-6 items-center justify-center rounded-md text-text-muted hover:bg-surface-2"
              >
                <X size={12} strokeWidth={1.5} />
              </button>
            </div>
            {state ? (
              <div className="max-h-[70vh] overflow-y-auto">
                <ModelMiniSelector
                  models={availableModels}
                  activeId={state.modelId}
                  onChange={(id) => {
                    setWorkbenchState((cur) =>
                      cur ? normalizeWorkbenchState(id, cur, models) : cur,
                    );
                  }}
                />
                <DynamicParamsPanel
                  value={state}
                  onChange={setWorkbenchState}
                  models={models}
                />
              </div>
            ) : (
              <div className="p-4 text-[13px] text-text-muted">
                {isBooting
                  ? "正在读取模型列表..."
                  : "当前没有可用模型。请先在设置中启用渠道。"}
              </div>
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Conversations list popover */}
      <AnimatePresence>
        {conversationsOpen ? (
          <motion.div
            key="conv"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="absolute left-4 top-16 z-40 w-[320px] origin-top-left overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-lg)]"
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <span className="text-[13px] font-medium">对话</span>
              <button
                type="button"
                onClick={() => {
                  void actions.clearAllConversations();
                }}
                disabled={conversations.length === 0}
                className="flex h-6 items-center gap-1 rounded-md px-2 text-[11px] text-text-muted hover:bg-surface-2 disabled:opacity-30"
              >
                <Trash2 size={11} strokeWidth={1.5} />
                清空
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-1">
              {conversations.length === 0 ? (
                <p className="p-4 text-[13px] text-text-muted">
                  发送第一条消息后会自动创建对话。
                </p>
              ) : (
                conversations.map((c) => (
                  <Link
                    key={c.id}
                    href={`/app?conversation=${c.id}`}
                    onClick={() => setConversationsOpen(false)}
                    className={cn(
                      "group flex items-start gap-2 rounded-lg px-3 py-2 transition-colors",
                      c.id === conversationId
                        ? "bg-foreground/[0.06] text-foreground"
                        : "text-text-muted hover:bg-surface-2 hover:text-foreground",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium">
                        {c.title}
                      </p>
                      {c.latestMessage ? (
                        <p className="mt-0.5 line-clamp-1 text-[11.5px] opacity-70">
                          {c.latestMessage}
                        </p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void actions.archiveConversation(c.id);
                      }}
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-faint opacity-0 transition-all hover:bg-surface hover:text-foreground group-hover:opacity-100"
                      aria-label="删除"
                    >
                      <Trash2 size={11} strokeWidth={1.5} />
                    </button>
                  </Link>
                ))
              )}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

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

      {/* Completion toast */}
      <AnimatePresence>
        {completionToast ? (
          <motion.div
            key="toast"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
              "pointer-events-none absolute left-1/2 z-40 -translate-x-1/2 rounded-full border border-border bg-surface px-4 py-2 text-[12.5px] text-foreground shadow-[var(--shadow-md)]",
              hasActivePrompt
                ? "bottom-[22rem] md:bottom-[30rem]"
                : "bottom-44",
            )}
          >
            <span className="font-mono">{completionToast}</span>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/* ============================ Sub-components ============================ */

function parseAspect(label: string): { w: number; h: number } {
  const m = /(\d+)\s*[:x×]\s*(\d+)/i.exec(label);
  if (!m) return { w: 1, h: 1 };
  return { w: Number(m[1]), h: Number(m[2]) };
}

function resolveStageAspect(
  image: { width?: number | null; height?: number | null } | null,
  generationAspect: string | null,
  fallbackAspect: string,
): { w: number; h: number } {
  if (image?.width && image.height) {
    return { w: image.width, h: image.height };
  }

  if (generationAspect) {
    return parseAspect(generationAspect);
  }

  return parseAspect(fallbackAspect);
}

function ToolbarPill({
  label,
  sub,
  icon: Icon,
  onClick,
}: {
  label: string;
  sub?: string;
  icon: typeof Sparkles;
  onClick?: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex h-9 items-center gap-2 rounded-full border border-border bg-surface/80 px-3 text-[12.5px] text-foreground backdrop-blur-md transition-all hover:border-border-strong hover:bg-surface active:scale-[0.97]"
    >
      <Icon size={13} strokeWidth={1.5} className="text-info" />
      <span className="max-w-[140px] truncate font-medium">{label}</span>
      {sub ? (
        <span className="font-mono text-[10.5px] text-text-faint">{sub}</span>
      ) : null}
    </button>
  );
}

function ConversationTimeline<G extends { id: string; prompt: string }>({
  messages,
  generations,
  activeGenId,
  onJump,
}: {
  messages: Array<{ id?: string; role: string; content: string }>;
  generations: G[];
  activeGenId: string | null;
  onJump: (g: G) => void;
}): React.ReactElement | null {
  const turns = messages.filter(
    (m) => m.role === "user" && m.id !== WELCOME_MESSAGE.id,
  );
  if (turns.length === 0 && generations.length === 0) return null;

  return (
    <div className="pointer-events-auto flex max-h-full flex-col items-center gap-2 overflow-y-auto py-2">
      <div className="absolute left-1/2 top-2 bottom-2 -z-10 w-px -translate-x-1/2 bg-gradient-to-b from-transparent via-border to-transparent" />
      {generations.map((g, i) => {
        const isActive = g.id === activeGenId;
        return (
          <div key={g.id} className="group relative">
            <button
              type="button"
              onClick={() => onJump(g)}
              aria-label={`跳转到第 ${i + 1} 个生成`}
              className={cn(
                "relative flex h-2.5 w-2.5 items-center justify-center rounded-full border transition-all",
                isActive
                  ? "h-3 w-3 border-foreground bg-foreground"
                  : "border-border-strong bg-surface hover:scale-150 hover:border-foreground",
              )}
            />
            <span className="pointer-events-none absolute left-6 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-foreground opacity-0 shadow-[var(--shadow-sm)] transition-opacity group-hover:opacity-100">
              {g.prompt.slice(0, 32)}
              {g.prompt.length > 32 ? "…" : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ActivePromptStrip({
  prompt,
  activeIndex,
  total,
  onPrevious,
  onNext,
}: {
  prompt: string;
  activeIndex: number;
  total: number;
  onPrevious: () => void;
  onNext: () => void;
}): React.ReactElement {
  const hasPrevious = activeIndex > 0;
  const hasNext = activeIndex >= 0 && activeIndex < total - 1;
  const positionLabel =
    total > 0 && activeIndex >= 0 ? `${activeIndex + 1} / ${total}` : null;

  return (
    <div className="pointer-events-auto w-full rounded-2xl border border-border bg-surface/90 px-4 py-3 shadow-[var(--shadow-md)] backdrop-blur-md">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-text-faint">
              当前提示词
            </span>
            {positionLabel ? (
              <span className="rounded-full border border-border bg-surface-2 px-2 py-0.5 font-mono text-[10.5px] text-text-muted">
                {positionLabel}
              </span>
            ) : null}
          </div>
          <p className="mt-1 max-h-16 overflow-y-auto whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-foreground">
            {prompt}
          </p>
        </div>
        {total > 1 ? (
          <div className="flex shrink-0 items-center gap-1 pt-1">
            <button
              type="button"
              aria-label="上一个提示词"
              onClick={onPrevious}
              disabled={!hasPrevious}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-text-muted transition-colors hover:border-border-strong hover:bg-surface-2 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
            >
              <ChevronLeft size={14} strokeWidth={1.5} />
            </button>
            <button
              type="button"
              aria-label="下一个提示词"
              onClick={onNext}
              disabled={!hasNext}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-text-muted transition-colors hover:border-border-strong hover:bg-surface-2 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
            >
              <ChevronRight size={14} strokeWidth={1.5} />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

interface StageProps {
  status: string;
  progress: number | null;
  images: Array<{
    id?: string;
    src?: string;
    url?: string;
    thumbnailUrl?: string;
    width?: number | null;
    height?: number | null;
  }>;
  selectedImageId: string | null;
  onSelectedImageIdChange: (imageId: string | null) => void;
  aspect: { w: number; h: number };
  error: string | null;
  isBusy: boolean;
}

function Stage({
  status,
  progress,
  images,
  selectedImageId,
  onSelectedImageIdChange,
  aspect,
  error,
  isBusy,
}: StageProps): React.ReactElement {
  const viewable = images.filter((i) => i.src ?? i.url);
  const selectedIndex = Math.max(
    viewable.findIndex((image) => image.id && image.id === selectedImageId),
    0,
  );
  const ratio = aspect.w / aspect.h;
  const maxStageVh = ratio > 1.4 ? 50 : ratio < 0.8 ? 46 : 54;
  const maxStageWidth = ratio > 1.4 ? 920 : 760;
  const useGridGallery = viewable.length > 1;
  const aspectStyle = {
    aspectRatio: useGridGallery ? "16 / 10" : `${aspect.w} / ${aspect.h}`,
    width: useGridGallery
      ? "min(100%, 980px, 78vw)"
      : `min(100%, ${maxStageWidth}px, ${Math.round(maxStageVh * ratio)}vh)`,
  };

  return (
    <div className="relative flex w-full items-center justify-center">
      {/* Floor shadow */}
      <div
        aria-hidden
        className="absolute inset-x-12 -bottom-4 h-12 rounded-full bg-foreground/[0.07] blur-2xl"
      />
      <div
        className={cn(
          "relative w-full overflow-hidden rounded-2xl border border-border bg-surface/40 shadow-[var(--shadow-lg)]",
          isBusy && "motion-safe:animate-pulse motion-reduce:animate-none",
        )}
        style={aspectStyle}
      >
        {/* Aurora background when empty */}
        {viewable.length === 0 ? (
          <StageEmpty status={status} error={error} progress={progress} />
        ) : (
          <div className="img-reveal absolute inset-0">
            <ImageGallery
              images={viewable}
              alt="生成结果"
              selectedIndex={selectedIndex}
              onSelectedIndexChange={(index) =>
                onSelectedImageIdChange(viewable[index]?.id ?? null)
              }
              statusLabel={
                status === "running"
                  ? "生成中"
                  : status === "failed"
                    ? "失败"
                    : status === "canceled"
                      ? "已取消"
                      : "已完成"
              }
              variant={useGridGallery ? "grid" : "single"}
            />
          </div>
        )}

        {/* Ring progress on edges while running */}
        {isBusy ? <EdgeProgress progress={progress} /> : null}
      </div>
    </div>
  );
}

function StageEmpty({
  status,
  error,
  progress,
}: {
  status: string;
  error: string | null;
  progress: number | null;
}): React.ReactElement {
  const isPending = status === "pending";
  const isRunning = status === "running";
  const isFailed = status === "failed";
  const isCanceled = status === "canceled";

  let label = "画布";
  let title = "等待你的第一句话";
  let desc =
    "在下方输入你想要的画面。可以描述目标、风格、构图，或要避开的内容。";

  if (isPending) {
    label = "排队中";
    title = "已加入队列";
    desc = "任务即将开始，请稍候。";
  } else if (isRunning) {
    label = "生成中";
    title = stageHint(progress);
    desc = "完成后会自动展示在这里。";
  } else if (isFailed) {
    label = "失败";
    title = "任务没有完成";
    desc = error ?? "调整描述后再试一次。";
  } else if (isCanceled) {
    label = "已取消";
    title = "任务已取消";
    desc = "如果尚未开始，点数会退回账户余额。";
  }

  return (
    <div className="absolute inset-0 flex items-center justify-center">
      {/* Aurora */}
      <div
        aria-hidden
        className="absolute inset-0 overflow-hidden"
        style={{
          background: isFailed
            ? "radial-gradient(120% 80% at 50% 0%, rgb(var(--danger) / 0.08), transparent 60%), radial-gradient(120% 80% at 50% 100%, rgb(var(--surface-2)), rgb(var(--surface)))"
            : isRunning || isPending
              ? "radial-gradient(120% 80% at 30% 0%, rgb(var(--info) / 0.16), transparent 60%), radial-gradient(120% 80% at 70% 100%, rgb(var(--warning) / 0.08), transparent 60%), rgb(var(--surface))"
              : "radial-gradient(120% 80% at 50% 0%, rgb(var(--info) / 0.06), transparent 60%), radial-gradient(120% 80% at 50% 100%, rgb(var(--surface-2)), rgb(var(--surface)))",
        }}
      />
      {(isRunning || isPending) && (
        <div
          aria-hidden
          className="absolute inset-0 motion-safe:animate-pulse motion-reduce:animate-none"
          style={{
            background:
              "radial-gradient(40% 30% at 50% 50%, rgb(var(--info) / 0.18), transparent 70%)",
          }}
        />
      )}

      <div className="relative z-10 max-w-md px-8 text-center">
        <p className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-text-faint">
          {label}
        </p>
        <h3 className="mt-3 text-[20px] font-medium leading-tight tracking-[-0.01em] text-foreground">
          {title}
        </h3>
        <p className="mt-3 text-[13.5px] leading-relaxed text-text-muted">
          {desc}
        </p>
      </div>
    </div>
  );
}

function stageHint(progress: number | null): string {
  if (progress === null) return "正在编译提示词";
  if (progress < 0.25) return "正在编译提示词";
  if (progress < 0.6) return "正在调用渠道";
  if (progress < 0.92) return "正在渲染画面";
  return "即将完成";
}

function EdgeProgress({
  progress,
}: {
  progress: number | null;
}): React.ReactElement {
  const pct = Math.max(0.05, Math.min(progress ?? 0.15, 0.99));
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 rounded-2xl"
      style={{
        background: `conic-gradient(from -90deg, rgb(var(--info) / 0.6) ${pct * 360}deg, transparent ${pct * 360}deg)`,
        WebkitMask:
          "linear-gradient(#000, #000) content-box, linear-gradient(#000, #000)",
        WebkitMaskComposite: "xor",
        maskComposite: "exclude",
        padding: "2px",
      }}
    />
  );
}

function ModelMiniSelector({
  models,
  activeId,
  onChange,
}: {
  models: Array<{ id: string; displayName: string; available: boolean }>;
  activeId: string;
  onChange: (id: string) => void;
}): React.ReactElement {
  return (
    <div className="border-b border-border px-4 py-3">
      <p className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-text-faint">
        模型
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {models.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => onChange(m.id)}
            disabled={!m.available}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11.5px] transition-all",
              m.id === activeId
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-surface-2 text-text-muted hover:border-border-strong hover:text-foreground",
              !m.available && "opacity-40",
            )}
          >
            {m.displayName}
          </button>
        ))}
      </div>
    </div>
  );
}

interface CommandBarProps {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  submitDisabled: boolean;
  submitDisabledReason: string | null;
  inputDisabled: boolean;
  isBusy: boolean;
  referenceImages: Array<{ key: string; previewUrl: string }>;
  onUploadReference?: (file: File) => void | Promise<void>;
  onUploadReferences?: (files: File[]) => void | Promise<void>;
  onRemoveReference?: (key: string) => void;
  uploadDisabled: boolean;
  isUploadingReference: boolean;
  referenceUploadError: string | null;
  canUseCurrentImageReference: boolean;
  useCurrentImageAsReference: boolean;
  onToggleCurrentImageReference: (v: boolean) => void;
  currentImageReferencePreviewUrl?: string | null;
  currentImageReferenceLabel?: string | null;
  credits: number;
  estimate: number;
  aspectLabel: string;
  modelName: string | null;
  status: string;
  queueNotice: string | null;
  serviceError: string | null;
  generationError: string | null;
}

function CommandBar({
  textareaRef,
  value,
  onChange,
  onSubmit,
  submitDisabled,
  submitDisabledReason,
  inputDisabled,
  isBusy,
  referenceImages,
  onUploadReference,
  onUploadReferences,
  onRemoveReference,
  uploadDisabled,
  isUploadingReference,
  referenceUploadError,
  canUseCurrentImageReference,
  useCurrentImageAsReference,
  onToggleCurrentImageReference,
  currentImageReferencePreviewUrl,
  currentImageReferenceLabel,
  credits,
  estimate,
  aspectLabel,
  modelName,
  queueNotice,
  serviceError,
  generationError,
}: CommandBarProps): React.ReactElement {
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onSubmit();
    }
  };

  const banner = generationError ?? serviceError ?? null;
  const canUpload =
    (Boolean(onUploadReference) || Boolean(onUploadReferences)) &&
    !uploadDisabled;
  const [isDraggingReference, setIsDraggingReference] = useState(false);
  const dragDepthRef = useRef(0);

  const droppedFilesFrom = (event: DragEvent<HTMLElement>) =>
    Array.from(event.dataTransfer.files);

  const onDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current += 1;
    setIsDraggingReference(true);
  };

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = canUpload ? "copy" : "none";
    dragDepthRef.current = Math.max(dragDepthRef.current, 1);
    setIsDraggingReference(true);
  };

  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDraggingReference(false);
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingReference(false);

    if (!canUpload) return;

    const files = droppedFilesFrom(event);
    if (files.length === 0) return;

    if (onUploadReferences) {
      void onUploadReferences(files);
    } else {
      files.forEach((file) => {
        void onUploadReference?.(file);
      });
    }
  };

  return (
    <div
      className={cn(
        "relative w-full rounded-2xl transition-colors",
        isDraggingReference && "bg-info/[0.04]",
      )}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {isDraggingReference ? (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-2xl border border-info/50 bg-surface/85 text-[13px] font-medium text-foreground shadow-[var(--shadow-md)] backdrop-blur-sm">
          {canUpload ? "松开上传为参考图" : "当前不可上传参考图"}
        </div>
      ) : null}
      {banner ? (
        <div className="mb-2 rounded-lg border border-danger/30 bg-danger/[0.06] px-3 py-1.5 text-[12px] text-danger">
          {banner}
        </div>
      ) : null}

      {referenceImages.length || canUseCurrentImageReference ? (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {referenceImages.map((img) => (
            <div
              key={img.key}
              className="group relative flex items-center gap-1.5 rounded-lg border border-border bg-surface px-1.5 py-1"
            >
              <img
                src={img.previewUrl}
                alt="参考"
                className="h-7 w-7 rounded-md object-cover"
              />
              <button
                type="button"
                onClick={() => onRemoveReference?.(img.key)}
                className="flex h-5 w-5 items-center justify-center rounded-md text-text-faint hover:bg-surface-2 hover:text-foreground"
                aria-label="移除参考图"
              >
                <X size={11} strokeWidth={1.5} />
              </button>
            </div>
          ))}
          {canUseCurrentImageReference ? (
            <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-surface px-1.5 py-1 pr-2 text-[11.5px] text-text-muted hover:border-border-strong hover:text-foreground">
              <input
                type="checkbox"
                className="accent-foreground"
                checked={useCurrentImageAsReference}
                onChange={(e) =>
                  onToggleCurrentImageReference(e.target.checked)
                }
              />
              {currentImageReferencePreviewUrl ? (
                <img
                  src={currentImageReferencePreviewUrl}
                  alt=""
                  className="h-7 w-7 rounded-md object-cover"
                />
              ) : null}
              <span>{currentImageReferenceLabel ?? "参考选中图"}</span>
            </label>
          ) : null}
        </div>
      ) : null}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className={cn(
          "group relative flex items-end gap-2 rounded-2xl border bg-surface/95 p-3 pl-4 backdrop-blur-md transition-all",
          submitDisabled
            ? "border-border"
            : "border-border focus-within:border-border-strong focus-within:shadow-[var(--shadow-md)]",
          isDraggingReference && "border-info/60 shadow-[var(--shadow-md)]",
        )}
      >
        {/* Ambient glow when focused */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity group-focus-within:opacity-100"
          style={{
            background:
              "radial-gradient(120% 80% at 50% 100%, rgb(var(--info) / 0.06), transparent 60%)",
          }}
        />

        <textarea
          ref={textareaRef}
          value={value}
          rows={2}
          maxLength={4000}
          disabled={inputDisabled}
          placeholder={
            isBusy
              ? "正在生成…"
              : "描述你想要的画面，⌘+Enter 发送  ·  ⌘+/ 调整参数"
          }
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          className="relative max-h-56 min-h-[72px] flex-1 resize-none bg-transparent px-1 py-2 text-[15px] leading-relaxed outline-none placeholder:text-text-faint"
          aria-label="输入生成需求"
        />

        {onUploadReference ? (
          <label
            className={cn(
              "relative flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-border text-text-muted transition-all hover:border-border-strong hover:bg-surface-2 hover:text-foreground active:scale-[0.95]",
              uploadDisabled && "cursor-not-allowed opacity-40",
            )}
            aria-label="上传参考图"
          >
            <ImagePlus size={15} strokeWidth={1.5} />
            <input
              type="file"
              className="sr-only"
              accept="image/png,image/jpeg,image/webp"
              disabled={uploadDisabled}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onUploadReference(file);
                e.target.value = "";
              }}
            />
          </label>
        ) : null}

        <button
          type="submit"
          disabled={submitDisabled}
          aria-label="发送"
          title={submitDisabledReason ?? undefined}
          className={cn(
            "relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-all active:scale-[0.95]",
            submitDisabled
              ? "bg-surface-2 text-text-faint"
              : "bg-foreground text-background shadow-[var(--shadow-sm)] hover:shadow-[var(--shadow-md)]",
          )}
        >
          <ArrowUp size={16} strokeWidth={2} />
        </button>
      </form>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1 font-mono text-[10.5px] text-text-faint">
        <div className="flex items-center gap-2">
          {modelName ? <span>{modelName}</span> : null}
          {modelName ? (
            <span className="h-1 w-1 rounded-full bg-border-strong" />
          ) : null}
          <span>{aspectLabel}</span>
          <span className="h-1 w-1 rounded-full bg-border-strong" />
          <span>
            {estimate} / {credits} 点
          </span>
          {queueNotice ? (
            <>
              <span className="h-1 w-1 rounded-full bg-border-strong" />
              <span className="text-warning">{queueNotice}</span>
            </>
          ) : null}
          {isUploadingReference ? (
            <>
              <span className="h-1 w-1 rounded-full bg-border-strong" />
              <span>上传参考图…</span>
            </>
          ) : null}
        </div>
        <span>
          {value.length} / 4000 · {SUBMIT_HINT}
        </span>
      </div>
      {referenceUploadError ? (
        <p className="mt-1 px-1 text-[11px] text-danger">
          {referenceUploadError}
        </p>
      ) : null}
      {submitDisabledReason ? (
        <p className="mt-1 px-1 text-[11px] leading-5 text-warning">
          {submitDisabledReason}
        </p>
      ) : null}
    </div>
  );
}

interface HistoryDrawerProps {
  open: boolean;
  onClose: () => void;
  history: Array<{
    id: string;
    prompt: string;
    status: string;
    createdAt: string;
    images: Array<{
      src?: string;
      url?: string;
      thumbnailUrl?: string;
    }>;
  }>;
  activeId: string | null;
  onSelect: (g: HistoryDrawerProps["history"][number]) => void;
}

function HistoryDrawer({
  open,
  onClose,
  history,
  activeId,
  onSelect,
}: HistoryDrawerProps): React.ReactElement {
  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-0 z-40 bg-background/40 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.aside
            key="drawer"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            className="absolute right-0 top-0 z-50 flex h-full w-full max-w-[520px] flex-col border-l border-border bg-surface"
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <p className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-text-faint">
                  画廊
                </p>
                <h3 className="mt-1 text-[15px] font-semibold">历史生成</h3>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href="/app/history"
                  className="rounded-md px-2.5 py-1 text-[11.5px] text-text-muted hover:bg-surface-2 hover:text-foreground"
                >
                  全部
                </Link>
                <button
                  type="button"
                  aria-label="关闭"
                  onClick={onClose}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-surface-2 hover:text-foreground"
                >
                  <X size={13} strokeWidth={1.5} />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              {history.length === 0 ? (
                <p className="p-4 text-[13px] text-text-muted">
                  还没有生成记录。
                </p>
              ) : (
                <div className="space-y-2">
                  {history.map((item) => {
                    const img = item.images.at(-1);
                    const url = img?.thumbnailUrl ?? img?.src ?? img?.url;
                    const isActive = item.id === activeId;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => onSelect(item)}
                        className={cn(
                          "group flex w-full gap-3 overflow-hidden rounded-xl border bg-surface-2 p-2 text-left transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)]",
                          isActive
                            ? "border-foreground"
                            : "border-border hover:border-border-strong",
                        )}
                      >
                        {url ? (
                          <div className="h-24 w-24 shrink-0 overflow-hidden rounded-lg bg-background">
                            <img
                              src={url}
                              alt=""
                              loading="lazy"
                              decoding="async"
                              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                            />
                          </div>
                        ) : (
                          <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-lg bg-background text-[10px] font-mono text-text-faint">
                            {item.status}
                          </div>
                        )}
                        <div className="min-w-0 flex-1 py-1">
                          <div className="mb-1.5 flex flex-wrap items-center gap-2">
                            <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-text-faint">
                              提示词
                            </span>
                            <span className="rounded-full border border-border bg-surface px-2 py-0.5 font-mono text-[10.5px] text-text-muted">
                              {item.status}
                            </span>
                          </div>
                          <p className="line-clamp-4 whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-foreground">
                            {item.prompt || "无描述"}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );
}
