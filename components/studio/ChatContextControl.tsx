"use client";

import { Minimize2, PieChart, SlidersHorizontal } from "lucide-react";
import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui";
import {
  CHAT_CONTEXT_BUDGET_TOKENS,
  contextBudgetOptionsForModel,
  supportsAdjustableChatContext,
} from "@/lib/chat-context-types";
import { renderStructuredChatMemory } from "@/lib/chat-context-memory";

const tokenCount = (value: number) =>
  value >= 1_000_000
    ? `${(value / 1_000_000).toFixed(value % 1_000_000 ? 1 : 0)}m`
    : value >= 1000
      ? `${(value / 1000).toFixed(value % 1000 ? 1 : 0)}k`
      : String(Math.round(value));

export function ChatContextControl({
  status,
  loading,
  compacting,
  disabled,
  error,
  onCompact,
  modelId,
  budgetTokens,
  onBudgetChange,
}: {
  status: import("@/lib/chat-context-types").ChatContextStatus | null;
  loading: boolean;
  compacting: boolean;
  disabled: boolean;
  error: string | null;
  onCompact: () => void;
  modelId?: string;
  budgetTokens?: number;
  onBudgetChange?: (value: number) => void;
}) {
  const budgetOptions = contextBudgetOptionsForModel(modelId);
  const adjustable = supportsAdjustableChatContext(modelId);
  const budget = adjustable
    ? (budgetTokens ?? status?.budgetTokens ?? budgetOptions[0])
    : (status?.budgetTokens ?? CHAT_CONTEXT_BUDGET_TOKENS);
  const used = status?.estimatedTokens ?? 0;
  const percent = Math.min(100, Math.round((used / budget) * 100));
  const budgetIndex = Math.max(0, budgetOptions.indexOf(budget));
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          title={`应用发送预算（估算）${tokenCount(used)} / ${tokenCount(budget)} tokens`}
          aria-label="上下文用量"
          className="studio-chat-tool h-8 gap-1.5 rounded-md border-transparent px-2 text-xs font-normal text-text-muted"
        >
          <PieChart size={14} />
          <span className="tabular-nums">{loading ? "…" : `${percent}%`}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        collisionPadding={12}
        className="studio-workspace studio-context-controls w-[min(288px,calc(100vw-24px))] space-y-3 rounded-lg p-4"
      >
        <div className="flex items-center justify-between gap-3 text-sm">
          <h2 className="text-sm font-medium leading-5">上下文</h2>
          <span className="text-xs tabular-nums text-text-muted">
            {percent}%
          </span>
        </div>
        <progress
          aria-label="上下文发送预算"
          max={100}
          value={percent}
          className="h-1.5 w-full appearance-none overflow-hidden rounded-full bg-surface-3 [&::-moz-progress-bar]:bg-[rgb(var(--studio-highlight))] [&::-webkit-progress-bar]:bg-surface-3 [&::-webkit-progress-value]:bg-[rgb(var(--studio-highlight))]"
        />
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          <dt className="text-text-muted">估算用量</dt>
          <dd className="text-right tabular-nums">{tokenCount(used)} tokens</dd>
          <dt className="text-text-muted">应用发送预算</dt>
          <dd className="text-right tabular-nums">
            {tokenCount(budget)} tokens
          </dd>
          <dt className="text-text-muted">模型上下文上限</dt>
          <dd className="text-right">尚未验证</dd>
          <dt className="text-text-muted">历史消息</dt>
          <dd className="text-right tabular-nums">
            {status?.messageCount ?? 0} 条
          </dd>
          <dt className="text-text-muted">已压缩</dt>
          <dd className="text-right tabular-nums">
            {status?.compactedMessages ?? 0} 条
          </dd>
        </dl>
        {adjustable && onBudgetChange ? (
          <div className="space-y-2 border-t border-border pt-3">
            <div className="flex items-center justify-between gap-3 text-xs">
              <label
                htmlFor="chat-context-budget"
                className="inline-flex items-center gap-1.5 text-text-muted"
              >
                <SlidersHorizontal size={13} />
                上下文上限
              </label>
              <span className="tabular-nums">{tokenCount(budget)}</span>
            </div>
            <input
              id="chat-context-budget"
              type="range"
              min={0}
              max={budgetOptions.length - 1}
              step={1}
              value={budgetIndex}
              onChange={(event) =>
                onBudgetChange(
                  budgetOptions[Number(event.target.value)] ?? budgetOptions[0],
                )
              }
              aria-label="聊天模型上下文上限"
              className="w-full accent-[rgb(var(--studio-highlight))]"
            />
            <div className="flex justify-between text-[11px] text-text-muted">
              <span>100k</span>
              <span>85% 自动压缩</span>
              <span>{tokenCount(budgetOptions.at(-1) ?? budget)}</span>
            </div>
          </div>
        ) : null}
        {status?.summary ? (
          <details className="border-t border-border pt-3 text-xs">
            <summary className="cursor-pointer text-text-muted">
              上下文摘要
            </summary>
            <p className="mt-2 max-h-44 overflow-y-auto whitespace-pre-wrap break-words leading-6">
              {renderStructuredChatMemory(status.summary)}
            </p>
          </details>
        ) : null}
        {error ? (
          <p role="alert" className="text-xs leading-5 text-danger">
            {error}
          </p>
        ) : null}
        <Button
          type="button"
          variant="secondary"
          className="h-9 w-full gap-2 text-xs"
          onClick={onCompact}
          loading={compacting}
          disabled={disabled || loading || compacting || !status?.canCompact}
        >
          <Minimize2 size={14} />
          {compacting ? "正在压缩…" : "压缩上下文"}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
