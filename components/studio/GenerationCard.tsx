"use client";

import { Button } from "@/components/ui";

import type { CSSProperties } from "react";
import {
  AlertTriangle,
  Ban,
  Download,
  ImageOff,
  ImagePlus,
  Maximize2,
  RefreshCw,
  Share2,
} from "lucide-react";

import { friendlyErrorMessage } from "@/components/shared/error-copy";
import { cn, formatDate } from "@/lib/utils";

import type { Generation } from "./lib/types";
import { CopyTextButton } from "./CopyTextButton";
import { REFERENCE_DRAG_MIME } from "./lib/reference-input";

interface GenerationCardProps {
  generation: Generation;
  modelName?: string;
  style?: CSSProperties;
  variant?: "wall" | "conversation";
  onCancel: (id: string) => void;
  onRetry: (generation: Generation) => void;
  onOpen: (generation: Generation, imageIndex: number) => void;
  onUseAsReference: (generation: Generation) => void;
}

function aspectValue(generation: Generation): number {
  const image = generation.images[0];
  if (image?.width && image?.height) return image.width / image.height;
  const ratio = generation.aspectRatio;
  if (ratio) {
    const [w, h] = ratio.split(":").map(Number);
    if (w > 0 && h > 0) return w / h;
  }
  const [width, height] = (generation.size ?? "").split("x").map(Number);
  if (width > 0 && height > 0) return width / height;
  return 1;
}

function generationErrorMessage(generation: Generation): string {
  return friendlyErrorMessage(
    {
      code: generation.errorCode ?? undefined,
      message: generation.errorMessage ?? undefined,
    },
    "生成失败",
  );
}

const STATUS_LABEL: Record<string, string> = {
  PENDING: "排队中",
  RUNNING: "生成中",
  FAILED: "失败",
  CANCELED: "已取消",
};

