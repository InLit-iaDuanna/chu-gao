"use client";

import { type PointerEvent as ReactPointerEvent } from "react";
import { Copy, StickyNote, Trash2 } from "lucide-react";

import type {
  CanvasImageNode,
  CanvasNode,
  CanvasTextNode,
} from "@/components/workbench/infinite-canvas-model";
import { cn } from "@/lib/utils";

export function CanvasIconButton({
  label,
  onClick,
  disabled = false,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-2 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-text-muted"
    >
      {children}
    </button>
  );
}

export function CanvasNodeView({
  node,
  selected,
  onPointerDown,
  onResizePointerDown,
  onDelete,
  onDuplicate,
  onTextChange,
}: {
  node: CanvasNode;
  selected: boolean;
  onPointerDown: (
    event: ReactPointerEvent<HTMLDivElement>,
    node: CanvasNode,
  ) => void;
  onResizePointerDown: (
    event: ReactPointerEvent<HTMLButtonElement>,
    node: CanvasNode,
  ) => void;
  onDelete: (node: CanvasNode) => void;
  onDuplicate: (node: CanvasNode) => void;
  onTextChange: (nodeId: string, text: string) => void;
}): React.ReactElement {
  return (
    <div
      data-canvas-node
      className={cn(
        "absolute overflow-hidden rounded-[14px] border bg-surface shadow-[var(--shadow-md)] transition-[box-shadow,border-color] duration-200",
        selected
          ? "border-brand shadow-[0_0_0_1px_rgb(var(--brand-primary)),var(--shadow-md)]"
          : "border-ink/[0.09] hover:border-ink/[0.25]",
      )}
      style={{
        left: node.x,
        top: node.y,
        width: node.width,
        height: node.height,
        zIndex: node.z,
      }}
      onPointerDown={(event) => onPointerDown(event, node)}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {node.type === "image" ? (
        <ImageCanvasNode
          node={node}
          onDelete={onDelete}
          onDuplicate={onDuplicate}
        />
      ) : (
        <TextCanvasNode
          node={node}
          onDelete={onDelete}
          onDuplicate={onDuplicate}
          onTextChange={onTextChange}
        />
      )}
      {selected ? (
        <button
          type="button"
          className="absolute bottom-1.5 right-1.5 h-4 w-4 cursor-nwse-resize rounded-[3px] bg-brand transition-transform hover:scale-110"
          aria-label="调整节点大小"
          title="拖拽调整大小"
          onPointerDown={(event) => onResizePointerDown(event, node)}
        />
      ) : null}
    </div>
  );
}

function ImageCanvasNode({
  node,
  onDelete,
  onDuplicate,
}: {
  node: CanvasImageNode;
  onDelete: (node: CanvasNode) => void;
  onDuplicate: (node: CanvasNode) => void;
}): React.ReactElement {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border bg-surface-2 px-2">
        <p className="min-w-0 truncate text-[11.5px] font-medium text-text-muted">
          {node.prompt || "生成图"}
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded-md text-text-faint transition-colors hover:bg-surface hover:text-foreground"
            aria-label="复制图片节点"
            title="复制"
            onClick={() => onDuplicate(node)}
          >
            <Copy size={12} strokeWidth={1.5} />
          </button>
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded-md text-text-faint transition-colors hover:bg-surface hover:text-foreground"
            aria-label="删除图片节点"
            title="删除"
            onClick={() => onDelete(node)}
          >
            <Trash2 size={12} strokeWidth={1.5} />
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center bg-background">
        <img
          src={node.thumbnailUrl ?? node.src}
          alt={node.prompt || "画布图片"}
          className="h-full w-full object-contain"
          draggable={false}
          decoding="async"
        />
      </div>
    </div>
  );
}

function TextCanvasNode({
  node,
  onDelete,
  onDuplicate,
  onTextChange,
}: {
  node: CanvasTextNode;
  onDelete: (node: CanvasNode) => void;
  onDuplicate: (node: CanvasNode) => void;
  onTextChange: (nodeId: string, text: string) => void;
}): React.ReactElement {
  return (
    <div className="flex h-full flex-col bg-warning/[0.08]">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-warning/20 px-2 text-warning">
        <div className="flex items-center gap-1.5">
          <StickyNote size={12} strokeWidth={1.5} />
          <span className="text-[11.5px] font-medium text-foreground">
            批注
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded-md text-text-faint transition-colors hover:bg-surface hover:text-foreground"
            aria-label="复制批注"
            title="复制"
            onClick={() => onDuplicate(node)}
          >
            <Copy size={12} strokeWidth={1.5} />
          </button>
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded-md text-text-faint transition-colors hover:bg-surface hover:text-foreground"
            aria-label="删除批注"
            title="删除"
            onClick={() => onDelete(node)}
          >
            <Trash2 size={12} strokeWidth={1.5} />
          </button>
        </div>
      </div>
      <textarea
        value={node.text}
        onChange={(event) => onTextChange(node.id, event.target.value)}
        onPointerDown={(event) => event.stopPropagation()}
        className="min-h-0 flex-1 resize-none bg-transparent px-3 py-2 text-[13px] leading-relaxed text-foreground outline-none placeholder:text-text-faint"
        aria-label="批注内容"
        maxLength={800}
      />
    </div>
  );
}
