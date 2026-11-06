"use client";

import { Button } from "@/components/ui";

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
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <ListChecks size={18} className="text-text-faint" />
        <p className="text-xs text-text-muted">当前没有进行中的任务</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-1.5">
      {active.map((generation) => (
        <div
          key={generation.id}
          className="mb-1 rounded-md border border-border px-2.5 py-2"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="line-clamp-2 min-w-0 flex-1 text-xs leading-4 text-foreground">
              {generation.prompt}
            </p>
            <Button
              variant="ghost"
              type="button"
              onClick={() => onCancel(generation.id)}
              aria-label="取消任务"
              title="取消任务"
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded p-0 text-text-faint transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              <X size={12} />
            </Button>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="shrink-0 text-[10px] tabular-nums text-text-muted">
              {STATUS_LABEL[generation.status]} · {generation.progress}%
            </span>
            <span className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-border">
              <span
                className="progress-stripes block h-full rounded-full bg-brand transition-[width] duration-500"
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
