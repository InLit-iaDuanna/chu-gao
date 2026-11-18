"use client";

import { useState, type ComponentProps } from "react";
import {
  Check,
  CircleAlert,
  Hand,
  LayoutGrid,
  ListTree,
  LoaderCircle,
  Maximize2,
  Minus,
  MoreHorizontal,
  MousePointer2,
  Pencil,
  Play,
  Plus,
  Redo2,
  Share2,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
  IconButton,
  Input,
  Tooltip,
  TooltipProvider,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  NODE_META,
  type GraphNode,
  type NodeKind,
  type NodeRunState,
} from "./node-graph-types";

export type CanvasTool = "select" | "hand";
export interface CanvasTab {
  id: string;
  name: string;
}

export function CanvasToolButton({
  label,
  children,
  className,
  ...props
}: ComponentProps<typeof IconButton> & { label: string }) {
  return (
    <Tooltip content={label}>
      <IconButton
        variant="ghost"
        aria-label={label}
        title={label}
        className={cn("h-9 w-9 shrink-0 rounded-md text-text-muted", className)}
        {...props}
      >
        {children}
      </IconButton>
    </Tooltip>
  );
}

export function NodeWorkspaceToolbar({
  tabs,
  activeId,
  onSelectTab,
  onCreateTab,
  onCloseTab,
  onRenameTab,
  tool,
  onToolChange,
  onAdd,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onArrange,
  onPublish,
  onClear,
  onRun,
  readyCount,
  runningCount,
  saveState,
  panelOpen,
  onTogglePanel,
}: {
  tabs: CanvasTab[];
  activeId: string;
  onSelectTab: (id: string) => void;
  onCreateTab: () => void;
  onCloseTab: (id: string) => void;
  onRenameTab: (id: string, name: string) => void;
  tool: CanvasTool;
  onToolChange: (tool: CanvasTool) => void;
  onAdd: (kind: NodeKind) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onArrange: () => void;
  onPublish: () => void;
  onClear: () => void;
  onRun: () => void;
  readyCount: number;
  runningCount: number;
  saveState: "saved" | "saving" | "error";
  panelOpen: boolean;
  onTogglePanel: () => void;
}) {
  const [rename, setRename] = useState<CanvasTab | null>(null);
  const active = tabs.find((tab) => tab.id === activeId);
  const status =
    saveState === "error"
      ? "本地保存失败"
      : saveState === "saving"
        ? "保存中"
        : "已保存到此浏览器";
  return (
    <TooltipProvider delayDuration={250}>
      <header className="contents">
        <div className="absolute left-3 top-3 z-40 flex min-w-0 max-w-[calc(100%-24px)] items-center gap-1 rounded-lg border border-border bg-surface/95 px-1 shadow-md backdrop-blur-md">
          <div
            role="tablist"
            aria-label="节点画布"
            className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
          >
            {tabs.map((tab) => (
              <div
                key={tab.id}
                role="presentation"
                className={cn(
                  "flex h-11 shrink-0 items-center border-b-2",
                  tab.id === activeId
                    ? "border-brand bg-brand/5"
                    : "border-transparent",
                )}
              >
                <button
                  role="tab"
                  aria-selected={tab.id === activeId}
                  tabIndex={tab.id === activeId ? 0 : -1}
                  onClick={() => onSelectTab(tab.id)}
                  onDoubleClick={() => setRename(tab)}
                  onKeyDown={(event) => {
                    const direction =
                      event.key === "ArrowRight"
                        ? 1
                        : event.key === "ArrowLeft"
                          ? -1
                          : 0;
                    if (
                      !direction &&
                      event.key !== "Home" &&
                      event.key !== "End"
                    )
                      return;
                    event.preventDefault();
                    const index =
                      event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? tabs.length - 1
                          : (tabs.findIndex((item) => item.id === tab.id) +
                              direction +
                              tabs.length) %
                            tabs.length;
                    onSelectTab(tabs[index].id);
                    const buttons = event.currentTarget
                      .closest('[role="tablist"]')
                      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
                    buttons?.[index]?.focus();
                  }}
                  className="h-full max-w-40 truncate px-3 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
                >
                  {tab.name}
                </button>
                {tab.id !== "main" && (
                  <CanvasToolButton
                    label={`关闭${tab.name}`}
                    onClick={() => onCloseTab(tab.id)}
                    className="mr-1 h-7 w-7"
                  >
                    <X size={13} />
                  </CanvasToolButton>
                )}
              </div>
            ))}
            <CanvasToolButton label="新建画布" onClick={onCreateTab}>
              <Plus size={16} />
            </CanvasToolButton>
          </div>
          <span
            role="status"
            title={status}
            className={cn(
              "flex shrink-0 items-center gap-1.5 px-2 text-xs",
              saveState === "error" ? "text-danger" : "text-text-muted",
            )}
          >
            {saveState === "error" ? (
              <CircleAlert size={14} />
            ) : saveState === "saving" ? (
              <LoaderCircle size={14} className="animate-spin" />
            ) : (
              <Check size={14} />
            )}
            <span className="hidden lg:inline">{status}</span>
            <span className="sr-only lg:hidden">{status}</span>
          </span>
          <DropdownMenu
            trigger={
              <IconButton
                variant="ghost"
                aria-label="画布操作"
                title="画布操作"
                className="h-9 w-9"
              >
                <MoreHorizontal size={18} />
              </IconButton>
            }
          >
            <DropdownMenuItem onClick={() => active && setRename(active)}>
              <Pencil size={15} />
              重命名画布
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onPublish}>
              <Share2 size={15} />
              发布到灵感圈
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onArrange} className="sm:hidden">
              <LayoutGrid size={15} />
              自动整理
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onClear} className="text-danger">
              <Trash2 size={15} />
              清空画布
            </DropdownMenuItem>
          </DropdownMenu>
        </div>
        <div className="absolute bottom-14 left-3 z-40 flex h-12 min-w-0 max-w-[calc(100%-24px)] items-center gap-1 rounded-lg border border-border bg-surface/95 px-1 shadow-md backdrop-blur-md sm:gap-2">
          <div
            role="toolbar"
            aria-label="画布编辑工具"
            className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
          >
            <div
              role="group"
              aria-label="画布工具"
              className="flex shrink-0 gap-0.5 rounded-md bg-surface-2 p-0.5"
            >
              <CanvasToolButton
                label="选择工具"
                aria-pressed={tool === "select"}
                onClick={() => onToolChange("select")}
                className={cn(
                  "h-8 w-8",
                  tool === "select" && "bg-surface text-brand shadow-sm",
                )}
              >
                <MousePointer2 size={16} />
              </CanvasToolButton>
              <CanvasToolButton
                label="平移工具"
                aria-pressed={tool === "hand"}
                onClick={() => onToolChange("hand")}
                className={cn(
                  "h-8 w-8",
                  tool === "hand" && "bg-surface text-brand shadow-sm",
                )}
              >
                <Hand size={16} />
              </CanvasToolButton>
            </div>
            <span
              aria-hidden
              className="mx-1 hidden h-5 w-px shrink-0 bg-border sm:block"
            />
            <DropdownMenu
              trigger={
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label="添加节点"
                  title="添加节点"
                  className="h-9 w-9 shrink-0 gap-1.5 px-0 sm:w-auto sm:px-3"
                >
                  <Plus size={15} />
                  <span className="hidden sm:inline">添加节点</span>
                </Button>
              }
            >
              {(
                [
                  "prompt",
                  "reference",
                  "generate",
                  "style",
                  "note",
                  "model",
                  "quality",
                  "frame",
                  "text",
                  "shape",
                  "design-image",
                ] as NodeKind[]
              ).map((kind) => {
                const { icon: Icon, label } = NODE_META[kind];
                return (
                  <DropdownMenuItem
                    key={kind}
                    onClick={() => onAdd(kind)}
                    className="h-9"
                  >
                    <Icon size={15} />
                    {label}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenu>
            <CanvasToolButton label="撤销" disabled={!canUndo} onClick={onUndo}>
              <Undo2 size={16} />
            </CanvasToolButton>
            <CanvasToolButton label="重做" disabled={!canRedo} onClick={onRedo}>
              <Redo2 size={16} />
            </CanvasToolButton>
            <CanvasToolButton
              label="自动整理"
              onClick={onArrange}
              className="hidden sm:inline-flex"
            >
              <LayoutGrid size={16} />
            </CanvasToolButton>
          </div>
          <CanvasToolButton
            label="工作流概览"
            aria-pressed={panelOpen}
            onClick={onTogglePanel}
            className={cn(panelOpen && "bg-surface-2 text-foreground")}
          >
            <ListTree size={17} />
          </CanvasToolButton>
          <Button
            variant="primary"
            size="sm"
            onClick={onRun}
            aria-label="运行全部"
            disabled={readyCount === 0}
            title={`运行 ${readyCount} 个已就绪节点`}
            className="h-9 w-9 shrink-0 gap-1.5 px-0 sm:w-auto sm:px-3"
          >
            {runningCount ? (
              <LoaderCircle size={14} className="animate-spin" />
            ) : (
              <Play size={14} />
            )}
            <span className="hidden sm:inline">运行全部</span>
            <span className="hidden tabular-nums opacity-75 sm:inline">
              {readyCount}
            </span>
          </Button>
        </div>
      </header>
      <Dialog
        open={rename !== null}
        onOpenChange={(open) => !open && setRename(null)}
      >
        <DialogContent
          aria-describedby={undefined}
          className="studio-workspace p-5"
        >
          <DialogTitle className="mb-4 tracking-normal">重命名画布</DialogTitle>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!rename?.name.trim()) return;
              onRenameTab(rename.id, rename.name.trim());
              setRename(null);
            }}
          >
            <Input
              aria-label="画布名称"
              autoFocus
              maxLength={60}
              value={rename?.name ?? ""}
              onChange={(event) =>
                setRename(
                  (current) =>
                    current && { ...current, name: event.target.value },
                )
              }
            />
            <div className="mt-5 flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setRename(null)}
              >
                取消
              </Button>
              <Button type="submit" disabled={!rename?.name.trim()}>
                保存
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}

