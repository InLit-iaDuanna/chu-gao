"use client";

import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";

import { ImageGallery } from "@/components/workbench/ImageGallery";
import type { GalleryImage } from "@/components/workbench/gallery-images";
import { cn } from "@/lib/utils";

interface GenerationStageProps {
  status: string;
  progress: number | null;
  images: GalleryImage[];
  selectedImageId: string | null;
  onSelectedImageIdChange: (imageId: string | null) => void;
  aspect: { w: number; h: number };
  error: string | null;
  isBusy: boolean;
  prompt: string | null;
}

export function GenerationStage({
  status,
  progress,
  images,
  selectedImageId,
  onSelectedImageIdChange,
  aspect,
  error,
  isBusy,
  prompt,
}: GenerationStageProps): React.ReactElement {
  const viewable = images.filter((i) => i.src ?? i.url);
  const selectedIndex = Math.max(
    viewable.findIndex((image) => image.id && image.id === selectedImageId),
    0,
  );
  const ratio = aspect.w / aspect.h;
  const maxStageVh = ratio > 1.4 ? 42 : ratio < 0.8 ? 42 : 46;
  const maxStageWidth = ratio > 1.4 ? 860 : 680;
  const useGridGallery = viewable.length > 1;
  const aspectStyle = {
    aspectRatio: useGridGallery ? "16 / 10" : `${aspect.w} / ${aspect.h}`,
    width: useGridGallery
      ? "min(100%, 900px, 74vw)"
      : `min(100%, ${maxStageWidth}px, ${Math.round(maxStageVh * ratio)}vh)`,
  };
  const srStatus = stageStatusText(status, progress, error);

  return (
    <div className="relative flex w-full items-center justify-center">
      <span role="status" aria-live="polite" className="sr-only">
        {viewable.length === 0
          ? `${srStatus.title}。${srStatus.desc}`
          : status === "running"
            ? `生成中。${srStatus.desc}`
            : status === "failed"
              ? `任务没有完成。${error ?? "调整描述后再试一次。"}`
              : status === "canceled"
                ? "任务已取消。"
                : "已生成结果。"}
      </span>
      <div
        aria-hidden
        className="absolute inset-x-12 -bottom-4 h-12 rounded-full bg-[rgb(var(--brand-primary)/0.1)] blur-2xl"
      />
      <div
        aria-busy={isBusy}
        className={cn(
          "relative w-full overflow-hidden rounded-[20px] border bg-surface/40 shadow-[inset_0_1px_0_rgb(255_255_255/0.05),var(--shadow-lg)]",
          viewable.length === 0
            ? "border-dashed border-ink/[0.16]"
            : "border-ink/[0.09]",
          isBusy && "motion-safe:animate-pulse motion-reduce:animate-none",
        )}
        style={aspectStyle}
      >
        {viewable.length === 0 ? (
          <>
            <div
              aria-hidden
              className="absolute left-2 top-2 h-2 w-2 rounded-sm bg-text-faint opacity-40"
            />
            <div
              aria-hidden
              className="absolute right-2 top-2 h-2 w-2 rounded-sm bg-text-faint opacity-40"
            />
            <div
              aria-hidden
              className="absolute bottom-2 left-2 h-2 w-2 rounded-sm bg-text-faint opacity-40"
            />
            <div
              aria-hidden
              className="absolute bottom-2 right-2 h-2 w-2 rounded-sm bg-text-faint opacity-40"
            />
          </>
        ) : null}

        {viewable.length === 0 ? (
          <StageEmpty
            status={status}
            error={error}
            progress={progress}
            aspect={aspect}
          />
        ) : (
          <div className="img-reveal absolute inset-0">
            <ImageGallery
              images={viewable}
              alt={stageImageAlt(prompt)}
              selectedIndex={selectedIndex}
              onSelectedIndexChange={(index) =>
                onSelectedImageIdChange(viewable[index]?.id ?? null)
              }
              statusLabel={
                status === "running"
                  ? "生成中"
                  : status === "failed"
                    ? "失败"
                    : status === "canceled"
                      ? "已取消"
                      : "已完成"
              }
              variant={useGridGallery ? "grid" : "single"}
            />
          </div>
        )}

        {isBusy ? <EdgeProgress progress={progress} /> : null}
      </div>
    </div>
  );
}

