"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ImagePlus, Scan, Sparkles, X } from "lucide-react";
import type { Editor, TLPageId } from "tldraw";
import { Button, IconButton, Input, Select, Textarea } from "@/components/ui";
import { uploadReferenceImage } from "../lib/api";
import type { ModelInfo } from "../lib/types";
import { sizeLabel } from "../CommandDock";
import { QualitySlider } from "../QualitySlider";
import { getModel } from "@/lib/models/registry";
import {
  aspectRatioForSize,
  resolutionTierForSize,
} from "@/lib/models/options";
import type { ImageSize } from "@/lib/models/types";
import { estimateCost } from "@/lib/credits";
import {
  selectionReference,
  uploadUrl,
  type CanvasDraft,
  type CanvasReference,
} from "./canvas-bridge";

function initialDraft(editor: Editor): CanvasDraft {
  const saved = editor.getCurrentPage().meta.chugaoDraft as
    | Partial<CanvasDraft>
    | undefined;
  return {
    prompt: typeof saved?.prompt === "string" ? saved.prompt : "",
    modelId: typeof saved?.modelId === "string" ? saved.modelId : "",
    size: typeof saved?.size === "string" ? saved.size : "auto",
    quality: typeof saved?.quality === "string" ? saved.quality : "high",
    background:
      typeof saved?.background === "string" ? saved.background : "auto",
    outputFormat:
      typeof saved?.outputFormat === "string" ? saved.outputFormat : "png",
    n:
      typeof saved?.n === "number" && Number.isInteger(saved.n)
        ? Math.max(1, Math.min(4, saved.n))
        : 1,
    references: Array.isArray(saved?.references)
      ? saved.references
          .filter(
            (r) =>
              r &&
              typeof r.key === "string" &&
              typeof r.previewUrl === "string" &&
              typeof r.name === "string",
          )
          .slice(0, 16)
      : [],
  };
}

