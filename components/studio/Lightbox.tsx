"use client";

import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
} from "@/components/ui";

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
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          closeButtonRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const returnFocus = returnFocusRef.current;
          if (returnFocus?.isConnected) returnFocus.focus();
        }}
        className="inset-0 flex h-[100dvh] max-h-none w-full max-w-none translate-x-0 translate-y-0 flex-col overflow-hidden rounded-none border-0 bg-background p-0 text-sm tracking-normal shadow-none"
      >
        <DialogTitle className="sr-only">
          图片预览，第 {index + 1} 张，共 {images.length} 张
        </DialogTitle>

        <div className="flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] sm:px-4">
          <span className="shrink-0 text-xs tabular-nums text-text-muted">
            {index + 1} / {images.length}
          </span>
          <div className="ml-auto flex max-w-full flex-wrap items-center gap-1">
            <IconButton
              type="button"
              variant="ghost"
              aria-label={actualSize ? "适应窗口" : "查看原尺寸"}
              title={actualSize ? "适应窗口" : "查看原尺寸"}
              aria-pressed={actualSize}
              onClick={() => setActualSize((value) => !value)}
              className="h-11 w-11 rounded-md sm:h-9 sm:w-9"
            >
              {actualSize ? <Scan size={17} /> : <ZoomIn size={17} />}
            </IconButton>
            <CopyTextButton text={generation.prompt} />
            {onUseAsReference && image.id ? (
              <Button
                type="button"
                variant="secondary"
                aria-label="继续修改"
                title="继续修改"
                onClick={() => onUseAsReference(image)}
                className="h-11 w-11 gap-2 rounded-md px-0 text-sm sm:h-9 sm:w-auto sm:px-3"
              >
                <ImagePlus size={16} />
                <span className="hidden sm:inline">继续修改</span>
              </Button>
            ) : null}
            {image.id ? (
              <IconButton
                asChild
                variant="ghost"
                aria-label="发布到灵感圈"
                title="发布到灵感圈"
                onClick={(event) => event.stopPropagation()}
                className="h-11 w-11 rounded-md sm:h-9 sm:w-9"
              >
                <a
                  href={`/app/publish?imageId=${encodeURIComponent(image.id)}`}
                >
                  <Share2 size={16} aria-hidden="true" />
                </a>
              </IconButton>
            ) : null}
            <IconButton
              asChild
              variant="ghost"
              aria-label="下载"
              title="下载"
              onClick={(event) => event.stopPropagation()}
              className="h-11 w-11 rounded-md sm:h-9 sm:w-9"
            >
              <a href={image.downloadUrl ?? image.url} download>
                <Download size={16} aria-hidden="true" />
              </a>
            </IconButton>
            <Button
              ref={closeButtonRef}
              variant="ghost"
              type="button"
              aria-label="关闭"
              title="关闭"
              onClick={onClose}
              className="h-11 w-11 rounded-md p-0 sm:h-9 sm:w-9"
            >
              <X size={16} aria-hidden="true" />
            </Button>
          </div>
        </div>

        <div className="relative min-h-0 flex-1 px-14 py-4">
          <div className="flex h-full w-full overflow-auto overscroll-contain">
            {index > 0 ? (
              <IconButton
                variant="secondary"
                type="button"
                aria-label="上一张"
                title="上一张"
                onClick={(event) => {
                  event.stopPropagation();
                  onNavigate(index - 1);
                }}
                className="absolute left-2 top-1/2 h-11 w-11 -translate-y-1/2 rounded-md border-border bg-surface sm:left-3 sm:h-9 sm:w-9"
              >
                <ChevronLeft size={16} aria-hidden="true" />
              </IconButton>
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
              <IconButton
                variant="secondary"
                type="button"
                aria-label="下一张"
                title="下一张"
                onClick={(event) => {
                  event.stopPropagation();
                  onNavigate(index + 1);
                }}
                className="absolute right-2 top-1/2 h-11 w-11 -translate-y-1/2 rounded-md border-border bg-surface sm:right-3 sm:h-9 sm:w-9"
              >
                <ChevronRight size={16} aria-hidden="true" />
              </IconButton>
            ) : null}
          </div>
        </div>

        <div className="flex max-h-[30dvh] shrink-0 flex-col items-start gap-3 overflow-y-auto border-t border-border bg-surface px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex-row">
          <p className="mx-auto min-w-0 max-w-3xl flex-1 select-text whitespace-pre-wrap break-words text-sm leading-6 text-text-muted [overflow-wrap:anywhere]">
            {generation.prompt}
          </p>
          {onUsePrompt ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => onUsePrompt(generation.prompt)}
              className="h-11 shrink-0 rounded-md text-sm sm:h-9"
            >
              使用提示词
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
