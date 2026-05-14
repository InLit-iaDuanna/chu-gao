"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";

import { IconButton } from "@/components/ui";
import type { PublicAnnouncement } from "@/lib/system-config";
import { cn } from "@/lib/utils";

const TONE_CLASSES = {
  info: "bg-foreground",
  warning: "bg-warning",
  success: "bg-success",
  danger: "bg-danger",
} satisfies Record<PublicAnnouncement["tone"], string>;

export function AnnouncementBanner({
  announcement,
}: {
  announcement: PublicAnnouncement | null;
}): React.ReactElement | null {
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    if (!announcement) {
      setIsDismissed(false);
      return;
    }

    setIsDismissed(
      window.localStorage.getItem(
        `announcement.dismissed.${announcement.id}`,
      ) === "true",
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
      className="border-b border-border px-3 sm:px-5 lg:px-6"
      role={announcement.tone === "danger" ? "alert" : "status"}
    >
      <div className="mx-auto flex h-9 w-full max-w-[1520px] items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
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
        </div>
        <IconButton
          aria-label="关闭公告"
          className="shrink-0"
          size="sm"
          onClick={dismiss}
        >
          <X />
        </IconButton>
      </div>
    </div>
  );
}
