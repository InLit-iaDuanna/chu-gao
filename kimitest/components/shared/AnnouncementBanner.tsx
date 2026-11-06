"use client";

import { Megaphone, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import type {
  AnnouncementDisplayMode,
  PublicAnnouncement,
} from "@/lib/system-config";
import { cn } from "@/lib/utils";

const TONE_CLASSES = {
  info: "bg-foreground",
  warning: "bg-warning",
  success: "bg-success",
  danger: "bg-danger",
} satisfies Record<PublicAnnouncement["tone"], string>;

const TONE_GLOW = {
  info: "",
  warning: "",
  success: "",
  danger: "",
} satisfies Record<PublicAnnouncement["tone"], string>;

const TONE_BG = {
  info: "bg-foreground/10",
  warning: "bg-warning/10",
  success: "bg-success/10",
  danger: "bg-danger/10",
} satisfies Record<PublicAnnouncement["tone"], string>;

const TONE_GRADIENT = {
  info: "bg-gradient-to-r from-foreground to-transparent",
  warning: "bg-gradient-to-r from-warning to-transparent",
  success: "bg-gradient-to-r from-success to-transparent",
  danger: "bg-gradient-to-r from-danger to-transparent",
} satisfies Record<PublicAnnouncement["tone"], string>;

function bannerDismissKey(announcement: PublicAnnouncement): string {
  return `announcement.banner.dismissed.${announcement.id}`;
}

function popupDismissKey(announcement: PublicAnnouncement): string {
  return `announcement.popup.dismissed.${announcement.id}`;
}

function legacyDismissKey(announcement: PublicAnnouncement): string {
  return `announcement.dismissed.${announcement.id}`;
}

function shouldShowPopup(displayMode: AnnouncementDisplayMode): boolean {
  return displayMode === "popup" || displayMode === "both";
}

function shouldShowBanner(displayMode: AnnouncementDisplayMode): boolean {
  return displayMode === "banner" || displayMode === "both";
}

export function AnnouncementBanner({
  announcement,
}: {
  announcement: PublicAnnouncement | null;
}): React.ReactElement | null {
  const [isBannerDismissed, setIsBannerDismissed] = useState(false);
  const [isPopupDismissed, setIsPopupDismissed] = useState(false);
  const [isPopupOpen, setIsPopupOpen] = useState(false);

  const showBanner = useMemo(
    () => Boolean(announcement && shouldShowBanner(announcement.displayMode)),
    [announcement],
  );
  const showPopup = useMemo(
    () => Boolean(announcement && shouldShowPopup(announcement.displayMode)),
    [announcement],
  );

  useEffect(() => {
    if (!announcement) {
      setIsBannerDismissed(false);
      setIsPopupDismissed(false);
      setIsPopupOpen(false);
      return;
    }

    const bannerDismissed =
      window.localStorage.getItem(bannerDismissKey(announcement)) === "true" ||
      window.localStorage.getItem(legacyDismissKey(announcement)) === "true";
    const popupDismissed =
      window.localStorage.getItem(popupDismissKey(announcement)) === "true";

    setIsBannerDismissed(bannerDismissed);
    setIsPopupDismissed(popupDismissed);
    setIsPopupOpen(Boolean(showPopup && !popupDismissed));
  }, [announcement, showPopup]);

  if (!announcement) {
    return null;
  }

  const currentAnnouncement = announcement;

  function dismissBanner() {
    window.localStorage.setItem(bannerDismissKey(currentAnnouncement), "true");
    setIsBannerDismissed(true);
  }

  function dismissPopup() {
    window.localStorage.setItem(popupDismissKey(currentAnnouncement), "true");
    setIsPopupDismissed(true);
    setIsPopupOpen(false);
  }

  function reopenPopup() {
    setIsPopupOpen(true);
  }

  const banner =
    showBanner && !isBannerDismissed ? (
      <div
        className="border-b border-border bg-surface px-3 sm:px-5 lg:px-6"
        role={announcement.tone === "danger" ? "alert" : "status"}
      >
        <div className="mx-auto flex min-h-9 w-full max-w-[1520px] items-center justify-between gap-3 py-1">
          <button
            className="group flex min-w-0 items-center gap-3 text-left transition-transform active:translate-y-0.5"
            type="button"
            onClick={showPopup ? reopenPopup : undefined}
          >
            <span
              className={cn(
                "h-5 w-1 shrink-0 rounded-sm transition-all",
                TONE_CLASSES[announcement.tone],
                TONE_GLOW[announcement.tone],
                "group-hover:w-1.5",
              )}
              aria-hidden="true"
            />
            {announcement.title ? (
              <p className="shrink-0 text-xs font-semibold tracking-tight">
                {announcement.title}
              </p>
            ) : null}
            <p className="truncate text-xs text-text-muted transition-colors group-hover:text-foreground">
              {announcement.body}
            </p>
          </button>
          <button
            aria-label="关闭公告"
            className="group shrink-0 rounded-md p-1.5 transition-all hover:bg-surface-3 active:scale-95"
            type="button"
            onClick={dismissBanner}
          >
            <X className="h-[18px] w-[18px] transition-transform group-hover:rotate-90" />
          </button>
        </div>
      </div>
    ) : null;

  const popup = showPopup ? (
    <Dialog
      open={isPopupOpen}
      onOpenChange={(open) => {
        if (open) {
          setIsPopupOpen(true);
        } else {
          dismissPopup();
        }
      }}
    >
      <DialogContent
        hideClose
        className="max-w-[560px] overflow-hidden p-0"
        aria-modal="true"
        role={announcement.tone === "danger" ? "alertdialog" : "dialog"}
      >
        <div
          className={cn("h-2 w-full", TONE_GRADIENT[announcement.tone])}
          aria-hidden="true"
        />
        <DialogHeader className="relative px-5 pb-4 pt-5 pr-12">
          <button
            aria-label="关闭"
            className="group absolute right-5 top-5 rounded-md p-1.5 transition-all hover:bg-surface-3 active:scale-95"
            type="button"
            onClick={dismissPopup}
          >
            <X className="h-[18px] w-[18px] transition-transform group-hover:rotate-90" />
          </button>
          <DialogTitle className="text-base font-bold tracking-tight">
            {announcement.title || "公告"}
          </DialogTitle>
          <DialogDescription className="mt-2 text-sm leading-relaxed">
            {announcement.body}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="justify-between border-t border-border px-5 py-4">
          <div className="flex items-center gap-2.5 text-xs text-text-muted">
            <span
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-full",
                TONE_BG[announcement.tone],
              )}
              aria-hidden="true"
            >
              <Megaphone
                className={cn("h-3.5 w-3.5", TONE_CLASSES[announcement.tone])}
              />
            </span>
            <span className="font-medium">全局公告</span>
          </div>
          <Button variant="primary" onClick={dismissPopup}>
            我知道了
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ) : null;

  const popupEntry =
    showPopup && isPopupDismissed && !isPopupOpen ? (
      <button
        className="fixed bottom-4 right-4 z-50 inline-flex h-12 items-center gap-2.5 rounded-[var(--radius-md)] border border-border bg-surface px-4 text-sm font-semibold shadow-[var(--shadow-md)] transition-colors hover:border-border-strong"
        type="button"
        onClick={reopenPopup}
      >
        <span
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-full",
            TONE_BG[announcement.tone],
          )}
          aria-hidden="true"
        >
          <Megaphone
            className={cn("h-4 w-4", TONE_CLASSES[announcement.tone])}
          />
        </span>
        <span className="max-w-40 truncate tracking-tight">公告</span>
      </button>
    ) : null;

  return (
    <>
      {banner}
      {popup}
      {popupEntry}
    </>
  );
}
