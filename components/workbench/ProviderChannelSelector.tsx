"use client";

import type { Image2ProviderChannelId } from "@/lib/models/types";
import {
  IMAGE2_PROVIDER_CHANNEL_OPTIONS,
  isImage2ProviderChannelSelectable,
} from "@/lib/provider-channels";
import { cn } from "@/lib/utils";

export function ProviderChannelSelector({
  value,
  onChange,
}: {
  value: Image2ProviderChannelId;
  onChange: (value: Image2ProviderChannelId) => void;
}) {
  return (
    <section className="space-y-2">
      <p className="field-label">大渠道</p>
      <div className="grid gap-2">
        {IMAGE2_PROVIDER_CHANNEL_OPTIONS.map((channel) => {
          const active = channel.id === value;
          const disabled = !isImage2ProviderChannelSelectable(channel.id);

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
              title={disabled ? channel.unavailableReason : undefined}
              aria-pressed={active}
              onClick={() => onChange(channel.id)}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{channel.displayName}</div>
                  <div className="mt-1 text-xs text-text-muted">
                    {disabled ? channel.unavailableReason : "动物账号自动轮询"}
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