export function NodeCanvasStatus({
  nodeCount,
  edgeCount,
  zoom,
  onZoom,
  onFit,
  onReset,
}: {
  nodeCount: number;
  edgeCount: number;
  zoom: number;
  onZoom: (factor: number) => void;
  onFit: () => void;
  onReset: () => void;
}) {
  return (
    <TooltipProvider delayDuration={250}>
      <footer className="absolute bottom-3 right-3 z-40 flex h-9 items-center justify-between gap-3 rounded-md border border-border bg-surface/95 px-2 text-xs text-text-muted shadow-sm backdrop-blur-md">
        <span className="tabular-nums">
          {nodeCount} 节点 <span className="mx-1 text-text-faint">/</span>{" "}
          {edgeCount} 连线
        </span>
        <div className="flex items-center gap-0.5">
          <CanvasToolButton
            label="缩小"
            onClick={() => onZoom(1 / 1.15)}
            className="h-8 w-8"
          >
            <Minus size={14} />
          </CanvasToolButton>
          <button
            title="重置为 100%"
            onClick={onReset}
            className="h-8 w-12 rounded text-xs tabular-nums hover:bg-surface-2"
          >
            {Math.round(zoom * 100)}%
          </button>
          <CanvasToolButton
            label="放大"
            onClick={() => onZoom(1.15)}
            className="h-8 w-8"
          >
            <Plus size={14} />
          </CanvasToolButton>
          <span className="mx-1 h-4 w-px bg-border" />
          <CanvasToolButton
            label="适配全部节点"
            onClick={onFit}
            className="h-8 w-8"
          >
            <Maximize2 size={15} />
          </CanvasToolButton>
        </div>
      </footer>
    </TooltipProvider>
  );
}

