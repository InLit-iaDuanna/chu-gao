"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  Trash2,
  MessageSquarePlus,
  Settings,
  SlidersHorizontal,
} from "lucide-react";

import { ActionableStatus } from "@/components/shared/ActionableStatus";
import { Canvas } from "@/components/workbench/Canvas";
import { previewImageUrl } from "@/components/workbench/gallery-images";
import { ConversationThread } from "@/components/workbench/ConversationThread";
import { CostPreview } from "@/components/workbench/CostPreview";
import {
  DynamicParamsPanel,
  normalizeWorkbenchState,
} from "@/components/workbench/DynamicParamsPanel";
import { ModelSelector } from "@/components/workbench/ModelSelector";
import { PromptInput } from "@/components/workbench/PromptInput";
import { generationStatusLabel } from "@/components/workbench/status";
import { useBootstrap } from "@/components/workbench/hooks/useBootstrap";
import { useWorkbenchActions } from "@/components/workbench/hooks/useWorkbenchActions";
import { WELCOME_MESSAGE } from "@/components/workbench/lib/messages";
import {
  WORKBENCH_STATUS_LABEL,
  initialStateFor,
} from "@/components/workbench/lib/workbench-state";
import { useConversationStore } from "@/components/workbench/stores/conversation-store";
import {
  selectAggregatedErrorMessage,
  useErrorStore,
} from "@/components/workbench/stores/error-store";
import { useGenerationStore } from "@/components/workbench/stores/generation-store";
import { useReferenceImageStore } from "@/components/workbench/stores/reference-image-store";
import { useWorkbenchStore } from "@/components/workbench/stores/workbench-store";
import { estimateCost } from "@/lib/credits";
import type { AspectRatio } from "@/lib/models/types";
import {
  readWorkbenchPreferences,
  writeWorkbenchPreferences,
} from "@/lib/workbench-preferences";
import { cn } from "@/lib/utils";

