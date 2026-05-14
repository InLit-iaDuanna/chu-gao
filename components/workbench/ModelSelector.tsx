"use client";

import type { PublicModelDefinition } from "@/lib/models/types";
import { cn } from "@/lib/utils";

type VisibleModel = PublicModelDefinition & {
  groupedIds?: string[];
};

function visibleModels(models: PublicModelDefinition[]): VisibleModel[] {
  const result: VisibleModel[] = [];
  const groups = new Map<string, PublicModelDefinition[]>();

  for (const model of models) {
    if (!model.selectorId) {
      result.push(model);
      continue;
    }

    groups.set(model.selectorId, [...(groups.get(model.selectorId) ?? []), model]);
  }

  for (const grouped of groups.values()) {
    const available = grouped.filter((model) => model.available);
    const candidatePool = available.length ? available : grouped;
    const preferred =
      candidatePool.find((model) => model.id.includes("pro")) ??
      candidatePool[0];

    if (preferred) {
      result.push({
        ...preferred,
        groupedIds: grouped.map((model) => model.id),
        displayName: "Nano Banana 2 / Pro",
        tagline: "Google 生图通道，优先使用 Pro，可用性不足时回退到 Nano Banana 2。",
      });
    }
  }

  return result;
}

export function ModelSelector({
  models,
  activeId,
  onChange,
}: {
  models: PublicModelDefinition[];
  activeId: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="surface-panel p-3">
      <div className="mb-3">
        <p className="eyebrow">模型</p>
        <h3 className="mt-1 text-base font-medium">生成渠道</h3>
      </div>
      <div className="grid gap-2">
        {visibleModels(models).map((model) => {
          const active = (model.groupedIds ?? [model.id]).includes(activeId);
          const disabled = !model.available;

          return (
            <button
              key={model.id}
              type="button"
              className={cn(
                "w-full rounded-[6px] border border-border bg-surface-2/55 px-3 py-2.5 text-left transition-all",
                active &&
                  "border-foreground bg-foreground/10 text-foreground shadow-[inset_0_0_0_1px_rgb(var(--text)/0.16),0_12px_28px_rgb(var(--text)/0.06)]",
                disabled
                  ? "cursor-not-allowed opacity-45"
                  : "hover:border-border-strong hover:bg-surface-2",
              )}
              disabled={disabled}
              aria-pressed={active}
              onClick={() => onChange(model.id)}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs text-text-muted">{model.vendor}</div>
                  <div className="mt-1 truncate text-sm font-medium">
                    {model.displayName}
                  </div>
                </div>
                <div
                  className={cn(
                    "shrink-0 rounded-full border border-border px-2 py-1 font-mono text-[11px] text-text-muted",
                    active && "border-foreground/60 text-foreground",
                  )}
                >
                  {model.available
                    ? model.protocol === "openai-images"
                      ? "动物通道"
                      : model.protocol === "openai-responses-image"
                        ? "对话式"
                        : "Gemini"
                    : "不可用"}
                </div>
              </div>
              <p className="mt-2 line-clamp-2 text-xs leading-5 text-text-muted">
                {model.tagline}
              </p>
            </button>
          );
        })}
        {models.length === 0 ? (
          <p className="surface-panel-soft p-3 text-sm leading-6 text-text-muted">
            模型列表暂时无法读取。你可以刷新页面重试，或稍后再来。
          </p>
        ) : null}
      </div>
    </div>
  );
}
