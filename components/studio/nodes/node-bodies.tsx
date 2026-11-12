"use client";

import { Button } from "@/components/ui";

import { Input, Select, Textarea } from "@/components/ui";

import {
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  ImagePlus,
  Loader2,
  PanelsTopLeft,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

import { sizeLabel } from "../CommandDock";
import { QualitySlider, qualityLabel } from "../QualitySlider";
import type { Generation, ModelInfo } from "../lib/types";
import { resolveGenerationOptions } from "../lib/generation-options";
import {
  INPUT_PORTS,
  PORT_LABEL,
  type GraphEdge,
  type GraphNode,
  type NodeRunState,
} from "./node-graph-types";

// ─── 提示词节点 ───

export function PromptNodeBody({
  node,
  onUpdate,
}: {
  node: Extract<GraphNode, { kind: "prompt" }>;
  onUpdate: (patch: Record<string, unknown>) => void;
}) {
  return (
    <div className="p-2">
      <Textarea
        data-node-scrollable
        value={node.data.text}
        rows={4}
        maxLength={4000}
        placeholder="描述画面…"
        onChange={(event) => onUpdate({ text: event.target.value })}
        className="w-full resize-none rounded-md border border-border bg-background p-2 text-xs leading-5 text-foreground outline-none placeholder:text-text-faint focus:border-border-strong"
      />
    </div>
  );
}

const STYLE_PRESETS = [
  {
    value: "cinematic",
    label: "电影感",
    text: "电影感构图，层次丰富的光影，细腻质感",
  },
  {
    value: "photo",
    label: "摄影写实",
    text: "专业摄影，真实材质，自然光，高动态范围",
  },
  {
    value: "illustration",
    label: "商业插画",
    text: "精致商业插画，清晰轮廓，协调配色，丰富细节",
  },
  {
    value: "poster",
    label: "极简海报",
    text: "极简海报设计，明确视觉焦点，大面积留白，现代排版",
  },
  {
    value: "render",
    label: "3D 渲染",
    text: "高质量 3D 渲染，真实材质，柔和棚拍灯光，精细建模",
  },
  {
    value: "watercolor",
    label: "水彩",
    text: "细腻水彩画，纸张纹理，自然晕染，轻盈色彩",
  },
];

export function StyleNodeBody({
  node,
  onUpdate,
}: {
  node: Extract<GraphNode, { kind: "style" }>;
  onUpdate: (patch: Record<string, unknown>) => void;
}) {
  return (
    <div className="space-y-1.5 p-2">
      <Select
        aria-label="风格预设"
        controlSize="sm"
        className="text-[11px]"
        value={node.data.preset}
        onValueChange={(value) => {
          const preset = STYLE_PRESETS.find((item) => item.value === value);
          onUpdate({ preset: value, text: preset?.text ?? node.data.text });
        }}
        options={STYLE_PRESETS.map((preset) => ({
          value: preset.value,
          label: preset.label,
        }))}
      />
      <Textarea
        data-node-scrollable
        value={node.data.text}
        rows={3}
        maxLength={1000}
        aria-label="风格描述"
        onChange={(event) => onUpdate({ text: event.target.value })}
        className="w-full resize-none rounded-md border border-border bg-background p-2 text-xs leading-5 text-foreground outline-none placeholder:text-text-faint focus:border-border-strong"
      />
    </div>
  );
}

export function QualityNodeBody({
  node,
  onUpdate,
}: {
  node: Extract<GraphNode, { kind: "quality" }>;
  onUpdate: (patch: Record<string, unknown>) => void;
}) {
  return (
    <div className="space-y-1.5 p-2">
      <QualitySlider
        compact
        options={["low", "medium", "high", "xhigh", "max"]}
        value={
          node.data.quality ??
          (node.data.image2Mode === "high" ? "high" : "medium")
        }
        onChange={(quality) => onUpdate({ quality })}
      />
      <Select
        aria-label="背景模式"
        controlSize="sm"
        className="text-[11px]"
        value={node.data.background}
        onValueChange={(background) => onUpdate({ background })}
        options={[
          { value: "auto", label: "背景：自动" },
          { value: "opaque", label: "背景：不透明" },
        ]}
      />
    </div>
  );
}

export function NoteNodeBody({
  node,
  onUpdate,
}: {
  node: Extract<GraphNode, { kind: "note" }>;
  onUpdate: (patch: Record<string, unknown>) => void;
}) {
  return (
    <div className="bg-warning/[0.06] p-2">
      <Textarea
        data-node-scrollable
        value={node.data.text}
        rows={4}
        maxLength={1000}
        placeholder="记录这一组节点的用途…"
        aria-label="批注内容"
        onChange={(event) => onUpdate({ text: event.target.value })}
        className="w-full resize-none rounded-md border border-warning/20 bg-background/70 p-2 text-xs leading-5 text-foreground outline-none placeholder:text-text-faint focus:border-warning/40"
      />
    </div>
  );
}

export function FrameNodeBody({
  node,
  onUpdate,
}: {
  node: Extract<GraphNode, { kind: "frame" }>;
  onUpdate: (patch: Record<string, unknown>) => void;
}) {
  return (
    <div className="space-y-1.5 p-2">
      <Input
        value={node.data.name}
        aria-label="画板名称"
        onChange={(e) => onUpdate({ name: e.target.value })}
        className="h-7 text-[11px]"
      />
      <div className="grid grid-cols-2 gap-1.5">
        <Input
          type="number"
          value={node.data.width}
          aria-label="画板宽度"
          onChange={(e) =>
            onUpdate({ width: Math.max(1, Number(e.target.value) || 1) })
          }
          className="h-7 text-[11px]"
        />
        <Input
          type="number"
          value={node.data.height}
          aria-label="画板高度"
          onChange={(e) =>
            onUpdate({ height: Math.max(1, Number(e.target.value) || 1) })
          }
          className="h-7 text-[11px]"
        />
      </div>
      <label className="flex items-center gap-2 text-[11px] text-text-muted">
        背景{" "}
        <Input
          type="color"
          value={node.data.background}
          aria-label="画板背景"
          onChange={(e) => onUpdate({ background: e.target.value })}
          className="h-6 w-10 p-0.5"
        />
      </label>
    </div>
  );
}

export function TextNodeBody({
  node,
  onUpdate,
}: {
  node: Extract<GraphNode, { kind: "text" }>;
  onUpdate: (patch: Record<string, unknown>) => void;
}) {
  return (
    <div className="space-y-1.5 p-2">
      <Textarea
        value={node.data.text}
        rows={2}
        aria-label="文字内容"
        onChange={(e) => onUpdate({ text: e.target.value })}
        className="resize-none text-xs"
      />
      <div className="grid grid-cols-3 gap-1">
        <Input
          type="number"
          value={node.data.x}
          aria-label="文字 X"
          onChange={(e) => onUpdate({ x: Number(e.target.value) || 0 })}
          className="h-7 text-[11px]"
        />
        <Input
          type="number"
          value={node.data.y}
          aria-label="文字 Y"
          onChange={(e) => onUpdate({ y: Number(e.target.value) || 0 })}
          className="h-7 text-[11px]"
        />
        <Input
          type="number"
          min={8}
          max={240}
          value={node.data.fontSize}
          aria-label="字号"
          onChange={(e) =>
            onUpdate({ fontSize: Math.max(8, Number(e.target.value) || 8) })
          }
          className="h-7 text-[11px]"
        />
      </div>
      <Input
        type="color"
        value={node.data.color}
        aria-label="文字颜色"
        onChange={(e) => onUpdate({ color: e.target.value })}
        className="h-7 w-10 p-0.5"
      />
    </div>
  );
}

export function ShapeNodeBody({
  node,
  onUpdate,
}: {
  node: Extract<GraphNode, { kind: "shape" }>;
  onUpdate: (patch: Record<string, unknown>) => void;
}) {
  return (
    <div className="space-y-1.5 p-2">
      <Select
        aria-label="形状类型"
        controlSize="sm"
        value={node.data.shape}
        onValueChange={(shape) => onUpdate({ shape })}
        options={[
          { value: "rectangle", label: "矩形" },
          { value: "circle", label: "圆形" },
        ]}
      />
      <div className="grid grid-cols-2 gap-1">
        <Input
          type="number"
          value={node.data.x}
          aria-label="形状 X"
          onChange={(e) => onUpdate({ x: Number(e.target.value) || 0 })}
          className="h-7 text-[11px]"
        />
        <Input
          type="number"
          value={node.data.y}
          aria-label="形状 Y"
          onChange={(e) => onUpdate({ y: Number(e.target.value) || 0 })}
          className="h-7 text-[11px]"
        />
        <Input
          type="number"
          value={node.data.width}
          aria-label="形状宽度"
          onChange={(e) =>
            onUpdate({ width: Math.max(1, Number(e.target.value) || 1) })
          }
          className="h-7 text-[11px]"
        />
        <Input
          type="number"
          value={node.data.height}
          aria-label="形状高度"
          onChange={(e) =>
            onUpdate({ height: Math.max(1, Number(e.target.value) || 1) })
          }
          className="h-7 text-[11px]"
        />
      </div>
      <Input
        type="color"
        value={node.data.fill}
        aria-label="形状颜色"
        onChange={(e) => onUpdate({ fill: e.target.value })}
        className="h-7 w-10 p-0.5"
      />
    </div>
  );
}

export function DesignImageNodeBody({
  node,
  onUpdate,
}: {
  node: Extract<GraphNode, { kind: "design-image" }>;
  onUpdate: (patch: Record<string, unknown>) => void;
}) {
  return (
    <div className="space-y-1.5 p-2">
      <Input
        value={node.data.url}
        aria-label="图片地址"
        placeholder="图片 URL"
        onChange={(e) => onUpdate({ url: e.target.value })}
        className="h-7 text-[11px]"
      />
      {node.data.url ? (
        <img
          src={node.data.url}
          alt="设计图片"
          className="aspect-[4/3] max-h-32 w-full rounded bg-surface-2 object-contain"
        />
      ) : (
        <div className="flex h-16 items-center justify-center rounded border border-dashed border-border text-[10px] text-text-faint">
          可接收生成结果
        </div>
      )}
      <div className="grid grid-cols-2 gap-1">
        <Input
          type="number"
          value={node.data.x}
          aria-label="图片 X"
          onChange={(e) => onUpdate({ x: Number(e.target.value) || 0 })}
          className="h-7 text-[11px]"
        />
        <Input
          type="number"
          value={node.data.y}
          aria-label="图片 Y"
          onChange={(e) => onUpdate({ y: Number(e.target.value) || 0 })}
          className="h-7 text-[11px]"
        />
        <Input
          type="number"
          value={node.data.width}
          aria-label="图片宽度"
          onChange={(e) =>
            onUpdate({ width: Math.max(1, Number(e.target.value) || 1) })
          }
          className="h-7 text-[11px]"
        />
        <Input
          type="number"
          value={node.data.height}
          aria-label="图片高度"
          onChange={(e) =>
            onUpdate({ height: Math.max(1, Number(e.target.value) || 1) })
          }
          className="h-7 text-[11px]"
        />
      </div>
      <Select
        aria-label="图片适配"
        controlSize="sm"
        value={node.data.fit}
        onValueChange={(fit) => onUpdate({ fit })}
        options={[
          { value: "cover", label: "填充" },
          { value: "contain", label: "适应" },
        ]}
      />
    </div>
  );
}

// ─── 参考图节点 ───

export function ReferenceNodeBody({
  node,
  history,
  uploading,
  onUpdate,
  onUploadFile,
}: {
  node: Extract<GraphNode, { kind: "reference" }>;
  history: Generation[];
  uploading: boolean;
  onUpdate: (patch: Record<string, unknown>) => void;
  onUploadFile: (file: File) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const historyImages = history
    .flatMap((generation) =>
      generation.images.map((image) => ({
        id: image.id,
        thumbnailUrl: image.thumbnailUrl || image.url,
        url: image.url,
      })),
    )
    .slice(0, 12);

  if (node.data.previewUrl) {
    return (
      <div className="p-2">
        <div className="group relative overflow-hidden rounded-md border border-border">
          <img
            draggable={false}
            src={node.data.previewUrl}
            alt="参考图"
            className="aspect-[4/3] max-h-36 w-full bg-surface-2 object-contain"
          />
          <Button
            variant="ghost"
            type="button"
            aria-label="移除图片"
            onClick={() =>
              onUpdate({ kind: "upload", key: "", previewUrl: "" })
            }
            className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-md bg-background/80 p-0 text-foreground opacity-0 transition-opacity group-hover:opacity-100"
          >
            <X size={13} />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5 p-2">
      <label
        className={cn(
          "flex h-8 w-full cursor-pointer items-center justify-center gap-1.5 rounded-md border border-dashed border-border text-[11px] text-text-muted transition-colors hover:border-border-strong hover:text-foreground",
          uploading && "pointer-events-none opacity-50",
        )}
      >
        {uploading ? (
          <Loader2 size={12} className="animate-spin" />
        ) : (
          <ImagePlus size={12} />
        )}
        {uploading ? "上传中…" : "上传图片"}
        <Input
          type="file"
          className="sr-only"
          accept="image/png,image/jpeg,image/webp"
          disabled={uploading}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onUploadFile(file);
            event.target.value = "";
          }}
        />
      </label>

      <Button
        variant="ghost"
        type="button"
        onClick={() => setPickerOpen((open) => !open)}
        className="flex h-7 w-full items-center justify-center rounded-md border border-border text-[11px] text-text-muted transition-colors hover:border-border-strong hover:text-foreground"
      >
        从历史生成选择
        {pickerOpen ? " ▲" : " ▼"}
      </Button>

      {pickerOpen ? (
        <div
          data-node-scrollable
          className="grid max-h-40 grid-cols-3 gap-1 overflow-y-auto rounded-md border border-border p-1"
        >
          {historyImages.length === 0 ? (
            <p className="col-span-3 py-4 text-center text-[10px] text-text-faint">
              暂无历史图片
            </p>
          ) : (
            historyImages.map((image) => (
              <Button
                variant="ghost"
                key={image.id}
                type="button"
                onClick={() => {
                  onUpdate({
                    kind: "source",
                    key: image.id,
                    previewUrl: image.url || image.thumbnailUrl,
                  });
                  setPickerOpen(false);
                }}
                className="overflow-hidden rounded border border-border transition-colors hover:border-border-strong"
              >
                {}
                <img
                  draggable={false}
                  src={image.thumbnailUrl}
                  alt="历史图片"
                  className="aspect-square w-full object-cover"
                />
              </Button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

// ─── 模型与参数节点 ───

export function ModelNodeBody({
  node,
  models,
  onUpdate,
}: {
  node: Extract<GraphNode, { kind: "model" }>;
  models: ModelInfo[];
  onUpdate: (patch: Record<string, unknown>) => void;
}) {
  const model = models.find((item) => item.id === node.data.modelId) ?? null;
  const {
    sizes,
    size: selectedSize,
    outputFormat: selectedFormat,
  } = resolveGenerationOptions(model, node.data);
  const formats = model?.capabilities.outputFormats ?? [];
  const maxN = Math.min(model?.capabilities.maxN ?? 1, 4);

  useEffect(() => {
    if (
      model &&
      (node.data.size !== selectedSize ||
        node.data.outputFormat !== selectedFormat)
    ) {
      onUpdate({ size: selectedSize, outputFormat: selectedFormat });
    }
  }, [
    model,
    node.data.size,
    node.data.outputFormat,
    selectedSize,
    selectedFormat,
    onUpdate,
  ]);

  return (
    <div className="space-y-1.5 p-2">
      <Select
        aria-label="模型"
        controlSize="sm"
        className="text-[11px]"
        placeholder="选择模型"
        value={node.data.modelId ?? ""}
        onValueChange={(value) => {
          const nextModel = models.find((item) => item.id === value);
          const { size, outputFormat } = resolveGenerationOptions(
            nextModel ?? null,
            node.data,
          );
          onUpdate({
            modelId: value || null,
            size,
            n: Math.min(node.data.n || 1, nextModel?.capabilities.maxN ?? 1),
            outputFormat,
          });
        }}
        options={models.map((item) => ({
          value: item.id,
          label: item.displayName,
          disabled: !item.available,
        }))}
      />

      <div className="flex gap-1.5">
        <Select
          aria-label="尺寸"
          controlSize="sm"
          className="text-[11px]"
          value={selectedSize ?? ""}
          onValueChange={(value) => onUpdate({ size: value })}
          options={sizes.map((size) => ({
            value: size,
            label: sizeLabel(size),
          }))}
        />
        <Select
          aria-label="生成数量"
          controlSize="sm"
          className="w-16 shrink-0 text-[11px]"
          value={String(node.data.n)}
          onValueChange={(value) => onUpdate({ n: Number(value) })}
          options={Array.from({ length: maxN }).map((_, index) => ({
            value: String(index + 1),
            label: `×${index + 1}`,
          }))}
        />
      </div>

      {formats.length > 1 ? (
        <Select
          aria-label="输出格式"
          controlSize="sm"
          className="text-[11px]"
          value={selectedFormat ?? ""}
          onValueChange={(value) => {
            const { size, outputFormat } = resolveGenerationOptions(model, {
              ...node.data,
              outputFormat: value,
            });
            onUpdate({ size, outputFormat });
          }}
          options={formats.map((format) => ({
            value: format,
            label: format.toUpperCase(),
          }))}
        />
      ) : null}
    </div>
  );
}

// ─── 生成节点（输入端口行 + 执行 + 结果） ───

export function GenerateNodeBody({
  node,
  models,
  edges,
  run,
  validationHint,
  onUpdate,
  modelConnected,
  effectiveModelId,
  effectiveSize,
  effectiveN,
  effectiveOutputFormat,
  qualityConnected,
  onRun,
  onCancel,
  onDisconnect,
  onReorderReference,
  onOpenImage,
  onResultAsReference,
  onResultAsDesignImage,
  onDownloadImage,
}: {
  node: Extract<GraphNode, { kind: "generate" }>;
  models: ModelInfo[];
  edges: GraphEdge[];
  run: NodeRunState;
  validationHint: string | null;
  onUpdate: (patch: Record<string, unknown>) => void;
  modelConnected: boolean;
  effectiveModelId?: string | null;
  effectiveSize?: string;
  effectiveN?: number;
  effectiveOutputFormat?: string;
  qualityConnected: boolean;
  onRun: () => void;
  onCancel: () => void;
  onDisconnect: (edgeId: string) => void;
  onReorderReference: (edgeId: string, direction: "up" | "down") => void;
  onOpenImage: (index: number) => void;
  onResultAsReference: (image: {
    id: string;
    url: string;
    thumbnailUrl: string;
    downloadUrl?: string;
  }) => void;
  onResultAsDesignImage: (image: {
    id: string;
    url: string;
    thumbnailUrl: string;
    downloadUrl?: string;
  }) => void;
  onDownloadImage: (image: {
    id: string;
    url: string;
    thumbnailUrl: string;
    downloadUrl?: string;
  }) => void;
}) {
  const running = run.status === "running";
  const selectedModelId = modelConnected
    ? (effectiveModelId ?? node.data.modelId)
    : node.data.modelId;
  const model = models.find((item) => item.id === selectedModelId) ?? null;
  const {
    sizes,
    size: selectedSize,
    outputFormat: selectedFormat,
  } = resolveGenerationOptions(
    model,
    modelConnected
      ? { size: effectiveSize, outputFormat: effectiveOutputFormat }
      : node.data,
  );
  const formats = model?.capabilities.outputFormats ?? [];
  const qualities = model?.capabilities.qualities ?? [];
  const backgrounds = model?.capabilities.backgrounds ?? ["auto", "opaque"];
  const maxN = Math.min(model?.capabilities.maxN ?? 1, 4);
  const backgroundValue = backgrounds.some(
    (background) => background === (node.data.background ?? "auto"),
  )
    ? (node.data.background ?? "auto")
    : (backgrounds[0] ?? "auto");

  useEffect(() => {
    if (
      model &&
      !modelConnected &&
      (node.data.size !== selectedSize ||
        node.data.outputFormat !== selectedFormat)
    ) {
      onUpdate({ size: selectedSize, outputFormat: selectedFormat });
    }
  }, [
    model,
    modelConnected,
    node.data.size,
    node.data.outputFormat,
    selectedSize,
    selectedFormat,
    onUpdate,
  ]);

  return (
    <div>
      {/* 输入端口行：锚点位置由 PORT_ROW_H 决定，勿随意改动行高 */}
      <div className="border-b border-border py-0">
        {INPUT_PORTS.map((port) => {
          const portEdges = edges.filter(
            (edge) => edge.to === node.id && edge.toPort === port,
          );
          return (
            <div
              key={port}
              className="flex h-[22px] items-center gap-1.5 pl-4 pr-2"
            >
              <span className="text-[10px] text-text-muted">
                {PORT_LABEL[port]}
              </span>
              <span className="ml-auto flex items-center gap-0.5">
                {portEdges.map((edge, index) => (
                  <span
                    key={edge.id}
                    className="inline-flex items-center gap-0.5"
                  >
                    {port === "reference" ? (
                      <>
                        <span
                          className="rounded bg-brand/15 px-1 text-[9px] font-semibold tabular-nums text-brand"
                          title={`这是参考图 ${index + 1}`}
                        >
                          #{index + 1}
                        </span>
                        {portEdges.length > 1 ? (
                          <span className="inline-flex items-center">
                            <Button
                              variant="ghost"
                              type="button"
                              aria-label={`参考图 ${index + 1} 上移`}
                              title="上移参考图"
                              disabled={index === 0}
                              onClick={() => onReorderReference(edge.id, "up")}
                              className="flex h-4 w-3.5 items-center justify-center rounded p-0 text-text-faint hover:bg-surface-2 hover:text-foreground disabled:opacity-30"
                            >
                              <ChevronUp size={8} />
                            </Button>
                            <Button
                              variant="ghost"
                              type="button"
                              aria-label={`参考图 ${index + 1} 下移`}
                              title="下移参考图"
                              disabled={index === portEdges.length - 1}
                              onClick={() =>
                                onReorderReference(edge.id, "down")
                              }
                              className="flex h-4 w-3.5 items-center justify-center rounded p-0 text-text-faint hover:bg-surface-2 hover:text-foreground disabled:opacity-30"
                            >
                              <ChevronDown size={8} />
                            </Button>
                          </span>
                        ) : null}
                      </>
                    ) : null}
                    <Button
                      variant="ghost"
                      type="button"
                      aria-label={`断开${port === "reference" ? `参考图 ${index + 1}` : PORT_LABEL[port]}连线`}
                      onClick={() => onDisconnect(edge.id)}
                      title="断开连线"
                      className="flex h-4 w-4 items-center justify-center rounded-full bg-brand/25 p-0 text-[8px] text-foreground transition-colors hover:bg-danger/30"
                    >
                      <X size={8} />
                    </Button>
                  </span>
                ))}
                {portEdges.length === 0 ? (
                  <span className="text-[9px] text-text-faint">未连接</span>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>

      <details open className="border-b border-border">
        <summary className="flex h-7 cursor-pointer list-none items-center gap-1.5 px-3 text-[10px] font-medium text-text-muted marker:hidden [&::-webkit-details-marker]:hidden">
          <SlidersHorizontal size={11} />
          <span>模型与参数</span>
          <span className="ml-auto text-[9px] text-text-faint">
            {modelConnected ? "已连接节点" : "直接设置"}
          </span>
        </summary>
        <div className="space-y-1.5 px-3 pb-2">
          <Select
            aria-label="生成节点模型"
            controlSize="sm"
            className="text-[11px]"
            disabled={modelConnected}
            placeholder="选择模型"
            value={selectedModelId ?? ""}
            onValueChange={(modelId) => {
              const nextModel = models.find((item) => item.id === modelId);
              const { size, outputFormat } = resolveGenerationOptions(
                nextModel ?? null,
                node.data,
              );
              onUpdate({
                modelId: modelId || null,
                size,
                n: Math.min(
                  node.data.n ?? 1,
                  nextModel?.capabilities.maxN ?? 1,
                ),
                outputFormat,
                quality:
                  nextModel?.defaults.quality ??
                  nextModel?.capabilities.qualities?.[0],
                background: nextModel?.defaults.background ?? "auto",
              });
            }}
            options={models.map((item) => ({
              value: item.id,
              label: item.displayName,
              disabled: !item.available,
            }))}
          />
          <div className="flex gap-1.5">
            <Select
              aria-label="生成节点尺寸"
              controlSize="sm"
              className="text-[11px]"
              disabled={modelConnected || sizes.length === 0}
              placeholder="尺寸"
              value={selectedSize ?? ""}
              onValueChange={(size) => onUpdate({ size })}
              options={sizes.map((size) => ({
                value: size,
                label: sizeLabel(size),
              }))}
            />
            <Select
              aria-label="生成节点数量"
              controlSize="sm"
              className="w-16 shrink-0 text-[11px]"
              disabled={modelConnected}
              value={String(
                modelConnected ? (effectiveN ?? 1) : (node.data.n ?? 1),
              )}
              onValueChange={(value) => onUpdate({ n: Number(value) })}
              options={Array.from({ length: maxN }).map((_, index) => ({
                value: String(index + 1),
                label: `×${index + 1}`,
              }))}
            />
          </div>
          {formats.length > 1 ? (
            <Select
              aria-label="生成节点输出格式"
              controlSize="sm"
              className="text-[11px]"
              disabled={modelConnected}
              value={selectedFormat ?? ""}
              onValueChange={(value) => {
                const { size, outputFormat } = resolveGenerationOptions(model, {
                  ...node.data,
                  outputFormat: value,
                });
                onUpdate({ size, outputFormat });
              }}
              options={formats.map((format) => ({
                value: format,
                label: format.toUpperCase(),
              }))}
            />
          ) : null}
          {qualities.length > 1 ? (
            <div className="space-y-0.5">
              <div className="flex items-center justify-between text-[9px] text-text-faint">
                <span>生成质量</span>
                <span className="font-medium text-foreground">
                  {qualityLabel(
                    node.data.quality ??
                      model?.defaults.quality ??
                      qualities[0] ??
                      "auto",
                  )}
                </span>
              </div>
              <QualitySlider
                compact
                options={qualities}
                disabled={qualityConnected}
                value={
                  node.data.quality ??
                  model?.defaults.quality ??
                  qualities[0] ??
                  "auto"
                }
                onChange={(quality) => onUpdate({ quality })}
                ariaLabel="生成节点质量"
              />
            </div>
          ) : null}
          <div className="flex gap-1.5">
            <Select
              aria-label="生成节点背景"
              controlSize="sm"
              className="text-[11px]"
              disabled={qualityConnected}
              value={backgroundValue}
              onValueChange={(background) => onUpdate({ background })}
              options={backgrounds.map((background) => ({
                value: background,
                label:
                  background === "opaque"
                    ? "背景：不透明"
                    : background === "transparent"
                      ? "背景：透明"
                      : "背景：自动",
              }))}
            />
          </div>
        </div>
      </details>

      <div className="space-y-2 p-2">
        <div className="flex items-center gap-1.5">
          {running ? (
            <>
              <Button
                variant="ghost"
                type="button"
                onClick={onCancel}
                className="flex h-7 flex-1 items-center justify-center gap-1 rounded-md border border-border text-[11px] text-text-muted transition-colors hover:border-border-strong hover:text-foreground"
              >
                <X size={11} />
                取消
              </Button>
              <span className="shrink-0 text-[10px] tabular-nums text-text-muted">
                {run.progress}%
              </span>
            </>
          ) : (
            <Button
              variant="ghost"
              type="button"
              onClick={onRun}
              disabled={validationHint !== null}
              title={validationHint ?? "运行此节点"}
              className={cn(
                "flex h-7 flex-1 items-center justify-center gap-1 rounded-md text-[11px] font-medium transition-colors",
                validationHint
                  ? "cursor-not-allowed bg-surface-2 text-text-faint"
                  : "bg-brand text-on-accent hover:bg-brand/88",
              )}
            >
              <Check size={11} />
              运行
            </Button>
          )}
        </div>

        {running ? (
          <span className="block h-1 overflow-hidden rounded-full bg-border">
            <span
              className="progress-stripes block h-full rounded-full bg-brand transition-[width] duration-500"
              style={{ width: `${Math.max(4, run.progress)}%` }}
            />
          </span>
        ) : null}

        {validationHint && !running ? (
          <p className="text-[10px] leading-4 text-text-faint">
            {validationHint}
          </p>
        ) : null}

        {run.status === "failed" && run.error ? (
          <p className="text-[10px] leading-4 text-danger">{run.error}</p>
        ) : null}

        {run.images.length > 0 ? (
          <div className="grid grid-cols-2 gap-1">
            {run.images.map((image, index) => (
              <div
                key={image.id}
                className="group relative overflow-hidden rounded-md border border-border"
              >
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => onOpenImage(index)}
                  aria-label={`查看生成结果 ${index + 1}`}
                  className="block h-auto min-h-0 w-full rounded-none p-0"
                >
                  {}
                  <img
                    draggable={false}
                    src={image.url || image.thumbnailUrl}
                    alt="生成结果"
                    className="aspect-[4/3] w-full bg-surface-2 object-contain"
                  />
                </Button>
                <Button
                  variant="ghost"
                  type="button"
                  aria-label="转为参考图节点"
                  onClick={() =>
                    onResultAsReference({
                      id: image.id,
                      url: image.url,
                      thumbnailUrl: image.thumbnailUrl || image.url,
                      downloadUrl: image.downloadUrl || image.url,
                    })
                  }
                  title="转为参考图节点"
                  className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-md bg-background/85 p-0 text-foreground opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <ImagePlus size={12} />
                </Button>
                <Button
                  variant="ghost"
                  type="button"
                  aria-label="转为设计图片节点"
                  onClick={() =>
                    onResultAsDesignImage({
                      id: image.id,
                      url: image.url,
                      thumbnailUrl: image.url || image.thumbnailUrl,
                      downloadUrl: image.downloadUrl || image.url,
                    })
                  }
                  title="转为设计图片节点"
                  className="absolute right-8 top-1 flex h-6 w-6 items-center justify-center rounded-md bg-background/85 p-0 text-foreground opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <PanelsTopLeft size={12} />
                </Button>
                <Button
                  variant="ghost"
                  type="button"
                  aria-label="下载原图"
                  onClick={() =>
                    onDownloadImage({
                      id: image.id,
                      url: image.url,
                      thumbnailUrl: image.thumbnailUrl || image.url,
                      downloadUrl: image.downloadUrl || image.url,
                    })
                  }
                  title="下载原图"
                  className="absolute right-1 top-9 flex h-6 w-6 items-center justify-center rounded-md bg-background/85 p-0 text-foreground opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <Download size={12} />
                </Button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
