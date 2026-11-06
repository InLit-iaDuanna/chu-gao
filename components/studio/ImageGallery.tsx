"use client";

import { Button } from "@/components/ui";

import { useState } from "react";

import { cn } from "@/lib/utils";

import {
  downloadImageUrl,
  previewImageUrl,
  type GalleryImage,
} from "@/components/canvas/gallery-images";
import { Lightbox } from "./Lightbox";

interface ImageGalleryProps {
  generation: {
    prompt: string;
    images: GalleryImage[];
  };
  frameClassName?: string;
}

export function ImageGallery({
  generation,
  frameClassName = "h-[380px] lg:h-[620px]",
}: ImageGalleryProps) {
  const images = generation.images.filter((image) => image.src ?? image.url);
  const [index, setIndex] = useState(0);
  const [lightbox, setLightbox] = useState<number | null>(null);

  if (images.length === 0) return null;

  const current = images[Math.min(index, images.length - 1)];
  const currentUrl = previewImageUrl(current);

  return (
    <div className="flex h-full flex-col gap-3">
      <Button
        variant="ghost"
        type="button"
        className={cn(
          "relative w-full cursor-zoom-in overflow-hidden rounded-[10px] bg-surface-2 p-0",
          frameClassName,
        )}
        onClick={() => setLightbox(index)}
      >
        {currentUrl ? (
          <img
            src={currentUrl}
            alt={generation.prompt}
            className="h-full w-full object-contain"
          />
        ) : null}
        {images.length > 1 ? (
          <span className="absolute right-3 top-3 rounded-full bg-black/55 px-2.5 py-1 font-mono text-xs text-white">
            {index + 1} / {images.length}
          </span>
        ) : null}
      </Button>

      {images.length > 1 ? (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {images.map((image, imageIndex) => {
            const url = previewImageUrl(image);
            const href = downloadImageUrl(image);
            return (
              <Button
                variant="ghost"
                key={image.id ?? href ?? imageIndex}
                type="button"
                onClick={() => setIndex(imageIndex)}
                className={cn(
                  "h-16 w-16 shrink-0 overflow-hidden rounded-[8px] border p-0 transition-colors",
                  imageIndex === index
                    ? "border-accent"
                    : "border-border hover:border-border-strong",
                )}
              >
                {url ? (
                  <img
                    src={url}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                    decoding="async"
                  />
                ) : null}
              </Button>
            );
          })}
        </div>
      ) : null}

      {lightbox !== null ? (
        <Lightbox
          state={{ generation, index: lightbox }}
          onClose={() => setLightbox(null)}
          onNavigate={(next) => setLightbox(next)}
        />
      ) : null}
    </div>
  );
}
