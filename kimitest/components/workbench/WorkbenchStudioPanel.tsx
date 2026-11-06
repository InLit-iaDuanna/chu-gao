"use client";

import type { RefObject } from "react";

import { ActivePromptStrip } from "@/components/workbench/ActivePromptStrip";
import { CommandBar } from "@/components/workbench/CommandBar";
import { GenerationStage } from "@/components/workbench/GenerationStage";
import { StudioHistoryRail } from "@/components/workbench/StudioHistoryRail";
import { previewImageUrl } from "@/components/workbench/gallery-images";
import type {
  UploadedReferenceImage,
  WorkbenchGeneration,
  WorkbenchTaskStatus,
} from "@/components/workbench/types";

interface WorkbenchStudioPanelProps {
  activeGeneration: WorkbenchGeneration | null;
  activeGenIndex: number;
  activeImage: WorkbenchGeneration["images"][number] | null;
  activeImageReferenceLabel: string;
  activeImages: WorkbenchGeneration["images"];
  activeSelectedImageId: string | null;
  aggregatedServiceError: string | null;
  aspectLabel: string;
  canUseCurrentImageReference: boolean;
  conversationGenerations: WorkbenchGeneration[];
  credits: number;
  draft: string;
  estimate: number;
  generationError: string | null;
  generationProgress: number;
  isBooting: boolean;
  isBusy: boolean;
  isOptimizing: boolean;
  isSubmitting: boolean;
  isUploadingReference: boolean;
  maxUploadedReferenceImages: number;
  modelName: string | null;
  modelsError: string | null;
  queueNotice: string | null;
  referenceUploadError: string | null;
  showActivePrompt: boolean;
  stageAspect: { w: number; h: number };
  status: WorkbenchTaskStatus;
  submitDisabled: boolean;
  submitDisabledReason: string | null;
  supportsReferenceImage: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  uploadedReferenceImages: UploadedReferenceImage[];
  useCurrentImageAsReference: boolean;
  onDraftChange: (value: string) => void;
  onOptimize: () => void;
  onRemoveReference: (key: string) => void;
  onSelectGeneration: (generation: WorkbenchGeneration) => void;
  onSelectedImageIdChange: (id: string | null) => void;
  onSubmit: () => void;
  onToggleCurrentImageReference: (value: boolean) => void;
  onUploadReference?: (file: File) => void | Promise<void>;
  onUploadReferences?: (files: File[]) => void | Promise<void>;
}

export function WorkbenchStudioPanel({
  activeGeneration,
  activeGenIndex,
  activeImage,
  activeImageReferenceLabel,
  activeImages,
  activeSelectedImageId,
  aggregatedServiceError,
  aspectLabel,
  canUseCurrentImageReference,
  conversationGenerations,
  credits,
  draft,
  estimate,
  generationError,
  generationProgress,
  isBooting,
  isBusy,
  isOptimizing,
  isSubmitting,
  isUploadingReference,
  maxUploadedReferenceImages,
  modelName,
  modelsError,
  queueNotice,
  referenceUploadError,
  showActivePrompt,
  stageAspect,
  status,
  submitDisabled,
  submitDisabledReason,
  supportsReferenceImage,
  textareaRef,
  uploadedReferenceImages,
  useCurrentImageAsReference,
  onDraftChange,
  onOptimize,
  onRemoveReference,
  onSelectGeneration,
  onSelectedImageIdChange,
  onSubmit,
  onToggleCurrentImageReference,
  onUploadReference,
  onUploadReferences,
}: WorkbenchStudioPanelProps): React.ReactElement {
  return (
    <div className="flex w-full flex-1 flex-col md:flex-row md:items-stretch md:gap-4 md:px-6">
      <aside className="hidden md:sticky md:top-20 md:flex md:max-h-[calc(100vh-7rem)] md:w-64 md:shrink-0 md:flex-col md:self-start md:overflow-hidden md:rounded-2xl md:border md:border-border md:bg-surface/50">
        <StudioHistoryRail
          generations={conversationGenerations}
          activeId={activeGeneration?.id ?? null}
          referenceEnabled={supportsReferenceImage}
          onSelect={onSelectGeneration}
          onCopyPrompt={(prompt) => {
            onDraftChange(prompt);
            textareaRef.current?.focus();
          }}
          onUseAsReference={(generation) => {
            onSelectGeneration(generation);
            onToggleCurrentImageReference(true);
          }}
        />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <main className="relative flex min-h-[460px] flex-1 items-center justify-center px-4 py-8 md:py-10">
          <GenerationStage
            status={status}
            progress={generationProgress}
            images={activeImages}
            selectedImageId={activeSelectedImageId}
            onSelectedImageIdChange={onSelectedImageIdChange}
            aspect={stageAspect}
            error={generationError}
            isBusy={isBusy}
            prompt={activeGeneration?.prompt ?? null}
          />
        </main>

        <div className="relative z-20 mt-auto px-4 pb-6 pt-4">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-20 -translate-y-full bg-gradient-to-t from-background to-transparent" />
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-3">
            {showActivePrompt && activeGeneration?.prompt ? (
              <ActivePromptStrip
                prompt={activeGeneration.prompt}
                activeIndex={activeGenIndex}
                total={conversationGenerations.length}
                onCopy={() => {
                  const prompt = activeGeneration.prompt;
                  onDraftChange(prompt);
                  textareaRef.current?.focus();
                }}
                onPrevious={() => {
                  const prev = conversationGenerations[activeGenIndex - 1];
                  if (prev) onSelectGeneration(prev);
                }}
                onNext={() => {
                  const next = conversationGenerations[activeGenIndex + 1];
                  if (next) onSelectGeneration(next);
                }}
              />
            ) : null}
            <CommandBar
              textareaRef={textareaRef}
              value={draft}
              onChange={onDraftChange}
              onSubmit={onSubmit}
              onOptimize={onOptimize}
              isOptimizing={isOptimizing}
              submitDisabled={submitDisabled}
              submitDisabledReason={submitDisabledReason}
              inputDisabled={isBooting || isSubmitting}
              isBusy={isSubmitting || isBusy}
              referenceImages={uploadedReferenceImages}
              onUploadReference={onUploadReference}
              onUploadReferences={onUploadReferences}
              onRemoveReference={onRemoveReference}
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
              onToggleCurrentImageReference={onToggleCurrentImageReference}
              currentImageReferencePreviewUrl={previewImageUrl(
                activeImage ?? undefined,
              )}
              currentImageReferenceLabel={activeImageReferenceLabel}
              credits={credits}
              estimate={estimate}
              aspectLabel={aspectLabel}
              modelName={modelName}
              queueNotice={queueNotice}
              serviceError={
                aggregatedServiceError ?? (modelsError && !modelName ? modelsError : null)
              }
              generationError={generationError}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
