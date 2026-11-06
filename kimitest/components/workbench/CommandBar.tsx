"use client";

import { useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { motion } from "framer-motion";
import { ArrowUp, ImagePlus, Wand2, X } from "lucide-react";

import { cn } from "@/lib/utils";

const SUBMIT_HINT = "⌘ Enter";

interface CommandBarProps {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onOptimize: () => void | Promise<void>;
  isOptimizing: boolean;
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
  queueNotice: string | null;
  serviceError: string | null;
  generationError: string | null;
}

export function CommandBar({
  textareaRef,
  value,
  onChange,
  onSubmit,
  onOptimize,
  isOptimizing,
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
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-2xl border border-[rgb(var(--brand-primary))]/50 bg-surface/80 text-[13px] font-medium text-foreground shadow-[var(--shadow-glow-brand-soft)]">
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
              className="group relative flex items-center gap-1.5 rounded-[10px] border border-ink/[0.08] bg-ink/[0.04] px-1.5 py-1"
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
            <label className="flex cursor-pointer items-center gap-1.5 rounded-[10px] border border-ink/[0.08] bg-ink/[0.04] px-1.5 py-1 pr-2 text-[11.5px] text-text-muted transition-colors hover:border-ink/[0.16] hover:text-foreground">
              <input
                type="checkbox"
                className="accent-[rgb(var(--brand-primary))]"
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
          "group relative flex items-center gap-2 rounded-[var(--radius-lg)] border border-border bg-surface p-3 pl-4 shadow-[var(--shadow-md)] transition-colors duration-150",
          !submitDisabled &&
            "focus-within:border-ink/60 focus-within:ring-2 focus-within:ring-brand/20",
          isDraggingReference && "border-brand",
        )}
      >
        <textarea
          ref={textareaRef}
          value={value}
          rows={2}
          maxLength={4000}
          disabled={inputDisabled}
          placeholder={isBusy ? "正在生成…" : "描述你想要的画面"}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          className="relative min-h-[56px] max-h-56 min-w-0 flex-1 resize-none bg-transparent px-1 py-2 pr-2 text-[16px] leading-[1.6] outline-none placeholder:italic placeholder:text-text-muted"
          aria-label="输入生成需求"
        />

        <button
          type="button"
          onClick={() => void onOptimize()}
          disabled={isOptimizing || inputDisabled || value.trim().length === 0}
          aria-label="优化提示词"
          title="用 DeepSeek 优化提示词"
          className={cn(
            "relative flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-border text-text-muted transition-colors duration-150 hover:border-ink/50 hover:bg-ink/[0.05] hover:text-foreground active:scale-[0.95]",
            (isOptimizing || inputDisabled || value.trim().length === 0) &&
              "cursor-not-allowed opacity-40",
          )}
        >
          {isOptimizing ? (
            <motion.div
              animate={{ rotate: 360 }}
              transition={{
                duration: 1,
                repeat: Number.POSITIVE_INFINITY,
                ease: "linear",
              }}
              className="h-4 w-4 rounded-full border-2 border-text-faint/30 border-t-text-muted"
            />
          ) : (
            <Wand2 size={15} strokeWidth={1.5} />
          )}
        </button>

        {onUploadReference ? (
          <label
            className={cn(
              "relative flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius-sm)] border border-border text-text-muted transition-colors duration-150 hover:border-ink/50 hover:bg-ink/[0.05] hover:text-foreground active:scale-[0.95]",
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
            "relative flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] transition-colors duration-150",
            submitDisabled
              ? "bg-ink/[0.05] text-text-faint"
              : "bg-ink text-background hover:bg-brand hover:text-on-brand active:translate-y-0.5",
          )}
        >
          {isBusy ? (
            <motion.div
              animate={{ rotate: 360 }}
              transition={{
                duration: 1,
                repeat: Number.POSITIVE_INFINITY,
                ease: "linear",
              }}
              className="h-5 w-5 rounded-full border-2 border-background/20 border-t-background"
            />
          ) : (
            <ArrowUp size={20} strokeWidth={2} />
          )}
        </button>
      </form>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1 font-mono text-[11px] text-text-faint">
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
