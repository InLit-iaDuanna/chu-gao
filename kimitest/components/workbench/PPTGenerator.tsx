"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Presentation,
  Loader2,
  Download,
  RefreshCw,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Sparkles,
  FileText,
  ImagePlus,
  Paperclip,
  X,
} from "lucide-react";

import { Button, Textarea } from "@/components/ui";
import { estimateCost } from "@/lib/credits";
import type { PublicModelDefinition } from "@/lib/models/types";
import type { PPTGeneration, PPTSlide } from "@/lib/ppt-generator";
import { MAX_PPT_SLIDES } from "@/lib/ppt-generator";
import { cn } from "@/lib/utils";

interface PPTGeneratorProps {
  models: PublicModelDefinition[];
  selectedModelId: string;
  credits: number;
  conversationId?: string;
  onGenerationComplete?: (pptId: string) => void;
}

interface PageDraft {
  id: string;
  variablePrompt: string;
}

interface PPTReferenceImage {
  key: string;
  name: string;
  previewUrl: string;
  width: number;
  height: number;
}

interface PPTReferenceDocument {
  id: string;
  name: string;
  content: string;
}

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const TEXT_FILE_EXTENSIONS = [".txt", ".md", ".csv", ".json"];
const MAX_REFERENCE_TEXT_LENGTH = 4000;

let draftCounter = 0;
function newPage(prompt = ""): PageDraft {
  draftCounter += 1;
  return { id: `page-${draftCounter}`, variablePrompt: prompt };
}

const STATUS_LABELS: Record<PPTSlide["status"], string> = {
  pending: "等待中",
  enhancing: "优化提示词…",
  generating: "生成中…",
  completed: "已完成",
  failed: "失败",
};

const STATUS_COLORS: Record<PPTSlide["status"], string> = {
  pending: "text-text-faint",
  enhancing: "text-info",
  generating: "text-warning",
  completed: "text-success",
  failed: "text-danger",
};

