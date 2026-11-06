import { ChevronLeft, ChevronRight, Copy } from "lucide-react";

interface ActivePromptStripProps {
  prompt: string;
  activeIndex: number;
  total: number;
  onCopy: () => void;
  onPrevious: () => void;
  onNext: () => void;
}

export function ActivePromptStrip({
  prompt,
  activeIndex,
  total,
  onCopy,
  onPrevious,
  onNext,
}: ActivePromptStripProps): React.ReactElement {
  const hasPrevious = activeIndex > 0;
  const hasNext = activeIndex >= 0 && activeIndex < total - 1;
  const positionLabel =
    total > 0 && activeIndex >= 0 ? `${activeIndex + 1} / ${total}` : null;

  return (
    <div className="pointer-events-auto w-full rounded-2xl border border-border bg-surface/90 px-4 py-3 shadow-[var(--shadow-md)]">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-text-faint">
              当前提示词
            </span>
            {positionLabel ? (
              <span className="rounded-full border border-border bg-surface-2 px-2 py-0.5 font-mono text-[10.5px] text-text-muted">
                {positionLabel}
              </span>
            ) : null}
          </div>
          <p className="mt-1 max-h-16 overflow-y-auto whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-foreground">
            {prompt}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1 pt-1">
          <button
            type="button"
            aria-label="复制到输入框"
            title="复制到输入框"
            onClick={onCopy}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-text-muted transition-colors hover:border-border-strong hover:bg-surface-2 hover:text-foreground"
          >
            <Copy size={13} strokeWidth={1.5} />
          </button>
          {total > 1 ? (
            <>
              <button
                type="button"
                aria-label="上一个提示词"
                onClick={onPrevious}
                disabled={!hasPrevious}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-text-muted transition-colors hover:border-border-strong hover:bg-surface-2 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
              >
                <ChevronLeft size={14} strokeWidth={1.5} />
              </button>
              <button
                type="button"
                aria-label="下一个提示词"
                onClick={onNext}
                disabled={!hasNext}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-text-muted transition-colors hover:border-border-strong hover:bg-surface-2 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
              >
                <ChevronRight size={14} strokeWidth={1.5} />
              </button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
