"use client";

import { Button } from "@/components/ui";

import { Textarea } from "@/components/ui";

import { type PointerEvent as ReactPointerEvent } from "react";
import { Copy, StickyNote, Trash2 } from "lucide-react";

import type {
  CanvasImageNode,
  CanvasNode,
  CanvasTextNode,
} from "./infinite-canvas-model";
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
    <Button
      variant="ghost"
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-2 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-text-muted"
    >
      {children}
    </Button>
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
  onConnectStart,
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
  onConnectStart: (
    event: ReactPointerEvent<HTMLButtonElement>,
    node: CanvasNode,
  ) => void;
}): React.ReactElement {
  return (
    <div
      data-canvas-node
      className={cn(
        "absolute overflow-visible rounded-xl border bg-surface shadow-[var(--shadow-md)] transition-shadow",
        selected
          ? "border-foreground shadow-[var(--shadow-ring-strong)]"
          : "border-border hover:border-border-strong",
      )}
      style={{
        left: node.x,
        top: node.y,
        width: node.width,
        height: node.height,
        zIndex: node.z,
      }}
      data-node-id={node.id}
      onPointerDown={(event) => onPointerDown(event, node)}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <div className="h-full overflow-hidden rounded-[11px]">
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
      </div>
      <Button
        variant="ghost"
        type="button"
        aria-label={
          "从" + (node.type === "image" ? "图片" : "批注") + "节点输出"
        }
        title="拖拽连接到下一个节点"
        className="absolute right-[-6px] top-1/2 z-10 h-3 w-3 -translate-y-1/2 rounded-full border-2 border-surface bg-brand shadow-[0_0_0_1px_rgb(var(--brand-primary)/0.35)] transition-transform hover:scale-125"
        onPointerDown={(event) => onConnectStart(event, node)}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-[-5px] top-1/2 z-10 h-2.5 w-2.5 -translate-y-1/2 rounded-full border border-border-strong bg-surface"
      />
      {selected ? (
        <Button
          variant="ghost"
          type="button"
          className="absolute bottom-1.5 right-1.5 h-4 w-4 cursor-nwse-resize rounded-[4px] border border-foreground/30 bg-background/90 shadow-[var(--shadow-xs)] transition-transform hover:scale-110"
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
          <Button
            variant="ghost"
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded-md text-text-faint transition-colors hover:bg-surface hover:text-foreground"
            aria-label="复制图片节点"
            title="复制"
            onClick={() => onDuplicate(node)}
          >
            <Copy size={12} strokeWidth={1.5} />
          </Button>
          <Button
            variant="ghost"
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded-md text-text-faint transition-colors hover:bg-surface hover:text-foreground"
            aria-label="删除图片节点"
            title="删除"
            onClick={() => onDelete(node)}
          >
            <Trash2 size={12} strokeWidth={1.5} />
          </Button>
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
          <Button
            variant="ghost"
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded-md text-text-faint transition-colors hover:bg-surface hover:text-foreground"
            aria-label="复制批注"
            title="复制"
            onClick={() => onDuplicate(node)}
          >
            <Copy size={12} strokeWidth={1.5} />
          </Button>
          <Button
            variant="ghost"
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded-md text-text-faint transition-colors hover:bg-surface hover:text-foreground"
            aria-label="删除批注"
            title="删除"
            onClick={() => onDelete(node)}
          >
            <Trash2 size={12} strokeWidth={1.5} />
          </Button>
        </div>
      </div>
      <Textarea
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