export function PPTGenerator({
  models,
  selectedModelId,
  credits,
  conversationId,
  onGenerationComplete,
}: PPTGeneratorProps) {
  const [fixedPrompt, setFixedPrompt] = useState("");
  const [referenceImages, setReferenceImages] = useState<PPTReferenceImage[]>(
    [],
  );
  const [referenceDocuments, setReferenceDocuments] = useState<
    PPTReferenceDocument[]
  >([]);
  const [isUploadingReferences, setIsUploadingReferences] = useState(false);
  const [pages, setPages] = useState<PageDraft[]>([newPage()]);
  const [currentPPT, setCurrentPPT] = useState<PPTGeneration | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const triggeredRef = useRef<Set<string>>(new Set());
  const referenceInputRef = useRef<HTMLInputElement | null>(null);

  const selectedModel = models.find((m) => m.id === selectedModelId);

  const perSlideCost = selectedModel
    ? estimateCost(selectedModel, {
        n: 1,
        resolution: "2K",
        aspectRatio: "16:9",
        outputFormat: selectedModel.defaults.outputFormat,
        background: selectedModel.defaults.background,
        usesReference: referenceImages.length > 0,
      })
    : 0;

  const validPages = pages.filter((p) => p.variablePrompt.trim());
  const estimatedCost = perSlideCost * validPages.length;
  const hasInsufficientCredits = estimatedCost > credits;
  const documentPrompt = referenceDocuments
    .map((document) => `[参考文件：${document.name}]\n${document.content}`)
    .join("\n\n");
  const effectiveFixedPrompt = [fixedPrompt.trim(), documentPrompt]
    .filter(Boolean)
    .join("\n\n");
  const isFixedPromptTooLong =
    effectiveFixedPrompt.length > MAX_REFERENCE_TEXT_LENGTH;

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const removeReferenceImage = (key: string) => {
    setReferenceImages((current) => {
      const removed = current.find((image) => image.key === key);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return current.filter((image) => image.key !== key);
    });
  };

  const removeReferenceDocument = (id: string) =>
    setReferenceDocuments((current) =>
      current.filter((document) => document.id !== id),
    );

  const handleReferenceFiles = async (files: File[]) => {
    if (!selectedModel || files.length === 0 || currentPPT) return;

    setIsUploadingReferences(true);
    setError(null);

    try {
      const imageFiles = files.filter((file) => IMAGE_TYPES.has(file.type));
      const textFiles = files.filter((file) =>
        TEXT_FILE_EXTENSIONS.some((extension) =>
          file.name.toLowerCase().endsWith(extension),
        ),
      );
      const unsupportedCount =
        files.length - imageFiles.length - textFiles.length;

      if (
        imageFiles.length > 0 &&
        !selectedModel.capabilities.supportsReferenceImage
      ) {
        throw new Error("当前模型不支持图片参考。");
      }

      const remainingImageSlots = Math.max(
        0,
        selectedModel.capabilities.maxReferenceImages - referenceImages.length,
      );
      const uploadableImages = imageFiles.slice(0, remainingImageSlots);

      for (const file of uploadableImages) {
        const formData = new FormData();
        formData.append("file", file);
        const response = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });
        const payload = (await response.json().catch(() => null)) as {
          data?: { key: string; width: number; height: number };
          error?: { message?: string };
        } | null;

        if (!response.ok || !payload?.data) {
          throw new Error(payload?.error?.message ?? `上传 ${file.name} 失败`);
        }

        setReferenceImages((current) => [
          ...current,
          {
            ...payload.data!,
            name: file.name,
            previewUrl: URL.createObjectURL(file),
          },
        ]);
      }

      const remainingTextLength = Math.max(
        0,
        MAX_REFERENCE_TEXT_LENGTH - effectiveFixedPrompt.length,
      );
      let consumedTextLength = 0;
      const documents: PPTReferenceDocument[] = [];
      for (const file of textFiles) {
        if (file.size > 1024 * 1024) {
          throw new Error(`${file.name} 超过 1MB，请精简后上传。`);
        }
        const content = (await file.text()).trim();
        const allowance = Math.max(0, remainingTextLength - consumedTextLength);
        if (!content || allowance === 0) continue;
        const clipped = content.slice(0, allowance);
        consumedTextLength += clipped.length + file.name.length + 10;
        documents.push({
          id: `${Date.now()}-${file.name}-${documents.length}`,
          name: file.name,
          content: clipped,
        });
      }
      if (documents.length) {
        setReferenceDocuments((current) => [...current, ...documents]);
      }

      if (imageFiles.length > uploadableImages.length) {
        setError(
          `参考图最多 ${selectedModel.capabilities.maxReferenceImages} 张。`,
        );
      } else if (unsupportedCount > 0) {
        setError("部分文件格式不支持，请上传图片或 TXT、MD、CSV、JSON 文件。");
      }
    } catch (uploadError) {
      setError(
        uploadError instanceof Error ? uploadError.message : "参考素材上传失败",
      );
    } finally {
      setIsUploadingReferences(false);
      if (referenceInputRef.current) referenceInputRef.current.value = "";
    }
  };

  // 编辑器操作 ----------------------------------------------------------
  const addPage = () =>
    setPages((current) =>
      current.length >= MAX_PPT_SLIDES ? current : [...current, newPage()],
    );
  const removePage = (id: string) =>
    setPages((current) =>
      current.length <= 1 ? current : current.filter((p) => p.id !== id),
    );
  const duplicatePage = (id: string) =>
    setPages((current) => {
      const idx = current.findIndex((p) => p.id === id);
      if (idx < 0 || current.length >= MAX_PPT_SLIDES) return current;
      const copy = newPage(current[idx].variablePrompt);
      return [...current.slice(0, idx + 1), copy, ...current.slice(idx + 1)];
    });
  const movePage = (id: string, dir: -1 | 1) =>
    setPages((current) => {
      const idx = current.findIndex((p) => p.id === id);
      const target = idx + dir;
      if (idx < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  const updatePagePrompt = (id: string, value: string) =>
    setPages((current) =>
      current.map((p) => (p.id === id ? { ...p, variablePrompt: value } : p)),
    );

  // 生成 ----------------------------------------------------------------
  const triggerSlide = useCallback(
    async (pptId: string, slideId: string, variablePrompt?: string) => {
      triggeredRef.current.add(slideId);
      try {
        await fetch("/api/ppt/generate-slide", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pptId, slideId, variablePrompt }),
        });
      } catch {
        triggeredRef.current.delete(slideId);
      }
    },
    [],
  );

  const pollStatus = useCallback(
    (pptId: string) => {
      stopPolling();
      pollRef.current = setInterval(async () => {
        try {
          const response = await fetch(`/api/ppt/generate?id=${pptId}`);
          if (!response.ok) return;

          const { data } = (await response.json()) as { data: PPTGeneration };
          setCurrentPPT(data);

          // 触发尚未开始的页面（每轮最多 3 个，避免过载）。
          const toStart = data.slides
            .filter(
              (s) =>
                s.status === "pending" &&
                !s.generationId &&
                !triggeredRef.current.has(s.id),
            )
            .slice(0, 3);
          for (const slide of toStart) {
            void triggerSlide(pptId, slide.id);
          }

          const allDone = data.slides.every(
            (s) => s.status === "completed" || s.status === "failed",
          );
          if (allDone && data.slides.length > 0) {
            stopPolling();
            if (data.slides.some((s) => s.status === "completed")) {
              onGenerationComplete?.(pptId);
            }
          }
        } catch {
          // 忽略单次轮询错误，下次继续。
        }
      }, 2000);
    },
    [onGenerationComplete, stopPolling, triggerSlide],
  );

  const handleGenerateAll = async () => {
    if (
      !selectedModel ||
      hasInsufficientCredits ||
      isFixedPromptTooLong ||
      validPages.length === 0
    ) {
      return;
    }

    setIsCreating(true);
    setError(null);
    triggeredRef.current = new Set();

    try {
      const response = await fetch("/api/ppt/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelId: selectedModelId,
          fixedPrompt: effectiveFixedPrompt,
          referenceImageKeys: referenceImages.map((image) => image.key),
          conversationId,
          slides: validPages.map((p) => ({
            variablePrompt: p.variablePrompt.trim(),
          })),
        }),
      });

      const payload = (await response.json().catch(() => null)) as {
        data?: PPTGeneration;
        error?: { message?: string };
      } | null;

      if (!response.ok || !payload?.data) {
        throw new Error(payload?.error?.message ?? "PPT 创建失败");
      }

      setCurrentPPT(payload.data);
      pollStatus(payload.data.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "PPT 创建失败");
    } finally {
      setIsCreating(false);
    }
  };

  const handleRegenerate = async (slide: PPTSlide) => {
    if (!currentPPT) return;
    triggeredRef.current.delete(slide.id);
    await triggerSlide(currentPPT.id, slide.id, slide.variablePrompt);
    pollStatus(currentPPT.id);
  };

  const updateSlidePrompt = (slideId: string, value: string) => {
    setCurrentPPT((current) =>
      current
        ? {
            ...current,
            slides: current.slides.map((s) =>
              s.id === slideId ? { ...s, variablePrompt: value } : s,
            ),
          }
        : current,
    );
  };

  const handleExport = async () => {
    if (!currentPPT) return;
    setIsExporting(true);
    try {
      const response = await fetch(`/api/ppt/export?id=${currentPPT.id}`);
      if (!response.ok) throw new Error("导出失败");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(currentPPT.title ?? "presentation").replace(/\s+/g, "_")}_PPT.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      setError("导出失败，请重试");
    } finally {
      setIsExporting(false);
    }
  };

  const resetToEditor = () => {
    stopPolling();
    triggeredRef.current = new Set();
    setCurrentPPT(null);
    setError(null);
  };

  const completedCount =
    currentPPT?.slides.filter((s) => s.status === "completed").length ?? 0;
  const totalCount = currentPPT?.slides.length ?? 0;
  const allDone =
    !!currentPPT &&
    totalCount > 0 &&
    currentPPT.slides.every(
      (s) => s.status === "completed" || s.status === "failed",
    );

  return (
    <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
      {/* 侧边栏：不变提示词 + 操作 */}
      <aside className="lg:sticky lg:top-4 h-fit space-y-4">
        <div className="surface-panel p-5">
          <div className="mb-4 flex items-center gap-2.5">
            <Presentation className="h-5 w-5 text-foreground" />
            <h2 className="text-lg font-semibold">PPT 生成器</h2>
          </div>

          <label className="field-label mb-1.5 flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5" />
            不变提示词（整套统一风格）
          </label>
          <Textarea
            value={fixedPrompt}
            onChange={(e) => setFixedPrompt(e.target.value)}
            placeholder="例如：极简商务风格，深蓝白配色，无衬线字体，大量留白，16:9"
            rows={5}
            maxLength={4000}
            disabled={!!currentPPT}
            className="min-h-28 text-sm"
          />
          <p className="mt-1.5 text-xs leading-5 text-text-muted">
            应用到每一页，确保整套幻灯片风格统一。
          </p>

          <input
            ref={referenceInputRef}
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp,.txt,.md,.csv,.json"
            className="sr-only"
            disabled={!!currentPPT || isUploadingReferences}
            onChange={(event) => {
              void handleReferenceFiles(Array.from(event.target.files ?? []));
            }}
          />
          <Button
            variant="secondary"
            size="sm"
            className="mt-3 w-full"
            onClick={() => referenceInputRef.current?.click()}
            loading={isUploadingReferences}
            disabled={!!currentPPT || isUploadingReferences}
            leftIcon={<Paperclip className="h-3.5 w-3.5" />}
          >
            添加文件或图片参考
          </Button>

          {referenceImages.length || referenceDocuments.length ? (
            <div className="mt-3 grid grid-cols-3 gap-2">
              {referenceImages.map((image) => (
                <div
                  key={image.key}
                  className="group relative aspect-square overflow-hidden rounded-[6px] border border-border bg-surface-2"
                  title={`${image.name} · ${image.width}×${image.height}`}
                >
                  <img
                    src={image.previewUrl}
                    alt={image.name}
                    className="h-full w-full object-cover"
                  />
                  {!currentPPT ? (
                    <button
                      type="button"
                      onClick={() => removeReferenceImage(image.key)}
                      className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded bg-background/85 text-text-muted opacity-0 shadow-sm transition-opacity hover:text-danger group-hover:opacity-100"
                      aria-label={`移除 ${image.name}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  ) : null}
                  <ImagePlus className="absolute bottom-1 left-1 h-3.5 w-3.5 text-white drop-shadow" />
                </div>
              ))}
              {referenceDocuments.map((document) => (
                <div
                  key={document.id}
                  className="group relative flex aspect-square min-w-0 flex-col items-center justify-center gap-1 rounded-[6px] border border-border bg-surface-2 p-2 text-center"
                  title={document.name}
                >
                  <FileText className="h-5 w-5 text-text-muted" />
                  <span className="line-clamp-2 break-all text-[10px] leading-3 text-text-faint">
                    {document.name}
                  </span>
                  {!currentPPT ? (
                    <button
                      type="button"
                      onClick={() => removeReferenceDocument(document.id)}
                      className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded bg-background/85 text-text-muted opacity-0 shadow-sm transition-opacity hover:text-danger group-hover:opacity-100"
                      aria-label={`移除 ${document.name}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {isFixedPromptTooLong ? (
            <p className="mt-2 text-xs leading-5 text-danger">
              不变提示词和参考文件内容合计不能超过 4000 字。
            </p>
          ) : null}

          <div className="mt-4 rounded-[8px] border border-border bg-surface-2 p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-text-muted">预计消耗</span>
              <span className="font-semibold">{estimatedCost} 点</span>
            </div>
            <div className="mt-1.5 flex items-center justify-between text-xs">
              <span className="text-text-faint">
                {validPages.length} 页 ·{" "}
                {selectedModel?.displayName ?? "无模型"}
              </span>
              <span
                className={
                  hasInsufficientCredits ? "text-danger" : "text-text-muted"
                }
              >
                余额 {credits}
              </span>
            </div>
          </div>

          {!currentPPT ? (
            <Button
              variant="primary"
              className="mt-4 w-full"
              onClick={handleGenerateAll}
              loading={isCreating}
              disabled={
                !selectedModel ||
                hasInsufficientCredits ||
                isFixedPromptTooLong ||
                validPages.length === 0
              }
              leftIcon={<Presentation className="h-4 w-4" />}
            >
              生成全部 {validPages.length} 页
            </Button>
          ) : (
            <div className="mt-4 space-y-2">
              <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full bg-foreground transition-all duration-500"
                  style={{ width: `${currentPPT.progress}%` }}
                />
              </div>
              <p className="text-center text-xs text-text-muted">
                {completedCount} / {totalCount} 完成
              </p>
              <Button
                variant="primary"
                className="w-full"
                onClick={handleExport}
                loading={isExporting}
                disabled={completedCount === 0}
                leftIcon={<Download className="h-4 w-4" />}
              >
                导出 ZIP
              </Button>
              <Button
                variant="ghost"
                className="w-full"
                onClick={resetToEditor}
                disabled={!allDone && completedCount < totalCount}
              >
                新建一套
              </Button>
            </div>
          )}

          {hasInsufficientCredits && !currentPPT ? (
            <p className="mt-2 text-center text-sm text-danger">余额不足</p>
          ) : null}
          {error ? (
            <p className="mt-2 text-center text-sm text-danger">{error}</p>
          ) : null}
        </div>
      </aside>

      {/* 主区：页面卡片 */}
      <div className="space-y-4">
        {!currentPPT ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {pages.map((page, index) => (
                <EditorCard
                  key={page.id}
                  index={index}
                  total={pages.length}
                  value={page.variablePrompt}
                  onChange={(v) => updatePagePrompt(page.id, v)}
                  onRemove={() => removePage(page.id)}
                  onDuplicate={() => duplicatePage(page.id)}
                  onMoveUp={() => movePage(page.id, -1)}
                  onMoveDown={() => movePage(page.id, 1)}
                />
              ))}
              {pages.length < MAX_PPT_SLIDES ? (
                <button
                  type="button"
                  onClick={addPage}
                  className="flex aspect-video flex-col items-center justify-center gap-2 rounded-[12px] border border-dashed border-ink/[0.16] text-text-muted transition-colors hover:border-[rgb(var(--brand-primary))]/50 hover:text-foreground"
                >
                  <Plus className="h-6 w-6" />
                  <span className="text-sm">添加页面</span>
                </button>
              ) : null}
            </div>
          </>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {currentPPT.slides.map((slide) => (
              <ResultCard
                key={slide.id}
                slide={slide}
                onPromptChange={(v) => updateSlidePrompt(slide.id, v)}
                onRegenerate={() => handleRegenerate(slide)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface EditorCardProps {
  index: number;
  total: number;
  value: string;
  onChange: (value: string) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

function EditorCard({
  index,
  total,
  value,
  onChange,
  onRemove,
  onDuplicate,
  onMoveUp,
  onMoveDown,
}: EditorCardProps) {
  return (
    <div className="group surface-panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-medium text-text-muted">
          第 {index + 1} 页
        </span>
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={index === 0}
            className="rounded p-1 text-text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-30"
            aria-label="上移"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={index === total - 1}
            className="rounded p-1 text-text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-30"
            aria-label="下移"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onDuplicate}
            className="rounded p-1 text-text-muted hover:bg-surface-2 hover:text-foreground"
            aria-label="复制"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onRemove}
            disabled={total <= 1}
            className="rounded p-1 text-text-muted hover:bg-surface-2 hover:text-danger disabled:opacity-30"
            aria-label="删除"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="这一页的内容（变的提示词），例如：封面 — 标题「2025 产品战略」，副标题与日期"
        className="h-32 w-full resize-none bg-transparent p-3 text-sm leading-6 outline-none placeholder:text-text-faint"
      />
    </div>
  );
}

interface ResultCardProps {
  slide: PPTSlide;
  onPromptChange: (value: string) => void;
  onRegenerate: () => void;
}

function ResultCard({ slide, onPromptChange, onRegenerate }: ResultCardProps) {
  const [zoomed, setZoomed] = useState(false);
  const isBusy = slide.status === "generating" || slide.status === "enhancing";

  return (
    <>
      <div className="surface-panel overflow-hidden">
        <div className="relative aspect-video bg-surface-2">
          {slide.imageUrl ? (
            <img
              src={slide.thumbnailUrl || slide.imageUrl}
              alt={`第 ${slide.index + 1} 页`}
              className="h-full w-full cursor-zoom-in object-contain"
              onClick={() => setZoomed(true)}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              {isBusy ? (
                <Loader2 className="h-7 w-7 animate-spin text-text-faint" />
              ) : (
                <Presentation className="h-7 w-7 text-text-faint" />
              )}
            </div>
          )}
          <span className="absolute left-2 top-2 rounded-full bg-background/80 px-2 py-0.5 text-[11px] font-medium">
            第 {slide.index + 1} 页
          </span>
        </div>
        <div className="space-y-2 p-3">
          <div className="flex items-center justify-between">
            <span className={cn("text-xs", STATUS_COLORS[slide.status])}>
              {STATUS_LABELS[slide.status]}
            </span>
          </div>
          <textarea
            value={slide.variablePrompt}
            onChange={(e) => onPromptChange(e.target.value)}
            className="h-16 w-full resize-none rounded-[6px] border border-border bg-surface px-2.5 py-2 text-xs leading-5 outline-none focus:border-foreground"
          />
          <Button
            variant="secondary"
            size="sm"
            className="w-full"
            onClick={onRegenerate}
            disabled={isBusy}
            leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
          >
            {slide.imageUrl ? "重新生成此页" : "生成此页"}
          </Button>
          {slide.error ? (
            <p className="text-xs text-danger">{slide.error}</p>
          ) : null}
        </div>
      </div>

      {zoomed && slide.imageUrl ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          onClick={() => setZoomed(false)}
        >
          <img
            src={slide.imageUrl}
            alt={`第 ${slide.index + 1} 页`}
            className="max-h-full max-w-full object-contain"
          />
        </div>
      ) : null}
    </>
  );
}