export function WorkbenchShell({
  initialConversationId = null,
}: {
  initialConversationId?: string | null;
}) {
  const requestedConversationId = initialConversationId;

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
  const selectedActiveImageId = useGenerationStore((s) => s.activeImageId);
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
  const conversationError = errors.conversation ?? null;
  const historyError = errors.history ?? null;
  const accountError = errors.account ?? null;

  const [draft, setDraft] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isParamsOpen, setIsParamsOpen] = useState(true);

  const actions = useWorkbenchActions();
  const { closeGenerationStream } = actions;
  const { loadInitialState } = useBootstrap(
    requestedConversationId,
    actions.applyConversation,
    actions.redirectToLogin,
  );

  const availableModels = useMemo(
    () => models.filter((model) => model.available),
    [models],
  );
  const model = state
    ? availableModels.find((item) => item.id === state.modelId) ?? null
    : null;

  const activeImages = activeGeneration?.images ?? [];
  const activeImage =
    activeImages.find(
      (image) => image.id && image.id === selectedActiveImageId,
    ) ??
    activeImages.at(-1) ??
    null;
  const activeImageId = activeImage?.id;
  const activeImageIndex = Math.max(
    activeImages.findIndex(
      (image) =>
        image === activeImage ||
        (activeImageId && image.id && image.id === activeImageId),
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
          activeImageId &&
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
    activeImageId,
    model,
    state,
    uploadedReferenceImages.length,
    useCurrentImageAsReference,
  ]);
  const hasInsufficientCredits = Boolean(model && state && estimate > credits);

  // Persist preferences
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

  // Cleanup reference image previews on unmount
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

  const currentConversationGenerations = useMemo(
    () =>
      history.filter(
        (item) =>
          conversationId &&
          item.conversationId === conversationId &&
          item.images.some((image) => image.src ?? image.url),
      ).toReversed(),
    [conversationId, history],
  );
  const activeGenerationIndex = activeGeneration
    ? currentConversationGenerations.findIndex(
        (item) => item.id === activeGeneration.id,
      )
    : -1;
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
    if (isBooting) return "正在读取账户和模型状态。";
    if (!model || !state)
      return modelsError ?? "当前没有可用模型。模型恢复后即可发送。";
    if (hasInsufficientCredits)
      return `余额不足，本次预计需要 ${estimate} 点，当前余额 ${credits} 点。`;
    if (isSubmitting) return "任务正在提交。";
    if (isUploadingReference) return "参考图正在上传。";
    if (!draft.trim()) return "描述你想生成或修改的画面后即可发送。";
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
  const aggregatedServiceError = selectAggregatedErrorMessage(errors, [
    "models",
    "account",
    "history",
    "conversation",
  ]);
  const cannotReadServices = Boolean(aggregatedServiceError);

  return (
    <div className="workbench-shell space-y-4">
      {cannotReadServices ? (
        <ActionableStatus
          tone="warning"
          title="部分状态暂时无法读取"
          description={aggregatedServiceError}
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
                {queueNotice ? (
                  <>
                    <span className="h-1 w-1 rounded-full bg-border-strong" />
                    <span className="text-warning">{queueNotice}</span>
                  </>
                ) : null}
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
              taskMeta={{
                provider: activeGeneration?.providerAccountName ?? null,
                providerChannelName:
                  activeGeneration?.providerChannelName ?? null,
                startedAt: activeGeneration?.startedAt ?? null,
                finishedAt: activeGeneration?.finishedAt ?? null,
              }}
              onReuseMessage={setDraft}
              onEditMessage={actions.updateConversationMessage}
              onClearMessages={actions.clearCurrentConversationMessages}
              canClearMessages={messages.some(
                (message) => message.id !== WELCOME_MESSAGE.id,
              )}
              footer={
                <PromptInput
                  value={draft}
                  onChange={setDraft}
                  onSubmit={() =>
                    void actions.submitGeneration({
                      draft,
                      isSubmitting,
                      setIsSubmitting,
                      setDraft,
                    })
                  }
                  referenceImages={uploadedReferenceImages}
                  onUploadReference={
                    supportsReferenceImage
                      ? actions.uploadReferenceImage
                      : undefined
                  }
                  onUploadReferences={
                    supportsReferenceImage
                      ? actions.uploadReferenceImages
                      : undefined
                  }
                  onRemoveReference={actions.removeReferenceImage}
                  uploadDisabled={
                    isBooting ||
                    isSubmitting ||
                    isUploadingReference ||
                    !supportsReferenceImage ||
                    uploadedReferenceImages.length >=
                      maxUploadedReferenceImages
                  }
                  isUploadingReference={isUploadingReference}
                  referenceUploadError={referenceUploadError}
                  useCurrentImageAsReference={useCurrentImageAsReference}
                  onToggleCurrentImageReference={
                    setUseCurrentImageAsReference
                  }
                  canUseCurrentImageReference={canUseCurrentImageReference}
                  currentImageReferencePreviewUrl={previewImageUrl(
                    activeImage ?? undefined,
                  )}
                  currentImageReferenceLabel={activeImageReferenceLabel}
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

            <div className="min-w-0 space-y-3">
              <Canvas
                images={activeImages}
                status={status}
                error={generationError}
                selectedImageId={activeImageId ?? null}
                onSelectedImageIdChange={setActiveImageId}
              />
              {currentConversationGenerations.length > 1 ? (
                <div className="flex flex-wrap items-center gap-2">
                  <div className="rounded-[6px] border border-border bg-surface-2 px-3 py-2 text-sm text-text-muted">
                      {activeGenerationIndex >= 0
                        ? `当前第 ${activeGenerationIndex + 1} / ${
                            currentConversationGenerations.length
                          } 个生成`
                        : `${currentConversationGenerations.length} 个生成可切换`}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="tool-button h-8 text-xs text-text-muted"
                      disabled={activeGenerationIndex <= 0}
                      onClick={() => {
                        const previous =
                          currentConversationGenerations[
                            activeGenerationIndex - 1
                          ];
                        if (previous) selectGeneration(previous);
                      }}
                    >
                      上一个
                    </button>
                    <button
                      type="button"
                      className="tool-button h-8 text-xs text-text-muted"
                      disabled={
                        activeGenerationIndex < 0 ||
                        activeGenerationIndex >=
                          currentConversationGenerations.length - 1
                      }
                      onClick={() => {
                        const next =
                          currentConversationGenerations[
                            activeGenerationIndex + 1
                          ];
                        if (next) selectGeneration(next);
                      }}
                    >
                      下一个
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {generationError ? (
            <ActionableStatus
              tone="danger"
              title="生成没有完成"
              description={`${generationError} 你可以调整描述、降低张数或稍后重新发送。`}
            />
          ) : null}

          <div className="surface-panel mt-6 p-4">
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
              {history.slice(0, 4).map((item) => {
                const latestImage = item.images.at(-1);
                const previewUrl =
                  latestImage?.thumbnailUrl ??
                  latestImage?.src ??
                  latestImage?.url;

                return (
                  <button
                    key={item.id}
                    type="button"
                    className={cn(
                      "surface-panel block w-full p-2 text-left text-sm leading-6 transition-colors hover:-translate-y-0.5 hover:bg-surface-2",
                      activeGeneration?.id === item.id
                        ? "border-foreground bg-foreground/10"
                        : "",
                    )}
                    onClick={() => selectGeneration(item)}
                  >
                    {previewUrl ? (
                      <div className="mb-2 flex h-20 items-center justify-center overflow-hidden rounded-[6px] bg-background">
                        <img
                          src={previewUrl}
                          alt=""
                          className="h-full w-full object-contain"
                          loading="lazy"
                          decoding="async"
                        />
                      </div>
                    ) : null}
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-text-muted">
                        {generationStatusLabel(item.status)}
                      </span>
                      <span className="line-clamp-1 min-w-0 text-sm">
                        {item.prompt}
                      </span>
                    </div>
                  </button>
                );
              })}
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
                <p className="eyebrow">历史对话</p>
                <h3 className="mt-1 truncate text-base font-medium">
                  {conversationTitle}
                </h3>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  className="tool-button h-9 w-9 px-0 text-text-muted"
                  aria-label="清空历史对话"
                  title="清空历史对话"
                  onClick={() => void actions.clearAllConversations()}
                  disabled={conversations.length === 0}
                >
                  <Trash2 className="h-4 w-4 stroke-[1.5]" />
                </button>
                <button
                  type="button"
                  className="tool-button h-9 w-9 px-0 text-text-muted"
                  aria-label="新建对话"
                  title="新建对话"
                  onClick={actions.resetWorkspaceForNewConversation}
                >
                  <MessageSquarePlus className="h-4 w-4 stroke-[1.5]" />
                </button>
              </div>
            </div>
            <div className="space-y-2">
              {conversations.slice(0, 5).map((item) => (
                <div
                  key={item.id}
                  className={`group flex items-start gap-2 rounded-[6px] border px-3 py-2 text-sm leading-5 transition-colors ${
                    item.id === conversationId
                      ? "border-foreground bg-foreground/10 text-foreground shadow-[inset_0_0_0_1px_rgb(var(--text)/0.16)]"
                      : "border-border bg-surface-2 text-text-muted hover:border-border-strong hover:text-foreground"
                  }`}
                >
                  <Link
                    href={`/app?conversation=${item.id}`}
                    className="min-w-0 flex-1"
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
                  <button
                    type="button"
                    className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] border border-border text-text-faint opacity-0 transition-all hover:border-border-strong hover:text-foreground focus:opacity-100 group-hover:opacity-100"
                    aria-label={`删除历史对话 ${item.title}`}
                    title="删除历史对话"
                    onClick={() => void actions.archiveConversation(item.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5 stroke-[1.5]" />
                  </button>
                </div>
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
                setWorkbenchState(
                  selected
                    ? initialStateFor(
                        selected,
                        readWorkbenchPreferences(accountId),
                      )
                    : null,
                );
                return;
              }

              setWorkbenchState((current) =>
                current
                  ? normalizeWorkbenchState(modelId, current, models)
                  : current,
              );
            }}
          />
          {state ? (
            <div className="surface-panel overflow-hidden">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 px-3 py-3 text-sm transition-colors hover:bg-surface-2"
                aria-expanded={isParamsOpen}
                aria-controls="workbench-params-panel"
                onClick={() => setIsParamsOpen((current) => !current)}
              >
                <span className="inline-flex items-center gap-2 text-text-muted">
                  <SlidersHorizontal className="h-4 w-4 stroke-[1.5]" />
                  生成参数
                </span>
                <span className="inline-flex items-center gap-1 font-mono text-xs text-text-faint">
                  {isParamsOpen ? "收起" : "展开"}
                  <ChevronDown
                    className={`h-3.5 w-3.5 stroke-[1.5] transition-transform ${
                      isParamsOpen ? "" : "-rotate-90"
                    }`}
                  />
                </span>
              </button>
              {isParamsOpen ? (
                <div id="workbench-params-panel">
                  <DynamicParamsPanel
                    value={state}
                    onChange={setWorkbenchState}
                    models={models}
                  />
                </div>
              ) : null}
            </div>
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