export function GenerationCard({
  generation,
  modelName,
  style,
  variant = "wall",
  onCancel,
  onRetry,
  onOpen,
  onUseAsReference,
}: GenerationCardProps) {
  const ratio = aspectValue(generation);
  const active =
    generation.status === "PENDING" || generation.status === "RUNNING";
  const failed = generation.status === "FAILED";
  const canceled = generation.status === "CANCELED";
  const succeeded = generation.status === "SUCCEEDED";

  return (
    <figure
      className={cn(
        "group overflow-hidden rounded-lg border border-border bg-surface",
        variant === "wall"
          ? "card-lift img-enter mb-4 break-inside-avoid"
          : "my-3 w-full max-w-[480px]",
      )}
      style={
        variant === "conversation"
          ? { ...style, maxWidth: Math.min(480, 480 * ratio) }
          : style
      }
    >
      <div className="relative" style={{ aspectRatio: String(ratio) }}>
        {succeeded && generation.images.length > 0 ? (
          <div
            className={cn(
              "grid h-full w-full gap-px bg-border",
              generation.images.length > 1 ? "grid-cols-2" : "",
            )}
          >
            {generation.images.slice(0, 4).map((image, index) => (
              <Button
                variant="ghost"
                key={image.id}
                type="button"
                onClick={() => onOpen(generation, index)}
                className="relative block h-full w-full overflow-hidden bg-surface-2 p-0"
                aria-label="放大查看"
              >
                {/* 私有图床代理 URL，不能用 next/image 优化，保持原生 img。 */}
                {}
                <img
                  src={image.thumbnailUrl || image.url}
                  alt={generation.prompt}
                  loading="lazy"
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "copy";
                    event.dataTransfer.setData(
                      REFERENCE_DRAG_MIME,
                      JSON.stringify({
                        kind: "source",
                        key: image.id,
                        previewUrl: image.thumbnailUrl || image.url,
                      }),
                    );
                  }}
                  className="h-full w-full object-contain"
                />
              </Button>
            ))}
          </div>
        ) : (
          <div
            className={cn(
              "flex h-full w-full flex-col items-center justify-center gap-2 px-4",
              failed
                ? "bg-danger/5 text-danger"
                : canceled
                  ? "bg-surface-2 text-text-faint"
                  : "bg-surface-2 text-text-muted",
            )}
          >
            {active ? (
              <>
                <span className="text-xs font-medium tabular-nums">
                  {STATUS_LABEL[generation.status]} · {generation.progress}%
                </span>
                <span className="h-1 w-3/4 overflow-hidden rounded-full bg-border">
                  <span
                    className="progress-stripes block h-full rounded-full bg-brand transition-[width] duration-500"
                    style={{ width: `${Math.max(4, generation.progress)}%` }}
                  />
                </span>
                {generation.status === "PENDING" ? (
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={() => onCancel(generation.id)}
                    className="pressable mt-1 flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-text-muted hover:border-border-strong hover:text-foreground"
                  >
                    <Ban size={11} />
                    取消
                  </Button>
                ) : null}
              </>
            ) : failed ? (
              <>
                <AlertTriangle size={18} />
                <span className="line-clamp-3 max-w-full text-center text-xs">
                  {generationErrorMessage(generation)}
                </span>
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => onRetry(generation)}
                  className="pressable mt-1 flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-foreground hover:border-border-strong"
                >
                  <RefreshCw size={11} />
                  重试
                </Button>
              </>
            ) : canceled ? (
              <>
                <ImageOff size={18} />
                <span className="text-xs">已取消</span>
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => onRetry(generation)}
                  className="pressable mt-1 flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-text-muted hover:border-border-strong hover:text-foreground"
                >
                  <RefreshCw size={11} />
                  重新生成
                </Button>
              </>
            ) : (
              <ImageOff size={18} />
            )}
          </div>
        )}
      </div>
      {succeeded ? (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-surface px-3 py-2">
          <Button
            variant="ghost"
            type="button"
            aria-label="放大"
            title="放大"
            onClick={() => onOpen(generation, 0)}
            className="pressable flex h-11 w-11 items-center justify-center rounded-md p-0 text-foreground hover:bg-surface-2 md:h-9 md:w-9"
          >
            <Maximize2 size={13} />
          </Button>
          <a
            href={generation.images[0]?.downloadUrl}
            download
            aria-label="下载"
            title="下载"
            className="pressable flex h-11 w-11 items-center justify-center rounded-md p-0 text-foreground hover:bg-surface-2 md:h-9 md:w-9"
          >
            <Download size={13} />
          </a>
          <Button
            variant="ghost"
            type="button"
            aria-label="用作参考图"
            title="用作参考图"
            onClick={() => onUseAsReference(generation)}
            className="pressable flex h-11 w-11 items-center justify-center rounded-md p-0 text-foreground hover:bg-surface-2 md:h-9 md:w-9"
          >
            <ImagePlus size={13} />
          </Button>
          {generation.images[0]?.id ? (
            <a
              href={`/app/publish?imageId=${encodeURIComponent(generation.images[0].id)}`}
              aria-label="发布到灵感圈"
              title="发布到灵感圈"
              className="pressable flex h-11 w-11 items-center justify-center rounded-md p-0 text-foreground hover:bg-surface-2 md:h-9 md:w-9"
            >
              <Share2 size={13} />
            </a>
          ) : null}
        </div>
      ) : null}

      {variant === "wall" ? (
        <figcaption className="flex flex-col gap-2 border-t border-border px-3 py-2">
          <div className="flex min-w-0 items-start gap-1">
            <p className="line-clamp-2 min-w-0 flex-1 break-words text-sm leading-5 text-foreground">
              {generation.prompt}
            </p>
            <CopyTextButton text={generation.prompt} />
          </div>
          <span className="break-words text-xs leading-4 text-text-muted">
            {modelName ?? generation.modelId} ·{" "}
            {formatDate(generation.createdAt)}
            {generation.source === "agent" ? " · Agent" : ""}
          </span>
        </figcaption>
      ) : null}
    </figure>
  );
}
