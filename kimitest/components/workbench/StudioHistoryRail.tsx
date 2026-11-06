import { Copy, ImagePlus } from "lucide-react";

import { stageImageAlt } from "@/components/workbench/GenerationStage";
import type { WorkbenchGeneration } from "@/components/workbench/types";
import { cn } from "@/lib/utils";

interface StudioHistoryRailProps {
  generations: WorkbenchGeneration[];
  activeId: string | null;
  referenceEnabled: boolean;
  onSelect: (generation: WorkbenchGeneration) => void;
  onCopyPrompt: (prompt: string) => void;
  onUseAsReference: (generation: WorkbenchGeneration) => void;
}

export function StudioHistoryRail({
  generations,
  activeId,
  referenceEnabled,
  onSelect,
  onCopyPrompt,
  onUseAsReference,
}: StudioHistoryRailProps): React.ReactElement {
  const ordered = [...generations].reverse();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between px-3 py-3">
        <span className="text-[13px] font-medium text-foreground">创作历史</span>
        <span className="font-mono text-[11px] text-text-faint">
          {generations.length}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {ordered.length === 0 ? (
          <p className="px-2 py-4 text-[12px] leading-5 text-text-faint">
            本次会话还没有生成记录。生成后会出现在这里，可复制提示词或作为参考图。
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {ordered.map((generation) => {
              const image = generation.images?.[0];
              const thumb =
                image?.thumbnailUrl ?? image?.src ?? image?.url ?? null;
              const isActive = generation.id === activeId;
              const status = generation.status?.toUpperCase?.() ?? "";
              const hasImage = Boolean(thumb);

              return (
                <div
                  key={generation.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelect(generation)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelect(generation);
                    }
                  }}
                  className={cn(
                    "group cursor-pointer overflow-hidden rounded-xl border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/60",
                    isActive
                      ? "border-info/60 bg-info/[0.06]"
                      : "border-border bg-surface hover:border-border-strong",
                  )}
                >
                  <div className="relative aspect-square w-full bg-surface-2">
                    {thumb ? (
                      <img
                        src={thumb}
                        alt={stageImageAlt(generation.prompt)}
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center font-mono text-[10px] text-text-faint">
                        {status === "FAILED" || status === "CANCELED"
                          ? "失败"
                          : "生成中…"}
                      </div>
                    )}
                  </div>
                  <div className="px-2.5 py-2">
                    <p className="line-clamp-2 text-[11.5px] leading-4 text-text-muted">
                      {generation.prompt}
                    </p>
                    <div className="mt-2 flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onCopyPrompt(generation.prompt);
                        }}
                        className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10.5px] text-text-muted transition-colors hover:border-border-strong hover:text-foreground"
                      >
                        <Copy size={11} strokeWidth={1.5} />
                        复制
                      </button>
                      {referenceEnabled && hasImage ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onUseAsReference(generation);
                          }}
                          className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10.5px] text-text-muted transition-colors hover:border-border-strong hover:text-foreground"
                        >
                          <ImagePlus size={11} strokeWidth={1.5} />
                          参考
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
