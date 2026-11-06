"use client";

import { Button, Dialog, DialogContent, DialogTitle } from "@/components/ui";

import {
  ChevronLeft,
  ChevronRight,
  Download,
  Share2,
  X,
  ImagePlus,
  Scan,
  ZoomIn,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CopyTextButton } from "./CopyTextButton";

export interface LightboxImage {
  id?: string;
  url?: string;
  downloadUrl?: string;
}

export interface LightboxGeneration {
  prompt: string;
  images: LightboxImage[];
}

export interface LightboxState {
  generation: LightboxGeneration;
  index: number;
}

interface LightboxProps {
  state: LightboxState;
  onClose: () => void;
  onNavigate: (index: number) => void;
  onUseAsReference?: (image: LightboxImage) => void;
  onUsePrompt?: (prompt: string) => void;
}

export function Lightbox({
  state,
  onClose,
  onNavigate,
  onUseAsReference,
  onUsePrompt,
}: LightboxProps) {
  const [actualSize, setActualSize] = useState(false);
  const { generation, index } = state;
  const images = generation.images;
  const image = images[index];
  useEffect(() => setActualSize(false), [image]);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(
    typeof document !== "undefined" &&
      document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft" && index > 0) {
        event.preventDefault();
        onNavigate(index - 1);
      }
      if (event.key === "ArrowRight" && index < images.length - 1) {
        event.preventDefault();
        onNavigate(index + 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, images.length, onNavigate]);

  if (!image) return null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        hideClose
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          closeButtonRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const returnFocus = returnFocusRef.current;
          if (returnFocus?.isConnected) returnFocus.focus();
        }}
        className="inset-0 flex h-[100dvh] w-full max-w-none translate-x-0 translate-y-0 animate-[fadeIn_180ms_ease-out] flex-col overflow-hidden rounded-none border-0 bg-background/95 p-0 shadow-none backdrop-blur-sm"
      >
        <DialogTitle className="sr-only">
          图片预览，第 {index + 1} 张，共 {images.length} 张
        </DialogTitle>

        <div className="flex h-12 shrink-0 items-center justify-between px-4">
          <span className="text-xs text-text-muted">
            {index + 1} / {images.length}
          </span>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              aria-label={actualSize ? "适应窗口" : "查看原尺寸"}
              title={actualSize ? "适应窗口" : "查看原尺寸"}
              aria-pressed={actualSize}
              onClick={() => setActualSize((value) => !value)}
              className="h-11 w-11 p-0 text-foreground"
            >
              {actualSize ? <Scan size={17} /> : <ZoomIn size={17} />}
            </Button>
            <CopyTextButton text={generation.prompt} />
            {onUseAsReference && image.id ? (
              <Button
                type="button"
                variant="secondary"
                aria-label="继续修改"
                title="继续修改"
                onClick={() => onUseAsReference(image)}
                className="h-11 gap-1.5 px-2 text-xs"
              >
                <ImagePlus size={16} />
                <span className="hidden sm:inline">继续修改</span>
              </Button>
            ) : null}
            {image.id ? (
              <a
                href={`/app/publish?imageId=${encodeURIComponent(image.id)}`}
                aria-label="发布到灵感圈"
                title="发布到灵感圈"
                onClick={(event) => event.stopPropagation()}
                className="flex h-8 w-8 items-center justify-center rounded-md p-0 text-text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
              >
                <Share2 size={15} aria-hidden="true" />
              </a>
            ) : null}
            <a
              href={image.downloadUrl ?? image.url}
              download
              aria-label="下载"
              onClick={(event) => event.stopPropagation()}
              className="flex h-8 w-8 items-center justify-center rounded-md p-0 text-text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              <Download size={15} aria-hidden="true" />
            </a>
            <Button
              ref={closeButtonRef}
              variant="ghost"
              type="button"
              aria-label="关闭"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-md p-0 text-text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              <X size={16} aria-hidden="true" />
            </Button>
          </div>
        </div>

        <div className="relative min-h-0 flex-1 px-10 pb-4 sm:px-14">
          <div className="flex h-full w-full overflow-auto">
            {index > 0 ? (
              <Button
                variant="ghost"
                type="button"
                aria-label="上一张"
                onClick={(event) => {
                  event.stopPropagation();
                  onNavigate(index - 1);
                }}
                className="pressable absolute left-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-md border border-border bg-surface p-0 text-text-muted transition-colors hover:border-border-strong hover:text-foreground md:left-4 md:h-9 md:w-9"
              >
                <ChevronLeft size={16} aria-hidden="true" />
              </Button>
            ) : null}

            <img
              key={index}
              src={image.url ?? image.downloadUrl}
              alt={generation.prompt}
              onClick={(event) => event.stopPropagation()}
              className={
                actualSize
                  ? "m-auto max-w-none shrink-0"
                  : "m-auto max-h-full max-w-full rounded-md object-contain"
              }
            />

            {index < images.length - 1 ? (
              <Button
                variant="ghost"
                type="button"
                aria-label="下一张"
                onClick={(event) => {
                  event.stopPropagation();
                  onNavigate(index + 1);
                }}
                className="pressable absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-md border border-border bg-surface p-0 text-text-muted transition-colors hover:border-border-strong hover:text-foreground md:right-4 md:h-9 md:w-9"
              >
                <ChevronRight size={16} aria-hidden="true" />
              </Button>
            ) : null}
          </div>
        </div>

        <div className="flex max-h-[25dvh] shrink-0 items-start gap-3 overflow-y-auto border-t border-border px-4 py-3">
          <p className="mx-auto min-w-0 max-w-3xl flex-1 select-text whitespace-pre-wrap break-words text-sm leading-6 text-text-muted">
            {generation.prompt}
          </p>
          {onUsePrompt ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => onUsePrompt(generation.prompt)}
              className="h-10 shrink-0 text-xs"
            >
              使用提示词
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