export function NodeOverview({
  nodes,
  runs,
  hints,
  selectedIds,
  onFocus,
  onClose,
}: {
  nodes: GraphNode[];
  runs: Record<string, NodeRunState>;
  hints: Record<string, string | null>;
  selectedIds: string[];
  onFocus: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <aside
      aria-label="工作流概览"
      className="absolute bottom-14 right-3 top-3 z-40 flex w-64 max-w-[85%] shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-surface/95 shadow-lg backdrop-blur-md"
    >
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <h2 className="text-sm font-medium">工作流</h2>
        <IconButton
          variant="ghost"
          aria-label="关闭工作流概览"
          onClick={onClose}
          className="h-8 w-8"
        >
          <X size={15} />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {nodes.length === 0 && (
          <p className="px-2 py-6 text-sm text-text-muted">暂无节点</p>
        )}
        {nodes.map((node, index) => {
          const { icon: Icon, label } = NODE_META[node.kind];
          const run = runs[node.id];
          const hint = hints[node.id];
          const detail =
            node.kind === "generate"
              ? run?.status === "running"
                ? `生成中 ${run.progress ?? 0}%`
                : run?.status === "failed"
                  ? run.error || "生成失败"
                  : hint || (run?.status === "succeeded" ? "已完成" : "已就绪")
              : "text" in node.data
                ? node.data.text || "未填写"
                : node.kind === "reference"
                  ? node.data.key
                    ? "已添加参考图"
                    : "未添加参考图"
                  : "";
          return (
            <button
              key={node.id}
              onClick={() => onFocus(node.id)}
              aria-pressed={selectedIds.includes(node.id)}
              className={cn(
                "mb-1 flex w-full gap-2.5 rounded-md px-2 py-3 text-left hover:bg-surface-2 focus-visible:outline-brand",
                selectedIds.includes(node.id) && "bg-brand/10",
              )}
            >
              <Icon
                size={16}
                className={cn(
                  "mt-0.5 shrink-0",
                  node.kind === "generate" ? "text-brand" : "text-text-muted",
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="flex justify-between text-xs font-medium">
                  {label}
                  <span className="text-text-faint tabular-nums">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                </span>
                {detail && (
                  <span
                    className={cn(
                      "mt-1 block truncate text-xs",
                      node.kind === "generate" &&
                        (hint || run?.status === "failed")
                        ? "text-warning"
                        : "text-text-muted",
                    )}
                  >
                    {detail}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
