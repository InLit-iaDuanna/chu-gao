"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

interface HistoryDrawerProps {
  open: boolean;
  onClose: () => void;
  history: Array<{
    id: string;
    prompt: string;
    status: string;
    createdAt: string;
    images: Array<{
      src?: string;
      url?: string;
      thumbnailUrl?: string;
    }>;
  }>;
  activeId: string | null;
  onSelect: (g: HistoryDrawerProps["history"][number]) => void;
}

export function HistoryDrawer({
  open,
  onClose,
  history,
  activeId,
  onSelect,
}: HistoryDrawerProps): React.ReactElement {
  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-0 z-40 bg-background/40"
            onClick={onClose}
          />
          <motion.aside
            key="drawer"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            className="absolute right-0 top-0 z-50 flex h-full w-full max-w-[520px] flex-col border-l border-ink/[0.08] bg-surface/85 shadow-[var(--shadow-lg)]"
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <p className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-text-faint">
                  画廊
                </p>
                <h3 className="mt-1 text-[15px] font-semibold">历史生成</h3>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href="/app/history"
                  className="rounded-md px-2.5 py-1 text-[11.5px] text-text-muted hover:bg-surface-2 hover:text-foreground"
                >
                  全部
                </Link>
                <button
                  type="button"
                  aria-label="关闭"
                  onClick={onClose}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-surface-2 hover:text-foreground"
                >
                  <X size={13} strokeWidth={1.5} />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              {history.length === 0 ? (
                <p className="p-4 text-[13px] text-text-muted">
                  还没有生成记录。
                </p>
              ) : (
                <div className="space-y-2">
                  {history.map((item) => {
                    const img = item.images.at(-1);
                    const url = img?.thumbnailUrl ?? img?.src ?? img?.url;
                    const isActive = item.id === activeId;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => onSelect(item)}
                        className={cn(
                          "group flex w-full gap-3 overflow-hidden rounded-xl border bg-surface-2 p-2 text-left transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)]",
                          isActive
                            ? "border-foreground"
                            : "border-border hover:border-border-strong",
                        )}
                      >
                        {url ? (
                          <div className="h-24 w-24 shrink-0 overflow-hidden rounded-lg bg-background">
                            <img
                              src={url}
                              alt=""
                              loading="lazy"
                              decoding="async"
                              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                            />
                          </div>
                        ) : (
                          <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-lg bg-background text-[10px] font-mono text-text-faint">
                            {item.status}
                          </div>
                        )}
                        <div className="min-w-0 flex-1 py-1">
                          <div className="mb-1.5 flex flex-wrap items-center gap-2">
                            <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-text-faint">
                              提示词
                            </span>
                            <span className="rounded-full border border-border bg-surface px-2 py-0.5 font-mono text-[10.5px] text-text-muted">
                              {item.status}
                            </span>
                          </div>
                          <p className="line-clamp-4 whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-foreground">
                            {item.prompt || "无描述"}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );
}
