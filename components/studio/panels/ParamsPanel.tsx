"use client";

import { Button, Input, Textarea } from "@/components/ui";

import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

import { sizeLabel, type DockParams } from "../CommandDock";
import { QualitySlider, qualityLabel } from "../QualitySlider";
import type { ModelInfo } from "../lib/types";
import { resolveGenerationOptions } from "../lib/generation-options";

interface ParamsPanelProps {
  models: ModelInfo[];
  model: ModelInfo | null;
  onSelectModel: (id: string) => void;
  params: DockParams;
  onParamsChange: (patch: Partial<DockParams>) => void;
}

function OptionButton({
  active,
  onClick,
  children,
  className,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Button
      variant="ghost"
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md border px-2 py-1.5 text-left text-[11px] transition-colors",
        active
          ? "border-brand/60 bg-brand/10 text-foreground"
          : "border-border text-text-muted hover:border-border-strong hover:text-foreground",
        className,
      )}
    >
      {children}
    </Button>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-3 py-2.5">
      <p className="mb-2 text-[11px] font-medium text-text-muted">{label}</p>
      {children}
    </div>
  );
}

/** 生成参数面板，与命令坞参数同源。 */
export function ParamsPanel({
  models,
  model,
  onSelectModel,
  params,
  onParamsChange,
}: ParamsPanelProps) {
  const maxN = Math.min(model?.capabilities.maxN ?? 1, 4);
  const {
    sizes,
    size: selectedSize,
    outputFormat: selectedFormat,
  } = resolveGenerationOptions(model, params);
  const qualities = model?.capabilities.qualities ?? [];
  const outputFormats = model?.capabilities.outputFormats ?? [];

  return (
    <div className="h-full divide-y divide-border overflow-y-auto">
      <Section label="模型">
        <div className="flex flex-col gap-1">
          {models.map((item) => (
            <OptionButton
              key={item.id}
              active={item.id === model?.id}
              onClick={() => item.available && onSelectModel(item.id)}
              className={cn(
                "flex items-center justify-between",
                !item.available && "cursor-not-allowed opacity-40",
              )}
            >
              <span className="truncate">{item.displayName}</span>
              {item.id === model?.id ? <Check size={12} /> : null}
            </OptionButton>
          ))}
          {models.length === 0 ? (
            <p className="text-[11px] text-text-faint">加载中…</p>
          ) : null}
        </div>
      </Section>

      <Section label="尺寸">
        <div className="grid grid-cols-2 gap-1">
          {sizes.map((size) => (
            <OptionButton
              key={size}
              active={selectedSize === size}
              onClick={() => onParamsChange({ size })}
            >
              {sizeLabel(size)}
            </OptionButton>
          ))}
        </div>
      </Section>

      {qualities.length > 1 ? (
        <Section label="质量">
          <div className="mb-1.5 text-right text-[11px] font-medium text-foreground">
            {qualityLabel(
              params.quality ??
                model?.defaults.quality ??
                qualities[0] ??
                "auto",
            )}
          </div>
          <QualitySlider
            options={qualities}
            value={
              params.quality ??
              model?.defaults.quality ??
              qualities[0] ??
              "auto"
            }
            onChange={(quality) => onParamsChange({ quality })}
          />
        </Section>
      ) : null}

      <Section label="数量">
        <div className="flex gap-1">
          {Array.from({ length: maxN }).map((_, index) => {
            const value = index + 1;
            return (
              <OptionButton
                key={value}
                active={params.n === value}
                onClick={() => onParamsChange({ n: value })}
                className="h-7 w-9 p-0 text-center"
              >
                {value}
              </OptionButton>
            );
          })}
        </div>
      </Section>

      {model?.capabilities.supportsNegativePrompt ? (
        <Section label="负向提示词">
          <Textarea
            value={params.negativePrompt ?? ""}
            onChange={(event) =>
              onParamsChange({ negativePrompt: event.target.value })
            }
            placeholder="不希望画面中出现的内容"
            className="min-h-20 text-xs"
          />
        </Section>
      ) : null}

      {model?.capabilities.supportsSeed ? (
        <Section label="Seed">
          <Input
            type="number"
            value={params.seed ?? ""}
            onChange={(event) => {
              const value = event.target.value;
              onParamsChange({
                seed: value === "" ? undefined : Number(value),
              });
            }}
            placeholder="留空为随机"
          />
        </Section>
      ) : null}

      {outputFormats.length > 1 ? (
        <Section label="格式">
          <div className="flex gap-1">
            {outputFormats.map((format) => (
              <OptionButton
                key={format}
                active={selectedFormat === format}
                onClick={() => {
                  const next = resolveGenerationOptions(model, {
                    ...params,
                    outputFormat: format,
                  });
                  onParamsChange({
                    outputFormat: next.outputFormat,
                    size: next.size,
                  });
                }}
                className="h-7 px-2.5 uppercase"
              >
                {format.toUpperCase()}
              </OptionButton>
            ))}
          </div>
        </Section>
      ) : null}
    </div>
  );
}
