"use client";

import { IconButton } from "@/components/ui";

import { ChevronDown, GripVertical, X } from "lucide-react";
import type { ReactNode } from "react";

import { DropdownMenu, DropdownMenuItem } from "@/components/ui";
import { cn } from "@/lib/utils";

import {
  PANEL_REGISTRY,
  panelMeta,
  type DockZone,
  type PanelType,
} from "./dock-types";

export const PANEL_DRAG_MIME = "application/x-chugao-panel";

export interface PanelDragPayload {
  panelId: string;
  fromZone: DockZone;
}

interface DockPanelProps {
  zone: DockZone;
  panelId: string;
  type: PanelType;
  onSwitchType: (type: PanelType) => void;
  onClose: () => void;
  children: ReactNode;
}

export function DockPanel({
  zone,
  panelId,
  type,
  onSwitchType,
  onClose,
  children,
}: DockPanelProps) {
  const meta = panelMeta(type);
  const Icon = meta.icon;

  const handleDragStart = (event: React.DragEvent) => {
    const payload: PanelDragPayload = { panelId, fromZone: zone };
    event.dataTransfer.setData(PANEL_DRAG_MIME, JSON.stringify(payload));
    event.dataTransfer.effectAllowed = "move";
  };

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col bg-surface">
      <header className="flex h-10 shrink-0 items-center gap-1 border-b border-border-strong px-1.5">
        <span
          draggable
          onDragStart={handleDragStart}
          title="拖拽移动栏目到其他边"
          aria-label="拖拽移动栏目"
          role="button"
          tabIndex={0}
          className="flex h-7 w-7 shrink-0 cursor-grab items-center justify-center rounded text-text-muted transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-inset active:cursor-grabbing"
        >
          <GripVertical size={14} strokeWidth={2} />
        </span>
        <Icon
          size={14}
          strokeWidth={2}
          className="shrink-0 text-text-muted"
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
          {meta.title}
        </span>

        <DropdownMenu
          className="min-w-36"
          trigger={
            <IconButton
              variant="ghost"
              size="sm"
              aria-label={`切换${meta.title}栏目内容`}
              title={`切换${meta.title}栏目内容`}
              className="shrink-0 text-text-muted hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-inset"
            >
              <ChevronDown size={14} strokeWidth={2} />
            </IconButton>
          }
        >
          {PANEL_REGISTRY.map((item) => {
            const ItemIcon = item.icon;
            return (
              <DropdownMenuItem
                key={item.type}
                onClick={() => onSwitchType(item.type)}
                className={cn(
                  "h-7 text-xs",
                  item.type === type && "bg-surface-2",
                )}
              >
                <ItemIcon size={12} className="text-text-muted" />
                {item.title}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenu>

        <IconButton
          variant="ghost"
          size="sm"
          onClick={onClose}
          aria-label={`关闭${meta.title}栏目`}
          title={`关闭${meta.title}栏目`}
          className="shrink-0 text-text-muted hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-inset"
        >
          <X size={14} strokeWidth={2} />
        </IconButton>
      </header>

      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{children}</div>
    </section>
  );
}
