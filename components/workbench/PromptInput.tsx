"use client";

import { ImagePlus, SendHorizonal, X } from "lucide-react";

import type { UploadedReferenceImage } from "@/components/workbench/types";
import { cn } from "@/lib/utils";

function submitLabel({
  disabled,
  hasValue,
  isBusy,
}: {
  disabled?: boolean;
  hasValue: boolean;
  isBusy?: boolean;
}) {
  if (isBusy) {
    return "处理中";
  }

  if (disabled && !hasValue) {
    return "输入后发送";
  }

  if (disabled) {
    return "暂不可发送";
  }

  return "发送";
}

export function PromptInput({
  value,
  onChange,
  onSubmit,
  referenceImages = [],
  onUploadReference,
  onRemoveReference,
  uploadDisabled,
  isUploadingReference,
  referenceUploadError,
  useCurrentImageAsReference,
  onToggleCurrentImageReference,
  canUseCurrentImageReference,
  currentImageReferenceDisabled,
  disabled,
  disabledReason,
  inputDisabled,
  isBusy,
  placeholder = "继续描述画面、修改要求或补充上下文。",
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  referenceImages?: UploadedReferenceImage[];
  onUploadReference?: (file: File) => void;
  onRemoveReference?: (key: string) => void;
  uploadDisabled?: boolean;
  isUploadingReference?: boolean;
  referenceUploadError?: string | null;
  useCurrentImageAsReference?: boolean;
  onToggleCurrentImageReference?: (value: boolean) => void;
  canUseCurrentImageReference?: boolean;
  currentImageReferenceDisabled?: boolean;
  disabled?: boolean;
  disabledReason?: string | null;
  inputDisabled?: boolean;
  isBusy?: boolean;
  placeholder?: string;
}) {
  const hasValue = value.trim().length > 0;
  const label = submitLabel({ disabled, hasValue, isBusy });
  const canUpload = Boolean(onUploadReference) && !uploadDisabled;

  return (
    <div className="mx-auto w-full space-y-2">
      {referenceImages.length || canUseCurrentImageReference ? (
        <div className="space-y-2 px-1">
          {referenceImages.length ? (
            <div className="flex flex-wrap gap-2">
              {referenceImages.map((image) => (
                <div
                  key={image.key}
                  className="group flex items-center gap-2 rounded-[6px] border border-border bg-surface-2/70 p-1 pr-2"
                >
                  <img
                    src={image.previewUrl}
                    alt="参考图"
                    className="h-10 w-10 rounded-[4px] object-cover"
                  />
                  <span className="max-w-[120px] truncate text-xs text-text-muted">
                    参考图
                  </span>
                  <button
                    type="button"
                    className="inline-flex h-6 w-6 items-center justify-center rounded-[4px] text-text-muted transition-colors hover:bg-surface hover:text-foreground"
                    onClick={() => onRemoveReference?.(image.key)}
                    aria-label="移除参考图"
                  >
                    <X className="h-3.5 w-3.5 stroke-[1.5]" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          {canUseCurrentImageReference ? (
            <label className="inline-flex items-center gap-2 text-xs text-text-muted">
              <input
                type="checkbox"
                className="accent-foreground"
                checked={Boolean(useCurrentImageAsReference)}
                disabled={currentImageReferenceDisabled}
                onChange={(event) =>
                  onToggleCurrentImageReference?.(event.target.checked)
                }
              />
              参考当前画布
            </label>
          ) : null}
        </div>
      ) : null}

      <form
        className={cn(
          "chat-input flex min-w-0 items-end gap-2 p-2 transition-colors sm:gap-3",
          disabled ? "border-border" : "focus-within:border-border-strong",
        )}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <textarea
          value={value}
          rows={2}
          maxLength={4000}
          className="max-h-36 min-h-16 min-w-0 flex-1 resize-none bg-transparent px-1 py-2 text-sm leading-6 outline-none placeholder:text-text-faint disabled:cursor-not-allowed"
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              onSubmit();
            }
          }}
          disabled={inputDisabled}
          aria-label="输入生成需求"
        />
        {onUploadReference ? (
          <label
            className={cn(
              "inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-[6px] border border-border bg-surface-2 text-text-muted transition-colors hover:bg-surface hover:text-foreground",
              !canUpload && "cursor-not-allowed opacity-45",
            )}
            aria-label="上传参考图"
          >
            <ImagePlus className="h-4 w-4 stroke-[1.5]" />
            <input
              type="file"
              className="sr-only"
              accept="image/png,image/jpeg,image/webp"
              disabled={!canUpload}
              onChange={(event) => {
                const file = event.target.files?.[0];

                if (file) {
                  onUploadReference(file);
                }

                event.target.value = "";
              }}
            />
          </label>
        ) : null}
        <button
          type="submit"
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[6px] border border-foreground bg-foreground text-background transition-colors hover:bg-text-muted disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-2 disabled:text-text-faint"
          disabled={disabled}
          aria-label={label}
        >
          <SendHorizonal className="h-4 w-4 stroke-[1.5]" />
        </button>
      </form>
      <div className="flex items-center justify-between gap-3 px-1 font-mono text-xs text-text-faint">
        <span>{value.length}/4000</span>
        <span>{isUploadingReference ? "上传参考图..." : "Ctrl Enter 发送"}</span>
      </div>
      {referenceUploadError ? (
        <p className="px-1 text-xs leading-5 text-danger">
          {referenceUploadError}
        </p>
      ) : null}
      {disabledReason ? (
        <p className="px-1 text-xs leading-5 text-text-muted">
          {disabledReason}
        </p>
      ) : null}
    </div>
  );
}
