"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Download } from "lucide-react";

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
  selectedIndex: controlledSelectedIndex,
  onSelectedIndexChange,
  variant = "single",
}: {
  images: GalleryImage[];
  alt: string;
  statusLabel?: string;
  className?: string;
  imageClassName?: string;
  frameClassName?: string;
  minFrameClassName?: string;
  defaultIndex?: number;
  selectedIndex?: number;
  onSelectedIndexChange?: (index: number) => void;
  variant?: "single" | "grid";
}) {
  const viewableImages = useMemo(
    () => images.filter((image) => primaryImageUrl(image)),
    [images],
  );
  const initialIndex =
    typeof defaultIndex === "number"
      ? Math.min(
          Math.max(defaultIndex, 0),
          Math.max(viewableImages.length - 1, 0),
        )
      : Math.max(viewableImages.length - 1, 0);
  const [uncontrolledSelectedIndex, setUncontrolledSelectedIndex] =
    useState(initialIndex);
  const selectedIndex =
    typeof controlledSelectedIndex === "number"
      ? Math.min(
          Math.max(controlledSelectedIndex, 0),
          Math.max(viewableImages.length - 1, 0),
        )
      : uncontrolledSelectedIndex;
  const selectedImage = viewableImages[selectedIndex] ?? viewableImages[0];
  const selectedUrl = primaryImageUrl(selectedImage);
  const downloadUrl = downloadImageUrl(selectedImage);
  const hasMultiple = viewableImages.length > 1;

  useEffect(() => {
    if (typeof controlledSelectedIndex !== "number") {
      setUncontrolledSelectedIndex(initialIndex);
    }
  }, [controlledSelectedIndex, initialIndex, viewableImages.length]);

  useEffect(() => {
    if (
      typeof controlledSelectedIndex === "number" &&
      viewableImages.length > 0 &&
      controlledSelectedIndex >= viewableImages.length
    ) {
      onSelectedIndexChange?.(viewableImages.length - 1);
    }
  }, [controlledSelectedIndex, onSelectedIndexChange, viewableImages.length]);

  if (!selectedImage || !selectedUrl) {
    return null;
  }

  const setSelectedIndex = (nextIndex: number) => {
    if (typeof controlledSelectedIndex !== "number") {
      setUncontrolledSelectedIndex(nextIndex);
    }

    onSelectedIndexChange?.(nextIndex);
  };

  if (variant === "grid" && hasMultiple) {
    return (
      <div className={cn("relative h-full", className)}>
        <div className="grid h-full grid-cols-2 gap-3 p-3">
          {viewableImages.slice(0, 4).map((image, index) => {
            const imageUrl = primaryImageUrl(image);
            const href = downloadImageUrl(image);
            const isSelected = index === selectedIndex;

            return (
              <div
                key={image.id ?? `${imageUrl}-${index}`}
                className={cn(
                  "group relative min-h-0 overflow-hidden rounded-xl border bg-surface-2 transition-all hover:-translate-y-0.5 hover:border-border-strong hover:shadow-[var(--shadow-md)]",
                  isSelected
                    ? "border-foreground shadow-[var(--shadow-ring-strong)]"
                    : "border-border",
                )}
              >
                <button
                  type="button"
                  className="absolute inset-0 z-10 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/60"
                  aria-label={`查看第 ${index + 1} 张`}
                  title={`第 ${index + 1} 张`}
                  onClick={() => setSelectedIndex(index)}
                />
                {imageUrl ? (
                  <img
                    src={imageUrl}
                    alt={alt}
                    className="pointer-events-none h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                    loading={index === 0 ? undefined : "lazy"}
                    decoding="async"
                  />
                ) : null}
                <span className="pointer-events-none absolute bottom-3 left-3 z-10 rounded-md border border-border bg-background/80 px-2 py-1 font-mono text-[11px] text-foreground shadow-[var(--shadow-xs)] backdrop-blur-sm">
                  v{index + 1}
                </span>
                {isSelected ? (
                  <span className="pointer-events-none absolute right-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded-md border border-foreground/30 bg-foreground text-background shadow-[var(--shadow-xs)]">
                    <Check className="h-3.5 w-3.5 stroke-[2]" />
                  </span>
                ) : null}
                {href ? (
                  <a
                    href={href}
                    download={filenameForImage(image, index)}
                    className={cn(
                      "absolute top-3 z-20 flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background/80 text-foreground opacity-0 shadow-[var(--shadow-xs)] backdrop-blur-sm transition-opacity hover:bg-surface group-hover:opacity-100 focus:opacity-100",
                      isSelected ? "right-12" : "right-3",
                    )}
                    aria-label={`下载第 ${index + 1} 张原图`}
                    title="下载原图"
                  >
                    <Download className="h-4 w-4 stroke-[1.5]" />
                  </a>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    );
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
          className={cn(
            "h-full max-h-full w-full object-contain",
            imageClassName,
          )}
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
