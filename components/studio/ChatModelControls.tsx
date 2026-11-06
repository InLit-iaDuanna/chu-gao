"use client";

import { useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Zap,
} from "lucide-react";
import {
  Button,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui";
import type {
  ChatModelOption,
  ReasoningEffort,
} from "@/lib/chat-model-options";
import { cn } from "@/lib/utils";

const REASONING_LABELS = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "XHigh",
  max: "Max",
} as const;

export function ChatModelControls({
  models,
  model,
  reasoningEffort,
  onSelectModel,
  onReasoningEffortChange,
  disabled = false,
}: {
  models: ChatModelOption[];
  model: ChatModelOption | null;
  reasoningEffort?: ReasoningEffort;
  onSelectModel: (id: string) => void;
  onReasoningEffortChange: (effort: ReasoningEffort) => void;
  disabled?: boolean;
}) {
  const [choosingModel, setChoosingModel] = useState(false);
  const efforts = model?.reasoningEfforts ?? [];
  const selectedIndex = Math.max(
    0,
    efforts.findIndex(
      (effort) => effort === (reasoningEffort ?? model?.defaultReasoningEffort),
    ),
  );
  const selectedEffort = efforts[selectedIndex];
  const defaultEffort =
    efforts.find((effort) => effort === model?.defaultReasoningEffort) ??
    efforts[0];
  const progress =
    efforts.length > 1 ? selectedIndex / (efforts.length - 1) : 0;
  const showModels = choosingModel || !selectedEffort;

  return (
    <div
      className="col-start-2 row-start-1 min-w-0 flex-1"
      aria-label="聊天模型设置"
    >
      <Popover
        onOpenChange={(open) => {
          if (!open) setChoosingModel(false);
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            disabled={disabled || !model}
            aria-label={
              model
                ? `模型与思考强度：${model.displayName}${selectedEffort ? `，${REASONING_LABELS[selectedEffort]}` : ""}`
                : "聊天模型未就绪"
            }
            title="选择模型与思考强度"
            className="studio-model-trigger h-11 max-w-full min-w-0 gap-1 rounded-full border-transparent bg-surface-2 px-2.5 text-xs font-normal text-foreground hover:bg-surface-3 sm:h-9 sm:gap-1.5 sm:px-3.5 sm:text-[13px]"
          >
            <span className="min-w-0 truncate">
              {model?.displayName ?? "选择模型"}
            </span>
            {selectedEffort ? (
              <span className="shrink-0 text-text-muted">
                {REASONING_LABELS[selectedEffort]}
              </span>
            ) : null}
            <ChevronDown size={14} className="shrink-0 text-text-muted" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="center"
          sideOffset={12}
          collisionPadding={12}
          aria-label="模型与思考强度"
          className="studio-workspace studio-model-controls w-[min(288px,calc(100vw-24px))] max-w-[calc(100vw-24px)] overflow-hidden rounded-2xl border-border-strong/60 bg-surface p-3 shadow-[0_8px_32px_-12px_rgb(0_0_0/0.25)]"
        >
          {showModels ? (
            <div className="space-y-2">
              <div className="flex h-9 items-center gap-2 px-1">
                {selectedEffort ? (
                  <IconButton
                    type="button"
                    variant="ghost"
                    aria-label="返回思考强度"
                    title="返回思考强度"
                    onClick={() => setChoosingModel(false)}
                    className="h-9 w-9 rounded-full"
                  >
                    <ArrowLeft size={16} />
                  </IconButton>
                ) : null}
                <p className="text-sm font-medium">选择模型</p>
              </div>
              <div
                className="max-h-[min(320px,45dvh)] space-y-1 overflow-y-auto"
                role="radiogroup"
                aria-label="聊天模型"
              >
                {models.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="radio"
                    aria-checked={item.id === model?.id}
                    disabled={disabled}
                    onClick={() => {
                      onSelectModel(item.id);
                      setChoosingModel(false);
                    }}
                    className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-50"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-sm">
                        {item.displayName}
                      </span>
                      <span className="mt-0.5 block text-xs text-text-faint">
                        {item.credits} 积分 / 轮
                      </span>
                    </span>
                    {item.id === model?.id ? (
                      <Check size={16} className="shrink-0 text-foreground" />
                    ) : null}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div className="mb-3 grid grid-cols-[36px_minmax(0,1fr)_36px] items-start gap-1">
                <span
                  className="flex h-9 items-center justify-center text-text-faint"
                  aria-hidden="true"
                >
                  <Zap size={16} strokeWidth={1.7} />
                </span>
                <div className="min-w-0 text-center">
                  <p
                    className="text-base font-medium leading-6 text-[#3b82f6]"
                    aria-live="polite"
                  >
                    {REASONING_LABELS[selectedEffort]}
                  </p>
                  <button
                    type="button"
                    aria-label="选择聊天模型"
                    onClick={() => setChoosingModel(true)}
                    className="inline-flex min-h-7 max-w-full items-center justify-center gap-0.5 rounded-md px-1 text-xs text-text-muted transition-colors hover:text-foreground"
                  >
                    <span className="min-w-0 truncate">
                      {model?.displayName}
                    </span>
                    <ChevronRight size={14} className="shrink-0" />
                  </button>
                </div>
                <IconButton
                  type="button"
                  variant="ghost"
                  aria-label="恢复默认思考强度"
                  title="恢复默认思考强度"
                  disabled={disabled || selectedEffort === defaultEffort}
                  onClick={() => {
                    if (defaultEffort) onReasoningEffortChange(defaultEffort);
                  }}
                  className="h-9 w-9 rounded-full border-transparent bg-transparent text-text-faint hover:bg-surface-2 hover:text-foreground"
                >
                  <RotateCcw size={16} strokeWidth={1.7} />
                </IconButton>
              </div>
              <div className={cn("relative h-11", disabled && "opacity-50")}>
                <div className="pointer-events-none absolute inset-x-0 top-2 h-7 overflow-hidden rounded-full border border-border-strong/50 bg-surface-3">
                  <div
                    className="h-full rounded-l-full bg-[#3b82f6]"
                    style={{
                      width: `calc(${progress * 100}% + ${16 - progress * 32}px)`,
                    }}
                  />
                </div>
                <div
                  className="pointer-events-none absolute inset-x-4 inset-y-0 flex items-center justify-between"
                  aria-hidden="true"
                >
                  {efforts.map((effort, index) => (
                    <span
                      key={effort}
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        index <= selectedIndex
                          ? "bg-white/50"
                          : "bg-text-faint/70",
                      )}
                    />
                  ))}
                </div>
                <input
                  type="range"
                  min={0}
                  max={efforts.length - 1}
                  step={1}
                  value={selectedIndex}
                  disabled={disabled || efforts.length === 1}
                  aria-label="思考强度"
                  aria-valuetext={REASONING_LABELS[selectedEffort]}
                  onChange={(event) => {
                    const effort = efforts[Number(event.target.value)];
                    if (effort) onReasoningEffortChange(effort);
                  }}
                  className="studio-effort-range"
                />
              </div>
            </>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
