"use client";

import { Button } from "@/components/ui";

import { ArrowUpRight, Megaphone, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import type { AnnouncementTone, PublicAnnouncement } from "@/lib/announcements";
import { cn } from "@/lib/utils";

const TONE_DOT: Record<AnnouncementTone, string> = {
  info: "bg-info",
  warning: "bg-warning",
  success: "bg-success",
  danger: "bg-danger",
};

const TONE_TEXT: Record<AnnouncementTone, string> = {
  info: "text-info",
  warning: "text-warning",
  success: "text-success",
  danger: "text-danger",
};

function showsBanner(announcement: PublicAnnouncement): boolean {
  return announcement.displayMode !== "popup";
}

function showsPopup(announcement: PublicAnnouncement): boolean {
  return announcement.displayMode !== "banner";
}

function dismissKey(id: string): string {
  return `chugao.announcement.dismissed.${id}`;
}

function isDismissed(id: string): boolean {
  try {
    return window.localStorage.getItem(dismissKey(id)) === "true";
  } catch {
    return false;
  }
}

function persistDismiss(id: string): void {
  try {
    window.localStorage.setItem(dismissKey(id), "true");
  } catch {
    // 忽略存储失败，仅本次会话有效。
  }
}

/**
 * 全局公告：横幅 + 弹窗两种形态，支持多条同时投放。
 * 横幅展示第一条未关闭的 banner 公告，关闭后露出下一条；
 * 弹窗逐条弹出未读 popup 公告，全部读完后保留右下角重开入口。
 */
export function AnnouncementBanner({
  announcements,
}: {
  announcements: PublicAnnouncement[];
}) {
  const [dismissedIds, setDismissedIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [hydrated, setHydrated] = useState(false);
  const [popupSuppressed, setPopupSuppressed] = useState(false);

  useEffect(() => {
    const stored = new Set<string>();
    for (const item of announcements) {
      if (isDismissed(item.id)) stored.add(item.id);
    }
    setDismissedIds(stored);
    setPopupSuppressed(false);
    setHydrated(true);
  }, [announcements]);

  const dismiss = (id: string) => {
    persistDismiss(id);
    setDismissedIds((current) => new Set(current).add(id));
  };

  const bannerItem = useMemo(
    () =>
      hydrated
        ? announcements.find(
            (item) => showsBanner(item) && !dismissedIds.has(item.id),
          )
        : undefined,
    [announcements, dismissedIds, hydrated],
  );

  const popupQueue = useMemo(
    () =>
      hydrated
        ? announcements.filter(
            (item) => showsPopup(item) && !dismissedIds.has(item.id),
          )
        : [],
    [announcements, dismissedIds, hydrated],
  );

  const popupItem = popupSuppressed ? undefined : popupQueue[0];
  const reopenable = hydrated && popupQueue.length > 0 && popupSuppressed;

  if (!hydrated || announcements.length === 0) {
    return null;
  }

  return (
    <>
      {bannerItem ? (
        <div
          className="border-b border-border bg-surface"
          role={bannerItem.tone === "danger" ? "alert" : "status"}
        >
          <div className="mx-auto flex h-9 w-full max-w-[1520px] items-center gap-2.5 px-3 sm:px-5 lg:px-6">
            <span
              className={cn(
                "h-1.5 w-1.5 shrink-0 rounded-full",
                TONE_DOT[bannerItem.tone],
              )}
              aria-hidden
            />
            {bannerItem.title ? (
              <span className="shrink-0 text-xs font-semibold tracking-tight">
                {bannerItem.title}
              </span>
            ) : null}
            <p className="min-w-0 flex-1 truncate text-xs text-text-muted">
              {bannerItem.body}
            </p>
            {bannerItem.linkUrl ? (
              <a
                href={bannerItem.linkUrl}
                target={
                  bannerItem.linkUrl.startsWith("/") ? undefined : "_blank"
                }
                rel="noreferrer"
                className={cn(
                  "flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors hover:bg-surface-2",
                  TONE_TEXT[bannerItem.tone],
                )}
              >
                {bannerItem.linkLabel || "查看详情"}
                <ArrowUpRight size={12} aria-hidden />
              </a>
            ) : null}
            <Button
              variant="ghost"
              type="button"
              aria-label="关闭公告"
              onClick={() => dismiss(bannerItem.id)}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md p-0 text-text-faint transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              <X size={13} />
            </Button>
          </div>
        </div>
      ) : null}

      {popupItem ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) dismiss(popupItem.id);
          }}
        >
          <DialogContent hideClose className="max-w-[520px] p-0">
            <DialogHeader className="pb-2 pr-12">
              <div className="mb-2 flex items-center gap-2">
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    TONE_DOT[popupItem.tone],
                  )}
                  aria-hidden
                />
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-faint">
                  公告
                  {popupQueue.length > 1 ? ` · 1/${popupQueue.length}` : ""}
                </span>
              </div>
              <DialogTitle>{popupItem.title || "公告"}</DialogTitle>
              <DialogDescription className="mt-2 whitespace-pre-wrap leading-relaxed">
                {popupItem.body}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="justify-between">
              <div className="flex items-center gap-1.5 text-xs text-text-faint">
                <Megaphone size={12} aria-hidden />
                Chūgǎo Studio
              </div>
              <div className="flex items-center gap-2">
                {popupItem.linkUrl ? (
                  <Button asChild variant="ghost" size="sm">
                    <a
                      href={popupItem.linkUrl}
                      target={
                        popupItem.linkUrl.startsWith("/") ? undefined : "_blank"
                      }
                      rel="noreferrer"
                    >
                      {popupItem.linkLabel || "查看详情"}
                      <ArrowUpRight size={12} aria-hidden />
                    </a>
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => dismiss(popupItem.id)}
                  className="h-8 px-3.5 text-xs"
                >
                  我知道了
                </Button>
              </div>
            </DialogFooter>
            <Button
              variant="ghost"
              type="button"
              aria-label="关闭"
              onClick={() => dismiss(popupItem.id)}
              className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-md p-0 text-text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              <X size={14} />
            </Button>
          </DialogContent>
        </Dialog>
      ) : null}

      {popupQueue.length > 1 && popupItem ? (
        <Button
          variant="ghost"
          type="button"
          onClick={() => setPopupSuppressed(true)}
          className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-3 z-40 text-[11px] text-text-faint underline-offset-2 hover:text-text-muted hover:underline md:bottom-4 md:right-4"
        >
          稍后阅读剩余 {popupQueue.length - 1} 条
        </Button>
      ) : null}

      {reopenable ? (
        <Button
          variant="ghost"
          type="button"
          onClick={() => setPopupSuppressed(false)}
          className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-3 z-40 flex h-9 items-center gap-2 rounded-md border border-border bg-surface px-3 text-xs font-medium text-foreground shadow-[var(--shadow-md)] transition-colors hover:bg-surface-2 md:bottom-4 md:right-4"
        >
          <Megaphone size={13} className="text-text-muted" aria-hidden />
          公告
          <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-semibold text-on-accent">
            {popupQueue.length}
          </span>
        </Button>
      ) : null}
    </>
  );
}
