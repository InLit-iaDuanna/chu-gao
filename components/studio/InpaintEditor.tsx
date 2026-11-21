"use client";

import { Brush, Eraser, Redo2, Trash2, Undo2, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui";

/** 遮罩画布长边上限：服务端会按原图尺寸重采样，没必要更大。 */
const MASK_MAX_SIDE = 2048;
const HISTORY_LIMIT = 30;
const STROKE_COLOR = "#ff2fb4";

export interface InpaintSubmission {
  /** 黑底白色涂抹区的 PNG。 */
  mask: Blob;
  prompt: string;
  width: number;
  height: number;
}

interface InpaintEditorProps {
  imageUrl: string;
  /** 费用、模型等提示（可选）。 */
  note?: string | null;
  error?: string | null;
  submitting?: boolean;
  onCancel: () => void;
  onSubmit: (submission: InpaintSubmission) => void;
}

type Tool = "brush" | "eraser";

export function InpaintEditor({
  imageUrl,
  note,
  error,
  submitting = false,
  onCancel,
  onSubmit,
}: InpaintEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const drawing = useRef<{ x: number; y: number } | null>(null);
  const undoStack = useRef<ImageData[]>([]);
  const redoStack = useRef<ImageData[]>([]);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(
    null,
  );
  const [tool, setTool] = useState<Tool>("brush");
  // 笔刷直径占图片显示宽度的比例，切换图片尺寸/窗口时保持一致手感。
  const [brushRatio, setBrushRatio] = useState(0.06);
  const [prompt, setPrompt] = useState("");
  const [painted, setPainted] = useState(false);
  const [history, setHistory] = useState({ undo: 0, redo: 0 });
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [stage, setStage] = useState<{ width: number; height: number } | null>(
    null,
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const maskSize = natural
    ? (() => {
        const scale = Math.min(
          1,
          MASK_MAX_SIDE / Math.max(natural.width, natural.height),
        );
        return {
          width: Math.max(1, Math.round(natural.width * scale)),
          height: Math.max(1, Math.round(natural.height * scale)),
        };
      })()
    : null;

  // 缓存命中时 onLoad 可能早于水合触发，补读一次尺寸。
  const attachImage = useCallback((image: HTMLImageElement | null) => {
    imageRef.current = image;
    if (image?.complete && image.naturalWidth > 0)
      setNatural({ width: image.naturalWidth, height: image.naturalHeight });
  }, []);

  // 图片按舞台可用空间等比适配，画布与图片严格同尺寸，笔触才能对齐。
  // Radix 的弹层内容在首次 effect 之后才挂载，用回调 ref 盯住舞台元素。
  const [stageElement, setStageElement] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    const element = stageElement;
    if (!element) return;
    const measure = () => {
      const style = getComputedStyle(element);
      setStage({
        width:
          element.clientWidth -
          parseFloat(style.paddingLeft) -
          parseFloat(style.paddingRight),
        height:
          element.clientHeight -
          parseFloat(style.paddingTop) -
          parseFloat(style.paddingBottom),
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [stageElement]);

  const fitted =
    natural && stage && stage.width > 0 && stage.height > 0
      ? (() => {
          const scale = Math.min(
            stage.width / natural.width,
            stage.height / natural.height,
            2,
          );
          return {
            width: Math.floor(natural.width * scale),
            height: Math.floor(natural.height * scale),
          };
        })()
      : null;
  const displayWidth = fitted?.width ?? 0;

  const context = () => canvasRef.current?.getContext("2d") ?? null;

  const refreshPainted = useCallback(() => {
    const ctx = canvasRef.current?.getContext("2d");
    const canvas = canvasRef.current;
    if (!ctx || !canvas) return;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let any = false;
    for (let i = 3; i < data.length; i += 16) {
      if (data[i] > 0) {
        any = true;
        break;
      }
    }
    setPainted(any);
  }, []);

  const snapshot = () => {
    const ctx = context();
    const canvas = canvasRef.current;
    if (!ctx || !canvas) return;
    undoStack.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    if (undoStack.current.length > HISTORY_LIMIT) undoStack.current.shift();
    redoStack.current = [];
    setHistory({ undo: undoStack.current.length, redo: 0 });
  };

  const restore = (from: ImageData[], to: ImageData[]) => {
    const ctx = context();
    const canvas = canvasRef.current;
    const previous = from.pop();
    if (!ctx || !canvas || !previous) return;
    to.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    ctx.putImageData(previous, 0, 0);
    setHistory({
      undo: undoStack.current.length,
      redo: redoStack.current.length,
    });
    refreshPainted();
  };

  const undo = () => restore(undoStack.current, redoStack.current);
  const redo = () => restore(redoStack.current, undoStack.current);

  const clear = () => {
    const ctx = context();
    const canvas = canvasRef.current;
    if (!ctx || !canvas || !painted) return;
    snapshot();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setPainted(false);
  };

  const toCanvasPoint = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
      displayX: event.clientX - rect.left,
      displayY: event.clientY - rect.top,
    };
  };

  const brushPixels = () =>
    Math.max(2, brushRatio * (canvasRef.current?.width ?? 0));

  const strokeTo = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const ctx = context();
    if (!ctx) return;
    ctx.globalCompositeOperation =
      tool === "eraser" ? "destination-out" : "source-over";
    ctx.strokeStyle = STROKE_COLOR;
    ctx.fillStyle = STROKE_COLOR;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = brushPixels();
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(to.x, to.y, brushPixels() / 2, 0, Math.PI * 2);
    ctx.fill();
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (submitting || event.button > 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    snapshot();
    const point = toCanvasPoint(event);
    drawing.current = point;
    strokeTo(point, point);
    if (tool === "brush") setPainted(true);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = toCanvasPoint(event);
    setCursor({ x: point.displayX, y: point.displayY });
    if (!drawing.current) return;
    strokeTo(drawing.current, point);
    drawing.current = point;
  };

  const endStroke = () => {
    if (!drawing.current) return;
    drawing.current = null;
    if (tool === "eraser") refreshPainted();
  };

  const submit = async () => {
    const canvas = canvasRef.current;
    const text = prompt.trim();
    if (!canvas || !painted || !text || submitting || !natural) return;
    const ctx = canvas.getContext("2d")!;
    const source = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const out = document.createElement("canvas");
    out.width = canvas.width;
    out.height = canvas.height;
    const outCtx = out.getContext("2d")!;
    const mask = outCtx.createImageData(canvas.width, canvas.height);
    for (let i = 0; i < source.data.length; i += 4) {
      const on = source.data[i + 3] >= 128 ? 255 : 0;
      mask.data[i] = on;
      mask.data[i + 1] = on;
      mask.data[i + 2] = on;
      mask.data[i + 3] = 255;
    }
    outCtx.putImageData(mask, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) =>
      out.toBlob(resolve, "image/png"),
    );
    if (!blob) return;
    onSubmit({
      mask: blob,
      prompt: text,
      width: natural.width,
      height: natural.height,
    });
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === "TEXTAREA" || target?.tagName === "INPUT") return;
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (event.key === "b") setTool("brush");
      else if (event.key === "e") setTool("eraser");
      else if (event.key === "[")
        setBrushRatio((value) => Math.max(0.01, value - 0.01));
      else if (event.key === "]")
        setBrushRatio((value) => Math.min(0.25, value + 0.01));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // undo/redo read refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cursorDiameter = brushRatio * displayWidth;
  const canSubmit = painted && prompt.trim().length > 0 && !submitting;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !submitting) onCancel();
      }}
    >
      <DialogContent
        hideClose
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          textareaRef.current?.focus({ preventScroll: true });
        }}
        className="inset-0 flex h-[100dvh] max-h-none w-full max-w-none translate-x-0 translate-y-0 flex-col overflow-hidden rounded-none border-0 bg-background p-0 text-sm tracking-normal shadow-none"
      >
        <DialogTitle className="sr-only">局部重绘</DialogTitle>

        <div className="flex min-h-14 shrink-0 items-center gap-3 border-b border-border px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] sm:px-4">
          <span className="text-sm font-medium text-foreground">局部重绘</span>
          <span className="hidden text-xs text-text-muted sm:inline">
            涂抹要修改的区域，其余部分保持原样
          </span>
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              type="button"
              aria-label="关闭"
              title="关闭"
              disabled={submitting}
              onClick={onCancel}
              className="h-11 w-11 rounded-md p-0 sm:h-9 sm:w-9"
            >
              <X size={16} aria-hidden="true" />
            </Button>
          </div>
        </div>

        <div
          ref={setStageElement}
          className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-surface px-4 py-4"
        >
          <div
            className="relative"
            style={
              fitted
                ? { width: fitted.width, height: fitted.height }
                : { visibility: "hidden" }
            }
          >
            <img
              ref={attachImage}
              src={imageUrl}
              alt="待编辑图片"
              draggable={false}
              onLoad={(event) =>
                setNatural({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                })
              }
              className={
                fitted
                  ? "block h-full w-full select-none rounded-md"
                  : "block max-h-40 max-w-40 select-none"
              }
            />
            {maskSize && fitted ? (
              <canvas
                ref={canvasRef}
                width={maskSize.width}
                height={maskSize.height}
                aria-label="涂抹区域"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endStroke}
                onPointerCancel={endStroke}
                onPointerLeave={() => {
                  setCursor(null);
                  endStroke();
                }}
                className="absolute inset-0 h-full w-full touch-none rounded-md opacity-55"
                style={{ cursor: "none" }}
              />
            ) : null}
            {cursor && cursorDiameter > 0 ? (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute rounded-full border border-white mix-blend-difference"
                style={{
                  width: cursorDiameter,
                  height: cursorDiameter,
                  left: cursor.x - cursorDiameter / 2,
                  top: cursor.y - cursorDiameter / 2,
                }}
              />
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-3 border-t border-border bg-background px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4">
          <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-1">
            <div
              role="radiogroup"
              aria-label="工具"
              className="flex items-center rounded-md border border-border p-0.5"
            >
              {(
                [
                  ["brush", "画笔 (B)", Brush],
                  ["eraser", "橡皮 (E)", Eraser],
                ] as const
              ).map(([value, label, Icon]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={tool === value}
                  aria-label={label}
                  title={label}
                  onClick={() => setTool(value)}
                  className={
                    "flex h-8 w-8 items-center justify-center rounded-[5px] transition-colors " +
                    (tool === value
                      ? "bg-foreground text-background"
                      : "text-text-muted hover:text-foreground")
                  }
                >
                  <Icon size={15} aria-hidden="true" />
                </button>
              ))}
            </div>
            <label className="ml-2 flex items-center gap-2 text-xs text-text-muted">
              <span className="hidden sm:inline">笔刷</span>
              <input
                type="range"
                min={1}
                max={25}
                step={1}
                value={Math.round(brushRatio * 100)}
                onChange={(event) =>
                  setBrushRatio(Number(event.target.value) / 100)
                }
                aria-label="笔刷大小"
                className="h-1 w-24 cursor-pointer accent-[var(--color-foreground)] sm:w-32"
              />
            </label>
            <div className="ml-auto flex items-center gap-0.5">
              {(
                [
                  ["撤销 (Ctrl+Z)", Undo2, undo, !history.undo],
                  ["重做 (Ctrl+Shift+Z)", Redo2, redo, !history.redo],
                  ["清空涂抹", Trash2, clear, !painted],
                ] as const
              ).map(([label, Icon, action, off]) => (
                <button
                  key={label}
                  type="button"
                  aria-label={label}
                  title={label}
                  disabled={off || submitting}
                  onClick={action}
                  className="flex h-9 w-9 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface hover:text-foreground disabled:pointer-events-none disabled:opacity-35"
                >
                  <Icon size={15} aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>

          <form
            className="mx-auto flex w-full max-w-3xl items-end gap-2 rounded-lg border border-border bg-surface p-2 focus-within:border-border-strong"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  void submit();
                }
              }}
              rows={2}
              maxLength={2000}
              placeholder={
                painted
                  ? "涂抹区域要改成什么？例如：换成一只白色陶瓷茶壶"
                  : "先在图上涂抹要修改的区域"
              }
              aria-label="修改说明"
              style={{ outline: "none", boxShadow: "none" }}
              className="min-h-[2.75rem] flex-1 resize-none bg-transparent px-1.5 py-1 text-sm leading-6 text-foreground outline-none placeholder:text-text-muted"
            />
            <Button
              type="submit"
              disabled={!canSubmit}
              loading={submitting}
              className="h-9 shrink-0 rounded-md px-4"
            >
              生成
            </Button>
          </form>
          {error || note ? (
            <p
              role={error ? "alert" : undefined}
              className={
                "mx-auto w-full max-w-3xl text-xs " +
                (error ? "text-danger" : "text-text-muted")
              }
            >
              {error ?? note}
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
