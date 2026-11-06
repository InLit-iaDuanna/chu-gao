"use client";

import { useEffect, useState } from "react";
import { Download, Maximize2, Minus, Plus, RotateCcw } from "lucide-react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui";

const ZOOM_LEVELS = [1, 1.5, 2, 3];

export function ImageLightbox({
  open,
  onOpenChange,
  src,
  downloadUrl,
  alt,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  src: string | null | undefined;
  downloadUrl?: string | null;
  alt: string;
}): React.ReactElement | null {
  const [zoomIndex, setZoomIndex] = useState(0);

  useEffect(() => {
    if (!open) {
      setZoomIndex(0);
    }
  }, [open]);

  if (!src) {
    return null;
  }

  const scale = ZOOM_LEVELS[zoomIndex];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[calc(100dvh-24px)] w-[calc(100%-24px)] max-w-none flex-col overflow-hidden bg-background/90 p-0"
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">放大查看生成图片</DialogTitle>
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-ink/[0.07] px-3 pr-12">
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="tool-button h-8 w-8 px-0"
              onClick={() =>
                setZoomIndex((current) => Math.max(0, current - 1))
              }
              disabled={zoomIndex === 0}
              aria-label="缩小图片"
              title="缩小"
            >
              <Minus className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="tool-button h-8 min-w-14 px-2 font-mono text-xs"
              onClick={() => setZoomIndex(0)}
              aria-label="恢复图片大小"
              title="恢复原始缩放"
            >
              {Math.round(scale * 100)}%
            </button>
            <button
              type="button"
              className="tool-button h-8 w-8 px-0"
              onClick={() =>
                setZoomIndex((current) =>
                  Math.min(ZOOM_LEVELS.length - 1, current + 1),
                )
              }
              disabled={zoomIndex === ZOOM_LEVELS.length - 1}
              aria-label="放大图片"
              title="放大"
            >
              <Plus className="h-4 w-4" />
            </button>
            {zoomIndex > 0 ? (
              <button
                type="button"
                className="tool-button ml-1 h-8 w-8 px-0"
                onClick={() => setZoomIndex(0)}
                aria-label="重置缩放"
                title="重置缩放"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
            ) : null}
          </div>
          {downloadUrl ? (
            <a
              href={downloadUrl}
              download
              className="tool-button h-8"
              aria-label="下载原图"
            >
              <Download className="h-4 w-4" />
              下载原图
            </a>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-6">
          <div className="flex min-h-full min-w-full items-center justify-center">
            <img
              src={src}
              alt={alt}
              className="max-h-[calc(100dvh-96px)] max-w-full object-contain transition-transform duration-150"
              style={{ transform: `scale(${scale})` }}
              draggable={false}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ImageZoomHint(): React.ReactElement {
  return (
    <span className="pointer-events-none absolute bottom-3 right-3 flex h-8 w-8 items-center justify-center rounded-full border border-ink/[0.14] bg-black/50 text-foreground opacity-0 shadow-[var(--shadow-xs)] transition-opacity group-hover:opacity-100">
      <Maximize2 className="h-4 w-4" />
    </span>
  );
}
