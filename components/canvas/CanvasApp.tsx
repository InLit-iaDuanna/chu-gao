"use client";

import { Button } from "@/components/ui";

import { useEffect, useMemo, useState } from "react";
import { ImageOff } from "lucide-react";

import { cn } from "@/lib/utils";

import { getMe, listGenerations } from "@/components/studio/lib/api";
import type { Generation } from "@/components/studio/lib/types";
import { previewImageUrl, type GalleryImage } from "./gallery-images";
import { InfiniteCanvas } from "./InfiniteCanvas";

export function CanvasApp() {
  const [accountId, setAccountId] = useState<string | null>(null);
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<{
    generation: Generation;
    image: GalleryImage;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    void Promise.all([getMe(), listGenerations({ limit: 60 })])
      .then(([me, page]) => {
        if (cancelled) return;
        setAccountId(me.id);
        setGenerations(
          page.items.filter((generation) =>
            generation.images.some((image) => image.src ?? image.url),
          ),
        );
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const imageEntries = useMemo(
    () =>
      generations.flatMap((generation) =>
        generation.images
          .filter((image) => image.src ?? image.url)
          .map((image) => ({ generation, image })),
      ),
    [generations],
  );

  return (
    <div className="flex h-full">
      <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-background">
        <div className="border-b border-border px-4 py-3">
          <p className="eyebrow">Canvas</p>
          <h1 className="mt-1 text-sm font-medium">素材库</h1>
          <p className="mt-1 text-xs leading-5 text-text-muted">
            点击历史图片添加到画布，拖动排版、缩放、备注。
          </p>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="grid grid-cols-2 gap-2">
              {Array.from({ length: 6 }).map((_, index) => (
                <div
                  key={index}
                  className="aspect-square animate-pulse rounded-[8px] bg-surface-2"
                />
              ))}
            </div>
          ) : imageEntries.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-text-faint">
              <ImageOff className="h-6 w-6 stroke-[1.5]" />
              <p className="text-xs leading-5">
                还没有可用图片
                <br />
                先去工作台生成
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {imageEntries.map(({ generation, image }) => {
                const url = previewImageUrl(image);
                const isActive =
                  active?.image.id === image.id &&
                  active?.generation.id === generation.id;

                return (
                  <Button
                    variant="ghost"
                    key={image.id ?? `${generation.id}-${url}`}
                    type="button"
                    onClick={() => setActive({ generation, image })}
                    className={cn(
                      "group relative aspect-square overflow-hidden rounded-[8px] border transition-colors",
                      isActive
                        ? "border-accent"
                        : "border-transparent hover:border-border-strong",
                    )}
                  >
                    {url ? (
                      <img
                        src={url}
                        alt={generation.prompt}
                        className="h-full w-full object-cover"
                        loading="lazy"
                        decoding="async"
                      />
                    ) : null}
                  </Button>
                );
              })}
            </div>
          )}
        </div>
      </aside>

      <div className="relative min-w-0 flex-1">
        <InfiniteCanvas
          accountId={accountId}
          conversationId={null}
          generations={generations}
          activeGeneration={active?.generation ?? null}
          activeImage={active?.image ?? null}
          className="h-full"
        />
      </div>
    </div>
  );
}
