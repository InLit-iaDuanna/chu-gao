"use client";

import {
  Button,
  DropdownMenu,
  DropdownMenuItem,
  IconButton,
} from "@/components/ui";

import type { CSSProperties } from "react";
import { ArrowDown, MoreHorizontal, Sparkles, Trash2 } from "lucide-react";

import { GenerationCard } from "./GenerationCard";
import type { Generation, ModelInfo } from "./lib/types";

const SKELETON_RATIOS = [1, 0.78, 1.22, 0.9, 1.1, 0.85, 1, 1.18];

export const SUGGESTIONS = [
  "雾中山城，晨光从云层间落下，电影感",
  "一只穿宇航服的橘猫，漂浮在星云里",
  "极简产品海报：陶瓷咖啡杯，柔和侧光",
  "水墨风格的梯田日出，远景云雾缭绕",
];

interface GenerationWallProps {
  generations: Generation[];
  models: ModelInfo[];
  loading: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onCancel: (id: string) => void;
  onRetry: (generation: Generation) => void;
  onOpen: (generation: Generation, imageIndex: number) => void;
  onUseAsReference: (generation: Generation) => void;
  onClear: () => void;
  clearing: boolean;
  onPickSuggestion?: (text: string) => void;
}

export function GenerationWall({
  generations,
  models,
  loading,
  hasMore,
  loadingMore,
  onLoadMore,
  onCancel,
  onRetry,
  onOpen,
  onUseAsReference,
  onClear,
  clearing,
  onPickSuggestion,
}: GenerationWallProps) {
  const modelNameOf = (modelId: string) =>
    models.find((model) => model.id === modelId)?.displayName;

  if (loading) {
    return (
      <div className="columns-[280px] gap-4">
        {SKELETON_RATIOS.map((ratio, index) => (
          <div
            key={index}
            className="skeleton-shimmer mb-4 break-inside-avoid rounded-lg border border-border"
            style={{ aspectRatio: String(ratio) }}
          />
        ))}
      </div>
    );
  }

  if (generations.length === 0) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center px-2 py-8 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-lg border border-border-strong bg-surface-2 text-foreground md:h-14 md:w-14">
          <Sparkles size={22} strokeWidth={1.8} />
        </span>

        <h2 className="mt-4 text-lg font-semibold leading-6 md:mt-5">
          还没有生成图片
        </h2>

        {onPickSuggestion ? (
          <div className="mt-5 flex w-full max-w-xl flex-wrap items-center justify-center gap-2 md:mt-6">
            {SUGGESTIONS.map((text) => (
              <Button
                variant="ghost"
                key={text}
                type="button"
                onClick={() => onPickSuggestion(text)}
                className="pressable h-auto min-h-11 max-w-full whitespace-normal break-words rounded-md border border-border bg-surface px-3 py-2 text-center text-sm leading-5 text-text-muted hover:border-accent/50 hover:text-foreground"
              >
                {text}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-xs text-text-muted">
          {generations.length} 条生成记录
        </p>
        <DropdownMenu
          trigger={
            <IconButton
              type="button"
              variant="ghost"
              aria-label="生成记录操作"
              title="生成记录操作"
            >
              <MoreHorizontal size={16} />
            </IconButton>
          }
        >
          <DropdownMenuItem onClick={onClear} disabled={clearing}>
            <Trash2 size={14} />
            {clearing ? "清除中…" : "清除生成墙"}
          </DropdownMenuItem>
        </DropdownMenu>
      </div>
      <div className="columns-[280px] gap-4">
        {generations.map((generation, index) => (
          <GenerationCard
            key={generation.id}
            generation={generation}
            modelName={modelNameOf(generation.modelId)}
            style={{ "--i": Math.min(index, 10) } as CSSProperties}
            onCancel={onCancel}
            onRetry={onRetry}
            onOpen={onOpen}
            onUseAsReference={onUseAsReference}
          />
        ))}
      </div>

      {hasMore ? (
        <div className="flex justify-center py-4">
          <Button
            variant="ghost"
            type="button"
            onClick={onLoadMore}
            disabled={loadingMore}
            className="pressable flex items-center gap-1.5 rounded-md border border-border bg-surface px-4 py-2 text-xs font-medium text-text-muted hover:border-border-strong hover:text-foreground disabled:opacity-50"
          >
            <ArrowDown size={12} />
            {loadingMore ? "加载中…" : "加载更多"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
