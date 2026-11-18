"use client";

import { Button, IconButton } from "@/components/ui";

import { History, ImagePlus, Loader2, RotateCcw } from "lucide-react";

import { cn, formatDate } from "@/lib/utils";

import type { Generation, GenerationStatus, ModelInfo } from "../lib/types";
import { CopyTextButton } from "../CopyTextButton";
import { REFERENCE_DRAG_MIME } from "../lib/reference-input";

const STATUS_LABEL: Record<GenerationStatus, string> = {
  PENDING: "排队中",
  RUNNING: "生成中",
  SUCCEEDED: "已完成",
  FAILED: "失败",
  CANCELED: "已取消",
};

interface HistoryPanelProps {
  generations: Generation[];
  models: ModelInfo[];
  loading: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onOpen: (generation: Generation) => void;
  onUseAsReference: (generation: Generation) => void;
  onRetry: (generation: Generation) => void;
}

/** 历史生成面板：紧凑列表，点击打开灯箱，可快速复用参考图/还原提示词。 */
export function HistoryPanel({
  generations,
  models,
  loading,
  hasMore,
  loadingMore,
  onLoadMore,
  onOpen,
  onUseAsReference,
  onRetry,
}: HistoryPanelProps) {
  const modelName = (id: string) =>
    models.find((item) => item.id === id)?.displayName ?? id;

  if (loading) {
    return (
      <div className="flex h-full flex-col gap-2 overflow-hidden p-2">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex gap-2.5 px-1 py-1">
            <div className="h-12 w-12 shrink-0 animate-pulse rounded-md border border-border bg-surface-2" />
            <div className="min-w-0 flex-1 space-y-2 py-1">
              <div className="h-3 w-full animate-pulse rounded bg-surface-2" />
              <div className="h-2.5 w-2/3 animate-pulse rounded bg-surface-2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (generations.length === 0) {
    return (
      <div className="flex h-full min-w-0 flex-col items-center justify-center gap-3 p-6 text-center tracking-normal">
        <History size={18} className="text-text-faint" />
        <p className="text-sm leading-6 text-text-muted">
          还没有生成记录，从下方输入框开始第一张图
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col text-sm tracking-normal">
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {generations.map((generation) => {
          const image = generation.images[0];
          const active =
            generation.status === "PENDING" || generation.status === "RUNNING";
          return (
            <div
              key={generation.id}
              className="group relative flex min-w-0 flex-col gap-2 border-b border-border px-2 py-3 transition-colors hover:bg-surface-2"
            >
              <Button
                variant="ghost"
                type="button"
                onClick={() => onOpen(generation)}
                disabled={!image}
                className="h-auto min-h-11 w-full min-w-0 flex-1 items-start gap-3 whitespace-normal rounded-md p-0 text-left font-normal"
              >
                {image ? (
                  <img
                    src={image.thumbnailUrl || image.url}
                    alt={generation.prompt}
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
                    className="h-12 w-12 shrink-0 rounded-md border border-border object-cover"
                  />
                ) : (
                  <span
                    className={cn(
                      "flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2 text-xs",
                      active ? "text-brand" : "text-text-faint",
                    )}
                  >
                    {active ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      STATUS_LABEL[generation.status]
                    )}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-sm leading-6 text-foreground [overflow-wrap:anywhere]">
                    {generation.prompt}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5 text-text-muted">
                    <span className="max-w-24 truncate">
                      {modelName(generation.modelId)}
                    </span>
                    <span aria-hidden>·</span>
                    {generation.source === "agent" ? (
                      <span className="shrink-0 text-text-muted">Agent ·</span>
                    ) : null}
                    <span className="shrink-0">
                      {formatDate(generation.createdAt)}
                    </span>
                    {generation.status !== "SUCCEEDED" ? (
                      <span
                        className={cn(
                          "shrink-0 rounded-md px-2 py-0.5",
                          generation.status === "FAILED"
                            ? "bg-danger/12 text-danger"
                            : "bg-surface-3 text-text-muted",
                        )}
                      >
                        {STATUS_LABEL[generation.status]}
                        {generation.status === "RUNNING"
                          ? ` ${generation.progress}%`
                          : ""}
                      </span>
                    ) : null}
                  </span>
                </span>
              </Button>

              <span className="flex w-full flex-wrap items-center justify-end gap-1">
                <CopyTextButton text={generation.prompt} />
                {image ? (
                  <IconButton
                    variant="ghost"
                    type="button"
                    onClick={() => onUseAsReference(generation)}
                    aria-label="用作参考图"
                    title="用作参考图"
                    className="h-11 w-11 rounded-md sm:h-9 sm:w-9"
                  >
                    <ImagePlus size={16} />
                  </IconButton>
                ) : null}
                <IconButton
                  variant="ghost"
                  type="button"
                  onClick={() => onRetry(generation)}
                  aria-label="还原提示词与模型"
                  title="还原提示词与模型"
                  className="h-11 w-11 rounded-md sm:h-9 sm:w-9"
                >
                  <RotateCcw size={16} />
                </IconButton>
              </span>
            </div>
          );
        })}
      </div>

      {hasMore ? (
        <div className="shrink-0 border-t border-border p-2">
          <Button
            variant="secondary"
            type="button"
            onClick={onLoadMore}
            disabled={loadingMore}
            className="h-11 w-full gap-2 rounded-md text-sm sm:h-9"
          >
            {loadingMore ? (
              <Loader2 size={12} className="animate-spin" />
            ) : null}
            加载更多
          </Button>
        </div>
      ) : null}
    </div>
  );
}
