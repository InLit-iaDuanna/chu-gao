import Image from "next/image";
import { ArrowUp, ChevronDown, Plus } from "lucide-react";

import { Xiie } from "@/components/studio/chat/Xiie";
import { cn } from "@/lib/utils";

/**
 * A still of the chat workspace for the landing page: the conversation on
 * the left, the finished image filling the canvas on the right. Drawn with
 * the app's tokens, so it follows light and dark themes.
 */
export function ProductPreview({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "marketing-preview relative select-none overflow-hidden rounded-[20px] border border-border bg-background",
        className,
      )}
    >
      <div className="flex h-11 items-center gap-1.5 border-b border-border px-4">
        <span className="h-2.5 w-2.5 rounded-full bg-surface-3" />
        <span className="h-2.5 w-2.5 rounded-full bg-surface-3" />
        <span className="h-2.5 w-2.5 rounded-full bg-surface-3" />
        <span className="mx-auto pr-10 text-xs text-text-faint">湖边木屋 · 晨雾</span>
      </div>

      <div className="grid md:grid-cols-[minmax(0,380px)_1fr]">
        <div className="flex flex-col gap-5 border-border p-5 md:border-r md:p-6">
          <div className="ml-auto w-fit max-w-[90%] rounded-2xl bg-surface-2 px-4 py-2.5 text-[13px] leading-6">
            一座湖边木屋，背后是被云压住的山，想要清晨、安静、有倒影。
          </div>
          <div className="space-y-2.5">
            <Xiie pose="idea" pixel={1} at={0} />
            <p className="text-[13px] leading-6">
              用低机位把木屋压在右下角，湖面占下半幅做倒影；山顶留一层晨雾，色调偏冷，只让木屋的窗透一点暖光。
            </p>
            <div className="flex items-center gap-2 pt-1 text-xs text-text-faint">
              <span className="h-1.5 w-1.5 rounded-full bg-foreground/70" />
              已生成 1 张 · 4:3
            </div>
          </div>
          <div className="mt-auto rounded-2xl border border-border bg-surface px-4 pb-3 pt-3.5">
            <p className="text-[13px] text-text-faint">再把雾压低一点…</p>
            <div className="mt-4 flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-text-muted">
                <Plus size={14} strokeWidth={1.8} />
              </span>
              <span className="ml-auto flex items-center gap-1 text-xs text-text-muted">
                <span className="text-foreground">Claude Opus 5.5</span> Low
                <ChevronDown size={12} strokeWidth={1.8} />
              </span>
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-foreground text-background">
                <ArrowUp size={14} strokeWidth={2} />
              </span>
            </div>
          </div>
        </div>

        <div className="relative hidden min-h-[440px] bg-surface-2 md:block">
          <Image
            src="/studio/landscape.jpg"
            alt=""
            fill
            sizes="(min-width: 1200px) 720px, 60vw"
            className="object-cover"
            priority
          />
          <div className="absolute bottom-4 left-4 rounded-full bg-black/45 px-3 py-1 text-[11px] text-white/90 backdrop-blur">
            v1 · 4:3
          </div>
        </div>
      </div>
    </div>
  );
}