export function GenerationPanel({
  editor,
  models,
  pageId,
  selectionCount,
  submitting,
  onGenerate,
  onError,
}: {
  editor: Editor;
  models: ModelInfo[];
  pageId: TLPageId;
  selectionCount: number;
  submitting: boolean;
  onGenerate: (draft: CanvasDraft) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [draft, setDraft] = useState(() => initialDraft(editor));
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const model = models.find((m) => m.id === draft.modelId);
  const referenceLimit = Math.min(
    model?.capabilities.maxReferenceImages ?? 16,
    16,
  );
  const [savingSelection, setSavingSelection] = useState(false);

  useEffect(() => {
    if (!models.length) return;
    setDraft((current) => {
      const next =
        models.find((m) => m.id === current.modelId) ??
        models.find((m) => m.available) ??
        models[0];
      return {
        ...current,
        modelId: next.id,
        size: next.capabilities.sizes.includes(current.size)
          ? current.size
          : next.defaults.size,
        quality: next.capabilities.qualities?.includes(current.quality)
          ? current.quality
          : next.defaults.quality || "auto",
        outputFormat: next.capabilities.outputFormats.includes(
          current.outputFormat,
        )
          ? current.outputFormat
          : next.defaults.outputFormat,
        background: next.capabilities.backgrounds.includes(current.background)
          ? current.background
          : next.defaults.background,
        n: Math.min(current.n, next.capabilities.maxN),
      };
    });
  }, [models]);

  useEffect(() => {
    const save = () => {
      const page = editor.getPage(pageId);
      if (page)
        editor.updatePage({
          id: pageId,
          meta: {
            ...page.meta,
            chugaoDraft: JSON.parse(JSON.stringify(draftRef.current)),
          },
        });
    };
    const timer = window.setTimeout(save, 400);
    return () => {
      window.clearTimeout(timer);
      save();
    };
  }, [draft, editor, pageId]);

  const patch = (value: Partial<CanvasDraft>) =>
    setDraft((current) => ({ ...current, ...value }));
  const addReferences = (references: CanvasReference[]) =>
    setDraft((current) => {
      const next = [...current.references];
      for (const reference of references) {
        if (
          !next.some((r) => r.key === reference.key) &&
          next.length < referenceLimit
        )
          next.push(reference);
      }
      return { ...current, references: next };
    });

  const addSelection = async () => {
    const ids = editor.getSelectedShapeIds();
    setSavingSelection(true);
    try {
      addReferences([await selectionReference(editor, ids)]);
    } catch (error) {
      onError(error instanceof Error ? error.message : "选区导出失败");
    } finally {
      setSavingSelection(false);
    }
  };

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files).slice(
        0,
        Math.max(0, referenceLimit - draft.references.length),
      )) {
        const image = await uploadReferenceImage(file);
        addReferences([
          { key: image.key, previewUrl: uploadUrl(image.key), name: file.name },
        ]);
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : "参考图上传失败");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const move = (index: number, direction: number) =>
    setDraft((current) => {
      const references = [...current.references];
      [references[index], references[index + direction]] = [
        references[index + direction],
        references[index],
      ];
      return { ...current, references };
    });
  const unsupportedReferences =
    draft.references.length > 0 &&
    (!model?.capabilities.supportsReferenceImage ||
      draft.references.length > referenceLimit);
  const definition = model ? getModel(model.id) : null;
  const estimatedCredits =
    model && definition
      ? estimateCost(
          { ...definition, pricingRules: model.pricingRules },
          {
            n: draft.n,
            size: draft.size as ImageSize,
            resolution: resolutionTierForSize(draft.size as ImageSize),
            aspectRatio: aspectRatioForSize(draft.size as ImageSize),
            image2Mode: model.id === "gpt-image-2" ? "standard" : undefined,
            outputFormat: draft.outputFormat as "png" | "jpeg" | "webp",
            background: draft.background as "auto" | "opaque" | "transparent",
            usesReference: draft.references.length > 0,
          },
        )
      : null;

  return (
    <div className="space-y-5 p-4">
      <label className="block space-y-2 text-xs text-text-muted">
        <span>提示词</span>
        <Textarea
          aria-label="画布生成提示词"
          value={draft.prompt}
          maxLength={4000}
          onChange={(event) => patch({ prompt: event.target.value })}
          className="min-h-36 resize-y text-sm leading-6"
        />
      </label>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 text-xs text-text-muted">
          <span>
            参考图{" "}
            <span className="tabular-nums">
              {draft.references.length}/{referenceLimit}
            </span>
          </span>
          <div className="flex gap-1">
            <IconButton
              aria-label="添加画布选区为参考图"
              title="添加画布选区为参考图"
              onClick={() => void addSelection()}
              disabled={
                !selectionCount ||
                savingSelection ||
                uploading ||
                draft.references.length >= referenceLimit ||
                !model?.capabilities.supportsReferenceImage
              }
            >
              <Scan size={15} />
            </IconButton>
            <IconButton
              aria-label="上传参考图"
              title="上传参考图"
              onClick={() => fileInput.current?.click()}
              disabled={
                uploading ||
                savingSelection ||
                draft.references.length >= referenceLimit ||
                !model?.capabilities.supportsReferenceImage
              }
            >
              <ImagePlus size={15} />
            </IconButton>
          </div>
        </div>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(event) => void upload(event.target.files)}
        />
        {draft.references.map((reference, index) => (
          <div
            key={reference.key}
            className="flex min-w-0 items-center gap-2 border-b border-border py-2"
          >
            <span className="w-4 shrink-0 text-xs text-text-muted">
              {index + 1}
            </span>
            <img
              src={reference.previewUrl}
              alt={`参考图 ${index + 1}`}
              className="h-11 w-12 shrink-0 rounded object-contain bg-surface-2"
            />
            <span
              className="min-w-0 flex-1 truncate text-xs"
              title={reference.name}
            >
              {reference.name}
            </span>
            <div className="flex shrink-0">
              <IconButton
                title={`上移参考图 ${index + 1}`}
                aria-label={`上移参考图 ${index + 1}`}
                className="h-7 w-6"
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                <ArrowUp size={13} />
              </IconButton>
              <IconButton
                title={`下移参考图 ${index + 1}`}
                aria-label={`下移参考图 ${index + 1}`}
                className="h-7 w-6"
                disabled={index === draft.references.length - 1}
                onClick={() => move(index, 1)}
              >
                <ArrowDown size={13} />
              </IconButton>
              <IconButton
                title={`移除参考图 ${index + 1}`}
                aria-label={`移除参考图 ${index + 1}`}
                className="h-7 w-6"
                onClick={() =>
                  patch({
                    references: draft.references.filter((_, i) => i !== index),
                  })
                }
              >
                <X size={13} />
              </IconButton>
            </div>
          </div>
        ))}
        {(uploading || savingSelection) && (
          <p role="status" className="text-xs text-text-muted">
            正在保存参考图
          </p>
        )}
        {unsupportedReferences && (
          <p className="text-xs text-danger">参考图数量超出当前模型限制</p>
        )}
      </div>
      <label className="block space-y-2 text-xs text-text-muted">
        <span>模型</span>
        <Select
          aria-label="画布生成模型"
          value={draft.modelId}
          placeholder="加载模型"
          options={models.map((m) => ({
            value: m.id,
            label: m.displayName,
            disabled: !m.available,
          }))}
          onValueChange={(id) => {
            const next = models.find((m) => m.id === id);
            if (next)
              patch({
                modelId: id,
                size: next.defaults.size,
                quality: next.defaults.quality || "auto",
                n: 1,
                outputFormat: next.defaults.outputFormat,
                background: next.defaults.background,
              });
          }}
        />
      </label>
      {model && (
        <>
          <label className="block space-y-2 text-xs text-text-muted">
            <span>分辨率</span>
            <Select
              aria-label="画布生成分辨率"
              value={draft.size}
              options={model.capabilities.sizes.map((size) => ({
                value: size,
                label: sizeLabel(size),
              }))}
              onValueChange={(size) => patch({ size })}
            />
          </label>
          {(model.capabilities.qualities?.length ?? 0) > 1 && (
            <div className="space-y-2 text-xs text-text-muted">
              <span>质量</span>
              <QualitySlider
                options={model.capabilities.qualities!}
                value={draft.quality}
                onChange={(quality) => patch({ quality })}
              />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-2 text-xs text-text-muted">
              <span>输出格式</span>
              <Select
                aria-label="画布输出格式"
                value={draft.outputFormat}
                options={model.capabilities.outputFormats.map((value) => ({
                  value,
                  label: value.toUpperCase(),
                }))}
                onValueChange={(outputFormat) =>
                  patch({
                    outputFormat,
                    ...(outputFormat === "jpeg" &&
                    draft.background === "transparent"
                      ? { background: "auto" }
                      : {}),
                  })
                }
              />
            </label>
            <label className="space-y-2 text-xs text-text-muted">
              <span>数量</span>
              <Input
                aria-label="画布生成数量"
                type="number"
                min={1}
                max={Math.min(model.capabilities.maxN, 4)}
                value={draft.n}
                onChange={(event) =>
                  patch({
                    n: Math.max(
                      1,
                      Math.min(
                        Number(event.target.value) || 1,
                        model.capabilities.maxN,
                        4,
                      ),
                    ),
                  })
                }
              />
            </label>
          </div>
          {model.capabilities.backgrounds.length > 1 && (
            <label className="block space-y-2 text-xs text-text-muted">
              <span>背景</span>
              <Select
                aria-label="画布生成背景"
                value={draft.background}
                options={model.capabilities.backgrounds.map((value) => ({
                  value,
                  label:
                    { auto: "自动", opaque: "不透明", transparent: "透明" }[
                      value
                    ] || value,
                  disabled:
                    value === "transparent" && draft.outputFormat === "jpeg",
                }))}
                onValueChange={(background) => patch({ background })}
              />
            </label>
          )}
        </>
      )}
      {estimatedCredits !== null && (
        <div className="flex items-center justify-between text-xs text-text-muted">
          <span>预计消耗</span>
          <span className="tabular-nums">{estimatedCredits} 积分</span>
        </div>
      )}
      {draft.size === "auto" && (
        <p className="text-xs text-text-muted">自动尺寸按实际出图大小结算</p>
      )}
      <Button
        className="w-full"
        variant="primary"
        loading={submitting}
        disabled={
          submitting ||
          uploading ||
          savingSelection ||
          !model?.available ||
          !draft.prompt.trim() ||
          unsupportedReferences
        }
        onClick={() => void onGenerate(draft)}
      >
        <Sparkles size={15} /> 生成图片
      </Button>
      {models.length > 0 && !models.some((m) => m.available) && (
        <p className="text-xs text-danger">暂时没有可用图像模型</p>
      )}
    </div>
  );
}