function StageEmpty({
  status,
  error,
  progress,
  aspect,
}: {
  status: string;
  error: string | null;
  progress: number | null;
  aspect: { w: number; h: number };
}): React.ReactElement {
  const isPending = status === "pending";
  const isRunning = status === "running";
  const isFailed = status === "failed";

  const { label, title, desc } = stageStatusText(status, progress, error);
  const skeletonStyle = {
    aspectRatio: `${aspect.w} / ${aspect.h}`,
  };

  return (
    <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background: isFailed
            ? "linear-gradient(135deg, rgb(var(--surface)) 0%, rgb(var(--surface-2)) 100%)"
            : isRunning || isPending
              ? "linear-gradient(135deg, rgb(var(--surface)) 0%, rgb(var(--surface-2)) 50%, rgb(var(--surface)) 100%)"
              : "linear-gradient(135deg, rgb(var(--surface)) 0%, rgb(var(--surface-2)) 100%)",
        }}
      />

      <svg
        aria-hidden
        className="absolute inset-0 h-full w-full"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="shape-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop
              offset="0%"
              style={{
                stopColor: isFailed
                  ? "rgb(var(--danger))"
                  : "rgb(var(--brand-primary))",
                stopOpacity: 0.16,
              }}
            />
            <stop offset="100%" style={{ stopColor: "transparent" }} />
          </linearGradient>
        </defs>

        <circle
          cx="20%"
          cy="30%"
          r="180"
          fill="url(#shape-grad)"
          opacity={isRunning || isPending ? 0.18 : 0.08}
          className={
            isRunning || isPending
              ? "motion-safe:animate-pulse motion-reduce:animate-none"
              : ""
          }
        />

        <rect
          x="60%"
          y="50%"
          width="200"
          height="120"
          fill="rgb(var(--foreground))"
          opacity={0.04}
          transform="rotate(-12 70 60)"
        />

        <polygon
          points="85,15 100,45 70,45"
          fill="rgb(var(--cyan))"
          opacity={0.08}
          transform="translate(65%, 70%) scale(2.5)"
        />

        <circle
          cx="75%"
          cy="20%"
          r="80"
          fill="rgb(var(--brand-primary))"
          opacity={0.07}
        />
      </svg>

      {isRunning || isPending ? (
        <div
          aria-hidden
          className="absolute inset-0 overflow-hidden"
          style={{
            background:
              "linear-gradient(90deg, transparent 0%, rgb(var(--brand-primary) / 0.14) 50%, transparent 100%)",
            animation: "shimmer 2s infinite linear",
          }}
        />
      ) : null}

      <div className="relative z-10 max-w-md px-8 text-center">
        <div className="mb-4 flex items-center justify-center gap-2">
          {isRunning || isPending ? (
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.3 }}
            >
              <Sparkles
                size={18}
                strokeWidth={1.5}
                className="text-brand motion-safe:animate-pulse motion-reduce:animate-none"
              />
            </motion.div>
          ) : null}
          <p className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-text-faint">
            {label}
          </p>
        </div>

        <h3 className="font-serif text-[26px] leading-tight tracking-[-0.015em] text-foreground">
          {title}
        </h3>
        <p className="mt-4 text-[14px] leading-relaxed text-text-muted">
          {desc}
        </p>

        {isRunning || isPending ? (
          <div className="mt-8 flex justify-center gap-3">
            <div
              className="w-16 rounded-lg bg-foreground/[0.08] motion-safe:animate-pulse motion-reduce:animate-none sm:w-20"
              style={{ ...skeletonStyle, animationDelay: "0ms" }}
            />
            <div
              className="w-24 rounded-lg bg-foreground/[0.08] motion-safe:animate-pulse motion-reduce:animate-none sm:w-32"
              style={{ ...skeletonStyle, animationDelay: "150ms" }}
            />
            <div
              className="w-20 rounded-lg bg-foreground/[0.08] motion-safe:animate-pulse motion-reduce:animate-none sm:w-28"
              style={{ ...skeletonStyle, animationDelay: "300ms" }}
            />
          </div>
        ) : null}
      </div>

      <style jsx>{`
        @keyframes shimmer {
          0% {
            transform: translateX(-100%);
          }
          100% {
            transform: translateX(100%);
          }
        }
      `}</style>
    </div>
  );
}

function stageHint(progress: number | null): string {
  if (progress === null) return "正在编译提示词";
  if (progress < 0.25) return "正在编译提示词";
  if (progress < 0.6) return "正在调用渠道";
  if (progress < 0.92) return "正在渲染画面";
  return "即将完成";
}

function stageStatusText(
  status: string,
  progress: number | null,
  error: string | null,
): { label: string; title: string; desc: string } {
  if (status === "pending") {
    return { label: "排队中", title: "已加入队列", desc: "任务即将开始，请稍候。" };
  }
  if (status === "running") {
    return {
      label: "生成中",
      title: stageHint(progress),
      desc: "完成后会自动展示在这里。",
    };
  }
  if (status === "failed") {
    return {
      label: "失败",
      title: "任务没有完成",
      desc: error ?? "调整描述后再试一次。",
    };
  }
  if (status === "canceled") {
    return {
      label: "已取消",
      title: "任务已取消",
      desc: "如果尚未开始，点数会退回账户余额。",
    };
  }
  return {
    label: "画布",
    title: "等待你的第一句话",
    desc: "在下方输入你想要的画面。可以描述目标、风格、构图，或要避开的内容。",
  };
}

export function stageImageAlt(prompt: string | null): string {
  const trimmed = prompt?.trim();
  if (!trimmed) return "生成结果";
  const max = 80;
  const snippet =
    trimmed.length > max ? `${trimmed.slice(0, max).trimEnd()}…` : trimmed;
  return `生成结果：${snippet}`;
}

function EdgeProgress({
  progress,
}: {
  progress: number | null;
}): React.ReactElement {
  const pct = Math.max(0.05, Math.min(progress ?? 0.15, 0.99));
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 rounded-2xl"
      style={{
        background: `conic-gradient(from -90deg, rgb(var(--brand-primary) / 0.85) ${pct * 360}deg, transparent ${pct * 360}deg)`,
        WebkitMask:
          "linear-gradient(#000, #000) content-box, linear-gradient(#000, #000)",
        WebkitMaskComposite: "xor",
        maskComposite: "exclude",
        padding: "2px",
      }}
    />
  );
}
