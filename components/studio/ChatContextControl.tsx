"use client";

import { Minimize2, PieChart } from "lucide-react";
import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui";
import {
  chatContextBudget,
  type ChatContextStatus,
} from "@/lib/chat-context-types";

const tokenCount = (value: number) =>
  value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(Math.round(value));

export function ChatContextControl({
  modelId,
  status,
  loading,
  compacting,
  disabled,
  error,
  onCompact,
}: {
  modelId?: string;
  status: ChatContextStatus | null;
  loading: boolean;
  compacting: boolean;
  disabled: boolean;
  error: string | null;
  onCompact: () => void;
}) {
  const budget = status?.budgetTokens ?? chatContextBudget(modelId);
  const used = status?.estimatedTokens ?? 0;
  const percent = Math.min(100, Math.round((used / budget) * 100));
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          title={`应用发送预算（估算）${tokenCount(used)} / ${tokenCount(budget)} tokens`}
          aria-label="上下文用量"
          className="studio-chat-tool h-10 gap-1.5 rounded-md border-transparent px-2 text-xs font-normal text-text-muted sm:h-8"
        >
          <PieChart size={14} />
          <span className="tabular-nums">{loading ? "…" : `${percent}%`}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        collisionPadding={12}
        className="studio-workspace studio-context-controls w-[min(288px,calc(100vw-24px))] space-y-4 rounded-lg p-4"
      >
        <div className="flex items-center justify-between gap-3 text-sm">
          <h2 className="text-sm font-medium leading-5">上下文</h2>
          <span className="text-xs tabular-nums text-text-muted">
            {percent}%
          </span>
        </div>
        <div
          role="progressbar"
          aria-label="上下文发送预算"
          aria-valuemin={0}
          aria-valuemax={budget}
          aria-valuenow={Math.min(used, budget)}
          className="h-1.5 overflow-hidden rounded-full bg-surface-3"
        >
          <div
            className="h-full bg-[rgb(var(--studio-highlight))]"
            style={{ width: `${percent}%` }}
          />
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          <dt className="text-text-muted">估算用量</dt>
          <dd className="text-right tabular-nums">{tokenCount(used)} tokens</dd>
          <dt className="text-text-muted">应用上下文预算</dt>
          <dd className="text-right tabular-nums">
            {tokenCount(budget)} tokens
          </dd>
          <dt className="text-text-muted">用量压缩阈值</dt>
          <dd className="text-right tabular-nums">
            {tokenCount(budget * 0.75)} tokens
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
        {status?.summary ? (
          <details className="border-t border-border pt-3 text-xs">
            <summary className="cursor-pointer text-text-muted">
              上下文摘要
            </summary>
            <p className="mt-2 max-h-44 overflow-y-auto whitespace-pre-wrap break-words leading-6">
              {status.summary}
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
          className="h-10 w-full gap-2 text-xs"
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
