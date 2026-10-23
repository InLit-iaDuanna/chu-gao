"use client";

import { useRef, useState, type ReactNode } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { IconButton } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { ReferenceItem } from "./CommandDock";
import { parseReferenceDrag, REFERENCE_DRAG_MIME } from "./lib/reference-input";

export function ReferenceDropZone({
  children,
  onFile,
  onReference,
  className,
  disabled = false,
}: {
  children: ReactNode;
  onFile: (file: File) => void;
  onReference: (reference: ReferenceItem) => void;
  className?: string;
  disabled?: boolean;
}) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const accepts = (transfer: DataTransfer) =>
    Array.from(transfer.types).some(
      (type) => type === "Files" || type === REFERENCE_DRAG_MIME,
    );
  return (
    <div
      className={cn("relative", className)}
      onDragEnter={(event) => {
        if (!accepts(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
        depth.current += 1;
        setOver(true);
      }}
      onDragOver={(event) => {
        if (!accepts(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = disabled ? "none" : "copy";
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        depth.current = Math.max(0, depth.current - 1);
        if (!depth.current) setOver(false);
      }}
      onDrop={(event) => {
        if (!accepts(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
        depth.current = 0;
        setOver(false);
        if (disabled) return;
        const reference = parseReferenceDrag(
          event.dataTransfer.getData(REFERENCE_DRAG_MIME),
        );
        if (reference) onReference(reference);
        else Array.from(event.dataTransfer.files).forEach((file) => onFile(file));
      }}
      onPaste={(event) => {
        const files = Array.from(event.clipboardData.items)
          .filter((item) => item.kind === "file")
          .map((item) => item.getAsFile())
          .filter((file): file is File => file !== null);
        if (!files.length) return;
        if (!event.clipboardData.getData("text/plain")) event.preventDefault();
        if (!disabled) files.forEach((file) => onFile(file));
      }}
    >
      {children}
      {over ? (
        <div
          role="status"
          className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-brand bg-surface/95 p-4 text-sm text-foreground"
        >
          <ImagePlus size={20} />
          {disabled ? "当前暂不能添加参考图" : "松开添加参考图"}
        </div>
      ) : null}
    </div>
  );
}

export function ReferenceThumbnails({
  references,
  uploading = 0,
  onRemove,
}: {
  references: ReferenceItem[];
  uploading?: number;
  onRemove: (key: string) => void;
}) {
  if (!references.length && !uploading) return null;
  return (
    <div
      className="flex max-h-40 flex-wrap gap-2 overflow-y-auto p-3 pb-1"
      aria-label="已添加参考图"
    >
      {references.map((item, index) => (
        <div
          key={`${item.kind}:${item.key}`}
          className="relative h-16 w-16 shrink-0 rounded-md border border-border-strong bg-surface-2"
        >
          <img
            src={item.previewUrl}
            alt={`参考图 ${index + 1}`}
            className="h-full w-full rounded-md object-contain"
          />
          <span
            aria-hidden="true"
            className="absolute bottom-0.5 left-0.5 rounded bg-black/60 px-1 py-px text-[9px] font-semibold leading-none text-white"
          >
            {index + 1}
          </span>
          <IconButton
            type="button"
            variant="secondary"
            aria-label={`移除参考图 ${index + 1}`}
            title="移除参考图"
            onClick={() => onRemove(item.key)}
            className="absolute -right-1 -top-1 h-7 w-7 border border-border-strong bg-surface p-0 text-foreground"
          >
            <X size={14} />
          </IconButton>
        </div>
      ))}
      {uploading > 0 ? (
        <div
          role="status"
          className="flex h-16 min-w-16 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border-strong px-2 text-xs text-text-muted"
        >
          <Loader2 size={16} className="animate-spin" />
          上传中 {uploading}
        </div>
      ) : null}
    </div>
  );
}
