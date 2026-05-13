"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";

import type { PublicAnnouncement } from "@/lib/system-config";
import { cn } from "@/lib/utils";

const TONE_CLASSES = {
  info: "border-border bg-surface text-foreground",
  warning: "border-warning/50 bg-warning/10 text-foreground",
  success: "border-success/50 bg-success/10 text-foreground",
  danger: "border-danger/50 bg-danger/10 text-foreground",
} satisfies Record<PublicAnnouncement["tone"], string>;

export function AnnouncementBanner({
  announcement,
}: {
  announcement: PublicAnnouncement | null;
}) {
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    if (!announcement) {
      setIsDismissed(false);
      return;
    }

    setIsDismissed(
      window.localStorage.getItem(`announcement.dismissed.${announcement.id}`) ===
        "true",
    );
  }, [announcement]);

  if (!announcement || isDismissed) {
    return null;
  }

  function dismiss() {
    if (!announcement) {
      return;
    }

    window.localStorage.setItem(
      `announcement.dismissed.${announcement.id}`,
      "true",
    );
    setIsDismissed(true);
  }

  return (
    <div
      className={cn(
        "border-b px-3 py-2.5 sm:px-5 lg:px-6",
        TONE_CLASSES[announcement.tone],
      )}
      role={announcement.tone === "danger" ? "alert" : "status"}
    >
      <div className="mx-auto flex w-full max-w-[1520px] items-start justify-between gap-3">
        <div className="min-w-0">
          {announcement.title ? (
            <p className="text-sm font-medium">{announcement.title}</p>
          ) : null}
          <p className="break-words text-sm leading-6 text-text-muted">
            {announcement.body}
          </p>
        </div>
        <button
          className="button-subtle h-8 w-8 shrink-0 px-0"
          type="button"
          aria-label="关闭公告"
          title="关闭公告"
          onClick={dismiss}
        >
          <X className="h-4 w-4 stroke-[1.5]" />
        </button>
      </div>
    </div>
  );
}
