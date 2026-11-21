"use client";

import * as Menu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import {
  ASTRA_MODEL_ID,
  LUNA_MODEL_ID,
  OPUS_MODEL_ID,
  SOL_MODEL_ID,
  type ChatModelOption,
  type ReasoningEffort,
} from "@/lib/chat-model-options";
import { cn } from "@/lib/utils";

const REASONING_LABELS = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "XHigh",
  max: "Max",
} as const;

const REASONING_HINTS: Record<ReasoningEffort, string> = {
  low: "回答最快",
  medium: "速度与深度均衡",
  high: "多想一会儿",
  xhigh: "适合复杂问题",
  max: "想得最久",
};

/** One line under each model name, the way Claude's picker describes its models. */
const MODEL_TAGLINES: Record<string, string> = {
  [OPUS_MODEL_ID]: "长文与复杂推理",
  [SOL_MODEL_ID]: "深入分析与方案推敲",
  [ASTRA_MODEL_ID]: "最难的创意与推演",
  [LUNA_MODEL_ID]: "轻快的日常讨论",
};

function priceLine(model: ChatModelOption) {
  return model.pricing ? "按用量计费" : `${model.credits} 积分 / 轮`;
}

/** "×0.8" — the retail rate relative to Opus 5.5, the 1× baseline. */
function multiplierLabel(model: ChatModelOption) {
  return typeof model.multiplier === "number" && model.multiplier > 0
    ? `×${Number(model.multiplier.toFixed(2))}`
    : null;
}

export function ChatModelPrice({
  model,
  className,
}: {
  model: ChatModelOption | null;
  className?: string;
}) {
  if (!model) return null;
  return <span className={cn("tabular-nums", className)}>{priceLine(model)}</span>;
}

const panel =
  "studio-workspace studio-model-menu z-50 rounded-xl border border-border bg-surface p-1.5 text-foreground outline-none";
const row =
  "studio-model-item relative flex w-full cursor-pointer select-none items-center gap-3 rounded-lg px-2.5 text-left outline-none transition-colors focus:outline-none focus-visible:outline-none data-[highlighted]:bg-surface-2 data-[state=open]:bg-surface-2 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45";

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
  const efforts = model?.reasoningEfforts ?? [];
  const selectedEffort =
    efforts.find(
      (effort) => effort === (reasoningEffort ?? model?.defaultReasoningEffort),
    ) ?? efforts[0];
  const defaultEffort =
    efforts.find((effort) => effort === model?.defaultReasoningEffort) ??
    efforts[0];

  return (
    <div
      className="studio-model-container min-w-0 flex-1"
      aria-label="聊天模型设置"
    >
      <Menu.Root modal={false}>
        <Menu.Trigger
          type="button"
          disabled={disabled || !model}
          aria-label={
            model
              ? `模型与思考强度：${model.displayName}${selectedEffort ? `，${REASONING_LABELS[selectedEffort]}` : ""}`
              : "聊天模型未就绪"
          }
          title="选择模型与思考强度"
          className="studio-model-trigger smooth-surface inline-flex h-8 max-w-full min-w-0 items-center gap-1 rounded-lg px-2 text-[13px] text-text-muted outline-none transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50 data-[state=open]:text-foreground"
        >
          <span className="min-w-0 truncate text-foreground">
            {model?.displayName ?? "选择模型"}
          </span>
          {selectedEffort ? (
            <span className="shrink-0">{REASONING_LABELS[selectedEffort]}</span>
          ) : null}
          <ChevronDown size={14} strokeWidth={1.8} className="shrink-0" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content
            side="top"
            align="end"
            sideOffset={8}
            collisionPadding={12}
            aria-label="模型与思考强度"
            className={cn(
              panel,
              "w-[min(272px,calc(100vw-24px))] max-h-[min(440px,70dvh)] overflow-y-auto",
            )}
          >
            <Menu.RadioGroup
              aria-label="聊天模型"
              value={model?.id ?? ""}
              onValueChange={(id) => {
                if (id && id !== model?.id) onSelectModel(id);
              }}
            >
              {models.map((item) => {
                const tagline = MODEL_TAGLINES[item.id];
                const multiplier = multiplierLabel(item);
                return (
                  <Menu.RadioItem
                    key={item.id}
                    value={item.id}
                    disabled={disabled}
                    textValue={item.displayName}
                    className={cn(row, "min-h-12 py-2")}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm leading-5">
                        {item.displayName}
                      </span>
                      <span className="block truncate text-xs leading-4 text-text-faint">
                        {tagline ? `${tagline} · ` : ""}
                        {priceLine(item)}
                      </span>
                    </span>
                    {multiplier ? (
                      <span className="shrink-0 text-xs tabular-nums text-text-faint">
                        {multiplier}
                      </span>
                    ) : null}
                    <Menu.ItemIndicator className="shrink-0">
                      <Check size={16} strokeWidth={2} />
                    </Menu.ItemIndicator>
                  </Menu.RadioItem>
                );
              })}
            </Menu.RadioGroup>

            <Menu.Separator className="mx-1 my-1.5 h-px bg-border" />
            <p className="px-2.5 pb-1 text-[11px] leading-4 text-text-faint">
              倍率以 Opus 5.5 为 1× 基准
            </p>

            {selectedEffort ? (
              <>
                <Menu.Separator className="mx-1 my-1.5 h-px bg-border" />
                <Menu.Sub>
                  <Menu.SubTrigger
                    disabled={disabled}
                    aria-label="思考强度"
                    className={cn(row, "min-h-10 py-1.5")}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm leading-5">思考强度</span>
                    </span>
                    <span className="shrink-0 text-[13px] text-text-muted">
                      {REASONING_LABELS[selectedEffort]}
                    </span>
                    <ChevronRight
                      size={15}
                      strokeWidth={1.8}
                      className="shrink-0 text-text-faint"
                    />
                  </Menu.SubTrigger>
                  <Menu.Portal>
                    <Menu.SubContent
                      sideOffset={6}
                      alignOffset={-6}
                      collisionPadding={12}
                      aria-label="思考强度"
                      className={cn(panel, "w-[min(232px,calc(100vw-24px))]")}
                    >
                      <Menu.RadioGroup
                        value={selectedEffort}
                        onValueChange={(value) =>
                          onReasoningEffortChange(value as ReasoningEffort)
                        }
                      >
                        {efforts.map((effort) => (
                          <Menu.RadioItem
                            key={effort}
                            value={effort}
                            disabled={disabled}
                            textValue={REASONING_LABELS[effort]}
                            aria-label={REASONING_LABELS[effort]}
                            className={cn(row, "min-h-11 py-1.5")}
                          >
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-2 text-sm leading-5">
                                {REASONING_LABELS[effort]}
                                {effort === defaultEffort ? (
                                  <span className="text-xs text-text-faint">
                                    默认
                                  </span>
                                ) : null}
                              </span>
                              <span className="block text-xs leading-4 text-text-faint">
                                {REASONING_HINTS[effort]}
                              </span>
                            </span>
                            <Menu.ItemIndicator className="shrink-0">
                              <Check size={16} strokeWidth={2} />
                            </Menu.ItemIndicator>
                          </Menu.RadioItem>
                        ))}
                      </Menu.RadioGroup>
                    </Menu.SubContent>
                  </Menu.Portal>
                </Menu.Sub>
              </>
            ) : null}
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
    </div>
  );
}
