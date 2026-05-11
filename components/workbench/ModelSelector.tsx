"use client";

import type { PublicModelDefinition } from "@/lib/models/types";
import { cn } from "@/lib/utils";

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
        {models.map((model) => {
          const active = model.id === activeId;
          const disabled = !model.available;

          return (
            <button
              key={model.id}
              type="button"
              className={cn(
                "w-full rounded-[6px] border border-border bg-surface-2/55 px-3 py-2.5 text-left transition-colors",
                active && "border-border-strong bg-surface-2",
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
                <div className="shrink-0 rounded-full border border-border px-2 py-1 font-mono text-[11px] text-text-muted">
                  {model.available
                    ? model.protocol === "openai-images"
                      ? "image2"
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
