"use client";

import { Megaphone, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button, IconButton } from "@/components/ui";
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
    setIsPopupOpen(showPopup && !popupDismissed);
  }, [announcement, showPopup]);

  if (!announcement) {
    return null;
  }

  function dismissBanner() {
    if (!announcement) {
      return;
    }

    window.localStorage.setItem(bannerDismissKey(announcement), "true");
    setIsBannerDismissed(true);
  }

  function dismissPopup() {
    if (!announcement) {
      return;
    }

    window.localStorage.setItem(popupDismissKey(announcement), "true");
    setIsPopupDismissed(true);
    setIsPopupOpen(false);
  }

  function reopenPopup() {
    setIsPopupOpen(true);
  }

  const banner = showBanner && !isBannerDismissed ? (
    <div
      className="border-b border-border px-3 sm:px-5 lg:px-6"
      role={announcement.tone === "danger" ? "alert" : "status"}
    >
      <div className="mx-auto flex min-h-9 w-full max-w-[1520px] items-center justify-between gap-3 py-1">
        <button
          className="flex min-w-0 items-center gap-3 text-left"
          type="button"
          onClick={showPopup ? reopenPopup : undefined}
        >
          <span
            className={cn(
              "h-5 w-0.5 shrink-0 rounded-full",
              TONE_CLASSES[announcement.tone],
            )}
            aria-hidden="true"
          />
          {announcement.title ? (
            <p className="shrink-0 text-xs font-medium">{announcement.title}</p>
          ) : null}
          <p className="truncate text-xs text-text-muted">
            {announcement.body}
          </p>
        </button>
        <IconButton
          aria-label="关闭公告"
          className="shrink-0"
          size="sm"
          onClick={dismissBanner}
        >
          <X />
        </IconButton>
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
        className="max-w-[560px] overflow-hidden p-0"
        aria-modal="true"
        role={announcement.tone === "danger" ? "alertdialog" : "dialog"}
      >
        <div className={cn("h-1 w-full", TONE_CLASSES[announcement.tone])} />
        <DialogHeader className="px-5 pb-4 pt-5 pr-12">
          <DialogTitle className="text-base">
            {announcement.title || "公告"}
          </DialogTitle>
          <DialogDescription className="mt-2 text-sm leading-6">
            {announcement.body}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="justify-between px-5 py-4">
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <span
              className={cn(
                "h-2.5 w-2.5 rounded-full",
                TONE_CLASSES[announcement.tone],
              )}
              aria-hidden="true"
            />
            <span>全局公告</span>
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
        className="fixed bottom-4 right-4 z-50 inline-flex h-10 items-center gap-2 rounded-full border border-border bg-surface px-3 text-sm shadow-[var(--shadow-md)] transition-colors hover:bg-surface-2"
        type="button"
        onClick={reopenPopup}
      >
        <Megaphone className="h-4 w-4" />
        <span className="max-w-40 truncate">公告</span>
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
