"use client";

import type {
  ProviderChannelId,
  PublicProviderChannel,
} from "@/lib/models/types";
import { cn } from "@/lib/utils";

export function ProviderChannelSelector({
  value,
  options,
  onChange,
}: {
  value: ProviderChannelId;
  options: PublicProviderChannel[];
  onChange: (value: ProviderChannelId) => void;
}) {
  return (
    <section className="space-y-2">
      <p className="field-label">大渠道</p>
      <div className="grid gap-2">
        {options.map((channel) => {
          const active = channel.id === value;
          const disabled = channel.availableAccountCount <= 0;

          return (
            <button
              key={channel.id}
              type="button"
              className={cn(
                "selection-card rounded-[10px] border px-3 py-2.5 text-left",
                active && "selection-card-active text-foreground",
                disabled &&
                  "cursor-not-allowed opacity-45 hover:border-border hover:bg-surface",
              )}
              disabled={disabled}
              title={disabled ? "当前渠道不可选" : undefined}
              aria-pressed={active}
              onClick={() => onChange(channel.id)}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{channel.displayName}</div>
                  <div className="mt-1 text-xs text-text-muted">
                    {disabled
                      ? "暂无可用账号"
                      : `${channel.availableAccountCount}/${channel.accountCount} 个动物账号可用`}
                  </div>
                </div>
              </div>
            </button>
          );
        })}
        {options.length === 0 ? (
          <div className="rounded-[10px] border border-border bg-surface-2 px-3 py-2.5 text-sm leading-6 text-text-muted">
            后台还没有给这个模型添加可用大渠道。
          </div>
        ) : null}
      </div>
    </section>
  );
}
