"use client";

import { useState } from "react";
import {
  Copy,
  Eye,
  EyeOff,
  Frame,
  ImageIcon,
  Lock,
  MessageSquare,
  Pencil,
  Trash2,
  Unlock,
  Type,
} from "lucide-react";
import { useValue, type Editor, type TLShape } from "tldraw";
import { Button, IconButton, Input, Textarea } from "@/components/ui";
import { COMMENT, type CommentShape } from "./vendor/CommentShape";

function shapeName(shape: TLShape) {
  if (typeof shape.meta.name === "string") return shape.meta.name;
  if (shape.type === "frame") return shape.props.name || "画板";
  if (shape.type === "image") return "图片";
  if (shape.type === "text") return "文字";
  if (shape.type === COMMENT)
    return (shape as CommentShape).props.text || "批注";
  const names: Record<string, string> = {
    draw: "绘图",
    doodle: "草图",
    geo: "形状",
    arrow: "箭头",
    note: "便签",
    group: "分组",
  };
  return names[shape.type] || "图层";
}

export function CanvasLayers({
  editor,
  onUsePrompt,
}: {
  editor: Editor;
  onUsePrompt: (prompt: string) => void;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const state = useValue(
    "canvas layers",
    () => ({
      shapes: editor.getCurrentPageShapesSorted().slice().reverse(),
      selected: editor.getSelectedShapeIds(),
      only: editor.getOnlySelectedShape(),
    }),
    [editor],
  );
  const selected = state.only;
  const comment =
    selected?.type === COMMENT ? (selected as CommentShape) : null;
  return (
    <div className="min-w-0">
      {selected && (
        <div className="space-y-3 border-b border-border p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-xs font-medium">
              {shapeName(selected)}
            </span>
            <div className="flex">
              <IconButton
                aria-label="复制选中图层"
                title="复制选中图层"
                onClick={() => editor.duplicateShapes(state.selected)}
              >
                <Copy size={14} />
              </IconButton>
              <IconButton
                aria-label="删除选中图层"
                title="删除选中图层"
                onClick={() => editor.deleteShapes(state.selected)}
              >
                <Trash2 size={14} />
              </IconButton>
            </div>
          </div>
          {selected.type === "frame" && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1 text-xs text-text-muted">
                  宽度
                  <Input
                    aria-label="画板宽度"
                    type="number"
                    min={1}
                    max={16384}
                    value={Math.round(selected.props.w)}
                    onChange={(e) =>
                      editor.updateShape({
                        id: selected.id,
                        type: "frame",
                        props: {
                          w: Math.min(
                            16384,
                            Math.max(1, Number(e.target.value) || 1),
                          ),
                        },
                      })
                    }
                  />
                </label>
                <label className="space-y-1 text-xs text-text-muted">
                  高度
                  <Input
                    aria-label="画板高度"
                    type="number"
                    min={1}
                    max={16384}
                    value={Math.round(selected.props.h)}
                    onChange={(e) =>
                      editor.updateShape({
                        id: selected.id,
                        type: "frame",
                        props: {
                          h: Math.min(
                            16384,
                            Math.max(1, Number(e.target.value) || 1),
                          ),
                        },
                      })
                    }
                  />
                </label>
              </div>
              <label className="flex items-center justify-between text-xs text-text-muted">
                画板背景
                <input
                  aria-label="画板背景颜色"
                  type="color"
                  value={String(
                    (selected.meta.style as { fill?: string } | undefined)
                      ?.fill || "#ffffff",
                  )}
                  onChange={(e) =>
                    editor.updateShape({
                      id: selected.id,
                      type: "frame",
                      meta: {
                        ...selected.meta,
                        style: {
                          ...((selected.meta.style as object) || {}),
                          fill: e.target.value,
                        },
                      },
                    })
                  }
                  className="h-8 w-10 cursor-pointer rounded border border-border bg-transparent"
                />
              </label>
            </>
          )}
          {comment && (
            <>
              <Textarea
                aria-label="批注内容"
                value={comment.props.text}
                maxLength={1000}
                className="min-h-24"
                onChange={(e) =>
                  editor.updateShape<CommentShape>({
                    id: comment.id,
                    type: COMMENT,
                    props: { text: e.target.value },
                  })
                }
              />
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={comment.props.done}
                  onChange={(e) =>
                    editor.updateShape<CommentShape>({
                      id: comment.id,
                      type: COMMENT,
                      props: { done: e.target.checked },
                    })
                  }
                />
                已处理
              </label>
              <Button
                size="sm"
                className="w-full"
                disabled={!comment.props.text.trim()}
                onClick={() => onUsePrompt(comment.props.text)}
              >
                用于修改提示词
              </Button>
            </>
          )}
          {typeof selected.meta.prompt === "string" && (
            <Button
              size="sm"
              className="w-full"
              onClick={() => onUsePrompt(selected.meta.prompt as string)}
            >
              沿用生成提示词
            </Button>
          )}
        </div>
      )}
      <div className="p-2" role="list" aria-label="画布图层">
        {state.shapes.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-text-muted">
            暂无图层
          </p>
        )}
        {state.shapes.map((shape) => {
          const Icon =
            shape.type === "frame"
              ? Frame
              : shape.type === "image"
                ? ImageIcon
                : shape.type === "text"
                  ? Type
                  : shape.type === COMMENT
                    ? MessageSquare
                    : Pencil;
          return (
            <div
              key={shape.id}
              role="listitem"
              className={`flex min-w-0 items-center gap-1 rounded px-1 py-1 ${state.selected.includes(shape.id) ? "bg-surface-3" : "hover:bg-surface-2"}`}
            >
              <Icon size={13} className="mx-1 shrink-0 text-text-muted" />
              {renaming === shape.id ? (
                <Input
                  aria-label="图层名称"
                  autoFocus
                  defaultValue={shapeName(shape)}
                  className="h-7 min-w-0 flex-1 text-xs"
                  maxLength={100}
                  onBlur={(e) => {
                    editor.updateShape({
                      id: shape.id,
                      type: shape.type,
                      meta: {
                        ...shape.meta,
                        name: e.target.value.trim() || shapeName(shape),
                      },
                    });
                    setRenaming(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === "Escape")
                      e.currentTarget.blur();
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate py-1.5 text-left text-xs"
                  title={shapeName(shape)}
                  onClick={(e) => {
                    if (e.shiftKey)
                      editor.setSelectedShapes([
                        ...new Set([...state.selected, shape.id]),
                      ]);
                    else editor.select(shape.id);
                  }}
                  onDoubleClick={() => setRenaming(shape.id)}
                >
                  {shapeName(shape)}
                </button>
              )}
              <IconButton
                className="h-7 w-6"
                aria-label={`${shape.meta.hidden ? "显示" : "隐藏"} ${shapeName(shape)}`}
                title={shape.meta.hidden ? "显示图层" : "隐藏图层"}
                onClick={() =>
                  editor.updateShape({
                    id: shape.id,
                    type: shape.type,
                    meta: { ...shape.meta, hidden: !shape.meta.hidden },
                  })
                }
              >
                {shape.meta.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
              </IconButton>
              <IconButton
                className="h-7 w-6"
                aria-label={`${shape.isLocked ? "解锁" : "锁定"} ${shapeName(shape)}`}
                title={shape.isLocked ? "解锁图层" : "锁定图层"}
                onClick={() =>
                  editor.updateShape({
                    id: shape.id,
                    type: shape.type,
                    isLocked: !shape.isLocked,
                  })
                }
              >
                {shape.isLocked ? <Lock size={13} /> : <Unlock size={13} />}
              </IconButton>
            </div>
          );
        })}
      </div>
    </div>
  );
}
