"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";

import {
  downloadImageUrl,
  filenameForImage,
  previewImageUrl,
  primaryImageUrl,
  type GalleryImage,
} from "@/components/workbench/gallery-images";
import { cn } from "@/lib/utils";

export function ImageGallery({
  images,
  alt,
  statusLabel,
  className,
  imageClassName,
  frameClassName,
  minFrameClassName = "min-h-[390px]",
  defaultIndex,
}: {
  images: GalleryImage[];
  alt: string;
  statusLabel?: string;
  className?: string;
  imageClassName?: string;
  frameClassName?: string;
  minFrameClassName?: string;
  defaultIndex?: number;
}) {
  const viewableImages = useMemo(
    () => images.filter((image) => primaryImageUrl(image)),
    [images],
  );
  const initialIndex =
    typeof defaultIndex === "number"
      ? Math.min(Math.max(defaultIndex, 0), Math.max(viewableImages.length - 1, 0))
      : Math.max(viewableImages.length - 1, 0);
  const [selectedIndex, setSelectedIndex] = useState(initialIndex);
  const selectedImage = viewableImages[selectedIndex] ?? viewableImages[0];
  const selectedUrl = primaryImageUrl(selectedImage);
  const downloadUrl = downloadImageUrl(selectedImage);
  const hasMultiple = viewableImages.length > 1;

  useEffect(() => {
    setSelectedIndex(initialIndex);
  }, [initialIndex, viewableImages.length]);

  if (!selectedImage || !selectedUrl) {
    return null;
  }

  const goTo = (nextIndex: number) => {
    const lastIndex = viewableImages.length - 1;
    const normalized =
      nextIndex < 0 ? lastIndex : nextIndex > lastIndex ? 0 : nextIndex;

    setSelectedIndex(normalized);
  };

  return (
    <div className={cn("relative", className)}>
      <div className="absolute left-4 top-4 z-10 flex max-w-[calc(100%-2rem)] flex-wrap items-center gap-2">
        {statusLabel ? (
          <div className="truncate rounded-full bg-black/55 px-3 py-1 text-xs text-white">
            {statusLabel}
          </div>
        ) : null}
        {hasMultiple ? (
          <div className="rounded-full bg-black/55 px-3 py-1 font-mono text-xs text-white">
            {selectedIndex + 1} / {viewableImages.length}
          </div>
        ) : null}
      </div>

      {downloadUrl ? (
        <a
          href={downloadUrl}
          download={filenameForImage(selectedImage, selectedIndex)}
          className="tool-button absolute right-4 top-4 z-10 h-9 bg-black/55 text-white hover:bg-black/70"
        >
          <Download className="h-4 w-4 stroke-[1.5]" />
          下载原图
        </a>
      ) : null}

      {hasMultiple ? (
        <>
          <button
            type="button"
            className="tool-button absolute left-4 top-1/2 z-10 h-9 w-9 -translate-y-1/2 bg-black/55 px-0 text-white hover:bg-black/70"
            aria-label="上一张"
            title="上一张"
            onClick={() => goTo(selectedIndex - 1)}
          >
            <ChevronLeft className="h-4 w-4 stroke-[1.5]" />
          </button>
          <button
            type="button"
            className="tool-button absolute right-4 top-1/2 z-10 h-9 w-9 -translate-y-1/2 bg-black/55 px-0 text-white hover:bg-black/70"
            aria-label="下一张"
            title="下一张"
            onClick={() => goTo(selectedIndex + 1)}
          >
            <ChevronRight className="h-4 w-4 stroke-[1.5]" />
          </button>
        </>
      ) : null}

      <div
        className={cn(
          "relative flex h-full items-center justify-center overflow-hidden rounded-[8px] bg-background",
          minFrameClassName,
          frameClassName,
        )}
      >
        <img
          src={selectedUrl}
          alt={alt}
          className={cn("h-full max-h-full w-full object-contain", imageClassName)}
          decoding="async"
        />
      </div>

      {hasMultiple ? (
        <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">
          {viewableImages.map((image, index) => {
            const thumbUrl = previewImageUrl(image);

            return (
              <button
                key={image.id ?? `${thumbUrl}-${index}`}
                type="button"
                className={cn(
                  "aspect-square overflow-hidden rounded-[6px] border bg-surface-2 transition-colors hover:border-border-strong",
                  index === selectedIndex
                    ? "border-foreground"
                    : "border-border",
                )}
                aria-label={`查看第 ${index + 1} 张`}
                title={`第 ${index + 1} 张`}
                onClick={() => setSelectedIndex(index)}
              >
                {thumbUrl ? (
                  <img
                    src={thumbUrl}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                    decoding="async"
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
