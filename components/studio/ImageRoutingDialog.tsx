"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Route, ShieldAlert, Sparkles } from "lucide-react";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Segmented,
  Select,
} from "@/components/ui";
import type { ImageQuality } from "@/lib/models/types";

import { QualitySlider, qualityLabel } from "./QualitySlider";
import {
  AUTO_IMAGE_MODEL_ID,
  automaticImageModel,
  sortImageModels,
  type ImageRouteMode,
} from "./lib/image-routing";
import type { ModelInfo } from "./lib/types";

export interface ImageRoutingSelection {
  routeMode: ImageRouteMode;
  modelId: string;
  quality: string;
  rememberModel: boolean;
  rememberQuality: boolean;
}

interface ImageRoutingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  models: ModelInfo[];
  routeMode: ImageRouteMode;
  modelId: string | null;
  quality?: string;
  fallback?: {
    requested: ModelInfo;
    suggested: ModelInfo;
  } | null;
  onConfirm: (selection: ImageRoutingSelection) => void;
}

export function ImageRoutingDialog({
  open,
  onOpenChange,
  models,
  routeMode,
  modelId,
  quality,
  fallback = null,
  onConfirm,
}: ImageRoutingDialogProps) {
  const [draftRouteMode, setDraftRouteMode] =
    useState<ImageRouteMode>(routeMode);
  const [draftModelId, setDraftModelId] = useState(
    modelId ?? AUTO_IMAGE_MODEL_ID,
  );
  const [draftQuality, setDraftQuality] = useState(quality ?? "auto");
  const [rememberModel, setRememberModel] = useState(false);
  const [rememberQuality, setRememberQuality] = useState(false);
  const orderedModels = useMemo(() => sortImageModels(models), [models]);
  const automaticModel = automaticImageModel(models);
  const activeModel =
    (draftRouteMode === "auto"
      ? automaticModel
      : models.find((model) => model.id === draftModelId)) ??
    automaticModel ??
    models[0] ??
    null;
  const qualities = useMemo<ImageQuality[]>(
    () => activeModel?.capabilities.qualities ?? ["auto"],
    [activeModel],
  );
  const normalizedQuality = qualities.includes(draftQuality as ImageQuality)
    ? draftQuality
    : (activeModel?.defaults.quality ?? qualities[0] ?? "auto");

  useEffect(() => {
    if (!open) return;
    const nextModelId =
      fallback?.suggested.id ?? modelId ?? AUTO_IMAGE_MODEL_ID;
    setDraftRouteMode(fallback ? "fixed" : routeMode);
    setDraftModelId(nextModelId);
    setDraftQuality(
      fallback?.suggested.capabilities.qualities?.includes(
        (quality ?? "") as ImageQuality,
      )
        ? quality!
        : (quality ?? fallback?.suggested.defaults.quality ?? "auto"),
    );
    setRememberModel(false);
    setRememberQuality(false);
  }, [fallback, modelId, open, quality, routeMode]);

  useEffect(() => {
    if (!qualities.includes(draftQuality as ImageQuality))
      setDraftQuality(normalizedQuality);
  }, [draftQuality, normalizedQuality, qualities]);

  const confirm = () => {
    const nextModelId =
      draftRouteMode === "auto"
        ? AUTO_IMAGE_MODEL_ID
        : (activeModel?.id ?? draftModelId);
    onConfirm({
      routeMode: draftRouteMode,
      modelId: nextModelId,
      quality: normalizedQuality,
      rememberModel,
      rememberQuality,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="max-h-[min(720px,calc(100dvh-32px))] max-w-[520px] overflow-y-auto p-0"
      >
        <div className="space-y-5 p-5">
          <div className="space-y-1 pr-8">
            <DialogTitle className="flex items-center gap-2 tracking-normal">
              {fallback ? (
                <ShieldAlert size={18} className="text-warning" />
              ) : (
                <Sparkles size={18} className="text-brand" />
              )}
              {fallback ? "确认备用图片模型" : "设置本对话的生图"}
            </DialogTitle>
            <DialogDescription>
              {fallback
                ? `${fallback.requested.displayName} 当前不可用，生成前需要确认改用 ${fallback.suggested.displayName}。`
                : "选择图片模型和生成质量。可以只用于本次，也可以记住为后续对话的默认设置。"}
            </DialogDescription>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-text-muted">图片路由</p>
            <Segmented
              aria-label="图片路由"
              value={fallback ? "fixed" : draftRouteMode}
              onChange={(value) => {
                if (fallback) return;
                const next = value as ImageRouteMode;
                setDraftRouteMode(next);
                if (next === "auto") setDraftModelId(AUTO_IMAGE_MODEL_ID);
              }}
              options={[
                { value: "auto", label: "自动选择" },
                { value: "fixed", label: "指定模型" },
              ]}
            />
            <p className="flex items-start gap-1.5 text-[11px] leading-4 text-text-faint">
              <Route size={13} className="mt-0.5 shrink-0" />
              {draftRouteMode === "auto"
                ? `优先使用当前可用的高质量模型，异常时再提示备用路由。当前优先：${automaticModel?.displayName ?? "暂无可用模型"}`
                : "固定使用指定模型；如果提交前检测到不可用，会先征求你的确认再切换。"}
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-text-muted">图片模型</p>
            {draftRouteMode === "auto" && !fallback ? (
              <div className="flex min-h-11 items-center gap-3 rounded-xl border border-brand/40 bg-brand/5 px-3 text-sm">
                <Route size={16} className="shrink-0 text-brand" />
                <span className="min-w-0 flex-1">
                  自动选择 · {automaticModel?.displayName ?? "等待可用模型"}
                </span>
                <Check size={16} className="shrink-0 text-brand" />
              </div>
            ) : (
              <Select
                aria-label="图片模型"
                value={draftModelId}
                onValueChange={setDraftModelId}
                options={orderedModels.map((model) => ({
                  value: model.id,
                  label: `${model.displayName}${model.available ? "" : "（暂不可用）"}`,
                  disabled: !model.available,
                }))}
                controlSize="lg"
              />
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-medium text-text-muted">生成质量</p>
              <span className="text-xs font-medium text-foreground">
                {qualityLabel(normalizedQuality)}
              </span>
            </div>
            <QualitySlider
              options={qualities}
              value={normalizedQuality}
              onChange={setDraftQuality}
              ariaLabel="本对话的图片质量"
            />
          </div>

          <div className="space-y-2 rounded-xl border border-border bg-surface-2/60 p-3">
            <p className="text-xs font-medium text-text-muted">记忆设置</p>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={rememberModel}
                onChange={(event) => setRememberModel(event.target.checked)}
                className="h-4 w-4 accent-[rgb(var(--brand-primary))]"
              />
              <span>记住图片模型</span>
              <span className="ml-auto text-xs text-text-faint">
                {rememberModel ? "后续对话默认使用" : "仅本次对话"}
              </span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={rememberQuality}
                onChange={(event) => setRememberQuality(event.target.checked)}
                className="h-4 w-4 accent-[rgb(var(--brand-primary))]"
              />
              <span>记住生成质量</span>
              <span className="ml-auto text-xs text-text-faint">
                {rememberQuality ? "后续对话默认使用" : "仅本次对话"}
              </span>
            </label>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          {fallback ? (
            <Button
              variant="ghost"
              type="button"
              onClick={() => onOpenChange(false)}
            >
              取消本次生成
            </Button>
          ) : null}
          <Button
            type="button"
            disabled={!activeModel || !activeModel.available}
            onClick={confirm}
          >
            {fallback
              ? `改用 ${activeModel?.displayName ?? "备用模型"}`
              : "应用设置"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
