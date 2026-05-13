"use client";

import type { WorkbenchState } from "@/components/workbench/types";
import { AspectRatioPicker } from "@/components/workbench/AspectRatioPicker";
import { ResolutionPicker } from "@/components/workbench/ResolutionPicker";
import {
  firstSupportedResolutionAspectPair,
  isResolutionAspectRatioSupported,
} from "@/lib/models/capabilities";
import type { PublicModelDefinition } from "@/lib/models/types";
import { cn } from "@/lib/utils";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <p className="field-label">{title}</p>
      {children}
    </section>
  );
}

export function normalizeWorkbenchState(
  modelId: string,
  prev: WorkbenchState,
  models: PublicModelDefinition[],
): WorkbenchState {
  const model = models.find((item) => item.id === modelId && item.available);

  if (!model) {
    return prev;
  }

  const pair = firstSupportedResolutionAspectPair(model, {
    aspectRatio: prev.aspectRatio as never,
    resolution: prev.resolution,
  });

  return {
    ...prev,
    modelId,
    aspectRatio: pair.aspectRatio,
    resolution: pair.resolution,
    n: Math.min(prev.n, model.capabilities.maxN),
    negativePrompt: model.capabilities.supportsNegativePrompt
      ? prev.negativePrompt
      : undefined,
    seed: model.capabilities.supportsSeed ? prev.seed : undefined,
    outputFormat: model.capabilities.outputFormats.includes(prev.outputFormat)
      ? prev.outputFormat
      : model.defaults.outputFormat,
    background: model.capabilities.backgrounds.includes(prev.background)
      ? prev.background
      : model.defaults.background,
    outputCompression:
      model.capabilities.supportsOutputCompression &&
      (prev.outputFormat === "jpeg" || prev.outputFormat === "webp")
        ? prev.outputCompression
        : undefined,
    referenceImageKeys: prev.referenceImageKeys.slice(
      0,
      model.capabilities.maxReferenceImages,
    ),
  };
}

export function DynamicParamsPanel({
  value,
  onChange,
  models,
}: {
  value: WorkbenchState;
  onChange: (next: WorkbenchState) => void;
  models: PublicModelDefinition[];
}) {
  const model = models.find(
    (item) => item.id === value.modelId && item.available,
  );

  if (!model) {
    return (
      <div className="surface-panel p-3">
        <p className="eyebrow">参数</p>
        <p className="mt-2 text-sm leading-6 text-text-muted">
          请选择一个可用模型后再设置生成参数。
        </p>
      </div>
    );
  }

  const { capabilities } = model;
  const availableResolutions = capabilities.resolutions;
  const canCompress =
    capabilities.supportsOutputCompression &&
    (value.outputFormat === "jpeg" || value.outputFormat === "webp");

  return (
    <div className="border-t border-border px-3 pb-3 pt-1">
      <div className="space-y-4">
        <Section title="比例">
          <AspectRatioPicker
            options={capabilities.aspectRatios}
            value={value.aspectRatio}
            disabledOptions={capabilities.aspectRatios.filter(
              (aspectRatio) =>
                !isResolutionAspectRatioSupported(
                  capabilities,
                  value.resolution,
                  aspectRatio,
                ),
            )}
            onChange={(aspectRatio) => {
              const pair = firstSupportedResolutionAspectPair(model, {
                aspectRatio: aspectRatio as never,
                resolution: value.resolution,
              });

              onChange({
                ...value,
                aspectRatio: pair.aspectRatio,
                resolution: pair.resolution,
              });
            }}
          />
        </Section>

        <Section title="分辨率">
          <ResolutionPicker
            options={availableResolutions}
            value={value.resolution}
            disabledOptions={availableResolutions.filter(
              (resolution) =>
                !isResolutionAspectRatioSupported(
                  capabilities,
                  resolution,
                  value.aspectRatio as never,
                ),
            )}
            onChange={(resolution) =>
              onChange({ ...value, resolution: resolution as never })
            }
          />
        </Section>

        <Section title="张数">
          <div className="flex items-center justify-between rounded-[6px] border border-border bg-surface-2/55 px-2 py-1.5">
            <button
              type="button"
              className="h-8 w-8 rounded-[6px] border border-border transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40"
              onClick={() =>
                onChange({ ...value, n: Math.max(1, value.n - 1) })
              }
              disabled={value.n <= 1}
              aria-label="减少张数"
            >
              -
            </button>
            <span className="font-mono text-sm" aria-live="polite">
              {value.n}
            </span>
            <button
              type="button"
              className="h-8 w-8 rounded-[6px] border border-border transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40"
              onClick={() =>
                onChange({
                  ...value,
                  n: Math.min(capabilities.maxN, value.n + 1),
                })
              }
              disabled={value.n >= capabilities.maxN}
              aria-label="增加张数"
            >
              +
            </button>
          </div>
        </Section>

        {capabilities.outputFormats.length > 1 ? (
          <Section title="格式">
            <div className="grid grid-cols-3 gap-2">
              {capabilities.outputFormats.map((format) => (
                <button
                  key={format}
                  type="button"
                  className={cn(
                    "selection-card rounded-[10px] border px-3 py-2.5 font-mono text-sm",
                    value.outputFormat === format &&
                      "selection-card-active text-foreground",
                  )}
                  aria-pressed={value.outputFormat === format}
                  onClick={() =>
                    onChange({
                      ...value,
                      outputFormat: format,
                      background:
                        value.background === "transparent" && format === "jpeg"
                          ? "auto"
                          : value.background,
                      outputCompression:
                        format === "jpeg" || format === "webp"
                          ? (value.outputCompression ?? 100)
                          : undefined,
                    })
                  }
                >
                  {format.toUpperCase()}
                </button>
              ))}
            </div>
          </Section>
        ) : null}

        {capabilities.backgrounds.length > 1 ? (
          <Section title="背景">
            <div className="grid grid-cols-3 gap-2">
              {capabilities.backgrounds.map((background) => {
                const disabled =
                  background === "transparent" && value.outputFormat === "jpeg";

                return (
                  <button
                    key={background}
                    type="button"
                    className={cn(
                      "selection-card rounded-[10px] border px-3 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-40",
                      value.background === background &&
                        "selection-card-active text-foreground",
                    )}
                    disabled={disabled}
                    aria-pressed={value.background === background}
                    onClick={() => onChange({ ...value, background })}
                  >
                    {background === "auto"
                      ? "自动"
                      : background === "opaque"
                        ? "不透明"
                        : "透明"}
                  </button>
                );
              })}
            </div>
          </Section>
        ) : null}

        {canCompress ? (
          <Section title="压缩">
            <div className="flex items-center gap-3 rounded-[6px] border border-border bg-surface-2/55 px-3 py-2">
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={value.outputCompression ?? 100}
                className="w-full accent-foreground"
                onChange={(event) =>
                  onChange({
                    ...value,
                    outputCompression: Number(event.target.value),
                  })
                }
                aria-label="输出压缩率"
              />
              <span className="w-10 text-right font-mono text-sm">
                {value.outputCompression ?? 100}
              </span>
            </div>
          </Section>
        ) : null}
      </div>
    </div>
  );
}
