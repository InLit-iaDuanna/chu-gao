"use client";

import { IconButton } from "@/components/ui";

import { ListChecks, X } from "lucide-react";

import {
  isActiveStatus,
  type Generation,
  type GenerationStatus,
} from "../lib/types";

const STATUS_LABEL: Record<GenerationStatus, string> = {
  PENDING: "排队中",
  RUNNING: "生成中",
  SUCCEEDED: "已完成",
  FAILED: "失败",
  CANCELED: "已取消",
};

interface QueuePanelProps {
  generations: Generation[];
  onCancel: (id: string) => void;
}

/** 生成队列面板：实时展示进行中的任务与进度，可取消。 */
export function QueuePanel({ generations, onCancel }: QueuePanelProps) {
  const active = generations.filter((item) => isActiveStatus(item.status));

  if (active.length === 0) {
    return (
      <div className="flex h-full min-w-0 flex-col items-center justify-center gap-3 p-6 text-center tracking-normal">
        <ListChecks size={18} className="text-text-faint" />
        <p className="text-sm leading-6 text-text-muted">
          当前没有进行中的任务
        </p>
      </div>
    );
  }

  return (
    <div className="h-full min-w-0 overflow-y-auto p-3 text-sm tracking-normal">
      {active.map((generation) => (
        <div
          key={generation.id}
          className="mb-3 rounded-lg border border-border bg-surface p-3"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="line-clamp-2 min-w-0 flex-1 text-sm leading-6 text-foreground [overflow-wrap:anywhere]">
              {generation.prompt}
            </p>
            <IconButton
              variant="ghost"
              type="button"
              onClick={() => onCancel(generation.id)}
              aria-label="取消任务"
              title="取消任务"
              className="h-11 w-11 rounded-md sm:h-9 sm:w-9"
            >
              <X size={16} />
            </IconButton>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="shrink-0 text-xs tabular-nums text-text-muted">
              {STATUS_LABEL[generation.status]} · {generation.progress}%
            </span>
            <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-md bg-surface-3">
              <span
                className="block h-full rounded-md bg-brand transition-[width] duration-500"
                style={{
                  width: `${Math.max(4, generation.progress)}%`,
                }}
              />
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
