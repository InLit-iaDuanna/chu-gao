"use client";

import { Button } from "@/components/ui";

import { Input, Select, Textarea } from "@/components/ui";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Download,
  List,
  Loader2,
  Plus,
  RefreshCw,
  Share2,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";

import {
  createPpt,
  enhancePptPrompt,
  generatePptSlide,
  getPpt,
  isApiError,
  listModels,
  listPpts,
  pptExportUrl,
} from "../lib/api";
import type {
  ModelInfo,
  PptGeneration,
  PptSlide,
  PptSlideStatus,
  PptStatus,
} from "../lib/types";
import { pptPublishHref } from "./ppt-publish";

const SLIDE_STATUS_LABEL: Record<PptSlideStatus, string> = {
  pending: "等待生成",
  enhancing: "增强中",
  generating: "生成中",
  completed: "已完成",
  failed: "失败",
};

const DECK_STATUS_LABEL: Record<PptStatus, string> = {
  preparing: "准备中",
  enhancing: "增强中",
  generating: "生成中",
  completed: "已完成",
  failed: "失败",
};

function slideIsActive(slide: PptSlide): boolean {
  return slide.status === "generating" || slide.status === "enhancing";
}

export function PptStudio() {
  const [decks, setDecks] = useState<PptGeneration[]>([]);
  const [deck, setDeck] = useState<PptGeneration | null>(null);
  const [mode, setMode] = useState<"create" | "view">("create");
  const [loadingList, setLoadingList] = useState(true);
  const [mobileListOpen, setMobileListOpen] = useState(false);

  const refreshList = useCallback(async () => {
    try {
      const result = await listPpts();
      setDecks(result.items);
    } catch {
      // 列表失败不打断主流程
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  // 有任何 slide 在生成中则轮询详情
  useEffect(() => {
    if (!deck) return;
    if (!deck.slides.some(slideIsActive)) return;

    const timer = window.setInterval(() => {
      void getPpt(deck.id)
        .then(setDeck)
        .catch(() => undefined);
    }, 2500);

    return () => window.clearInterval(timer);
  }, [deck]);

  async function openDeck(id: string) {
    try {
      setDeck(await getPpt(id));
      setMode("view");
      setMobileListOpen(false);
    } catch {
      // 忽略
    }
  }

  function startNewDeck() {
    setMode("create");
    setDeck(null);
    setMobileListOpen(false);
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col md:flex-row">
      <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border bg-background px-3 md:hidden">
        <Button
          variant="ghost"
          type="button"
          className="h-9 px-2.5 text-xs text-text-muted"
          onClick={() => setMobileListOpen(true)}
        >
          <List className="h-4 w-4" />
          文稿
        </Button>
        <span className="min-w-0 flex-1 truncate text-center text-xs font-medium">
          {mode === "view" && deck ? deck.title || "未命名 PPT" : "新建 PPT"}
        </span>
        <Button
          variant="secondary"
          type="button"
          className="h-9 w-9 p-0 text-text-muted"
          aria-label="新建 PPT"
          title="新建 PPT"
          onClick={startNewDeck}
        >
          <Plus className="h-4 w-4 stroke-[1.5]" />
        </Button>
      </header>

      <aside
        className={cn(
          "absolute inset-0 z-30 flex w-full shrink-0 flex-col border-r border-border bg-background md:static md:z-auto md:flex md:w-64",
          !mobileListOpen && "max-md:hidden",
        )}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <p className="eyebrow">PPT</p>
            <h1 className="mt-1 text-sm font-medium">演示文稿</h1>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="secondary"
              type="button"
              className="h-8 w-8 p-0 text-text-muted"
              aria-label="新建 PPT"
              title="新建 PPT"
              onClick={startNewDeck}
            >
              <Plus className="h-4 w-4 stroke-[1.5]" />
            </Button>
            <Button
              variant="ghost"
              type="button"
              className="h-8 w-8 p-0 text-text-muted md:hidden"
              aria-label="关闭文稿列表"
              title="关闭文稿列表"
              onClick={() => setMobileListOpen(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {loadingList ? (
            <div className="space-y-2 p-1">
              {Array.from({ length: 4 }).map((_, index) => (
                <div
                  key={index}
                  className="h-14 animate-pulse rounded-[8px] bg-surface-2"
                />
              ))}
            </div>
          ) : decks.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs leading-5 text-text-faint">
              还没有 PPT
              <br />
              点击右上角新建
            </p>
          ) : (
            decks.map((item) => (
              <Button
                variant="ghost"
                key={item.id}
                type="button"
                onClick={() => void openDeck(item.id)}
                className={cn(
                  "mb-1 w-full rounded-[8px] border px-3 py-2 text-left transition-colors",
                  deck?.id === item.id
                    ? "border-accent bg-surface-2"
                    : "border-transparent hover:bg-surface-2",
                )}
              >
                <p className="line-clamp-1 text-sm">
                  {item.title ?? "未命名 PPT"}
                </p>
                <p className="mt-0.5 flex items-center justify-between font-mono text-[11px] text-text-muted">
                  <span>{DECK_STATUS_LABEL[item.status]}</span>
                  <span>
                    {item.slides.filter((s) => s.status === "completed").length}
                    /{item.slides.length} 页
                  </span>
                </p>
              </Button>
            ))
          )}
        </div>
      </aside>

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        {mode === "create" ? (
          <CreateDeckForm
            onCreated={(created) => {
              setDeck(created);
              setMode("view");
              void refreshList();
            }}
          />
        ) : deck ? (
          <DeckView
            deck={deck}
            onDeckChange={(next) => {
              setDeck(next);
              void refreshList();
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

// ---------- 新建 ----------

interface DraftSlide {
  title: string;
  variablePrompt: string;
}

function CreateDeckForm({
  onCreated,
}: {
  onCreated: (deck: PptGeneration) => void;
}) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelId, setModelId] = useState("");
  const [title, setTitle] = useState("");
  const [fixedPrompt, setFixedPrompt] = useState("");
  const [slides, setSlides] = useState<DraftSlide[]>([
    { title: "", variablePrompt: "" },
  ]);
  const [busy, setBusy] = useState(false);
  const [enhancingIndex, setEnhancingIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listModels()
      .then((items) => {
        const available = items.filter((item) => item.available);
        setModels(available);
        if (available[0]) setModelId(available[0].id);
      })
      .catch(() => undefined);
  }, []);

  function updateSlide(index: number, patch: Partial<DraftSlide>) {
    setSlides((current) =>
      current.map((slide, i) => (i === index ? { ...slide, ...patch } : slide)),
    );
  }

  async function handleEnhance(index: number) {
    const slide = slides[index];
    if (!slide.variablePrompt.trim() || enhancingIndex !== null) return;

    setEnhancingIndex(index);
    try {
      const result = await enhancePptPrompt({
        prompt: slide.variablePrompt.trim(),
        theme: title.trim() || "演示文稿",
        slideType: "content",
      });
      updateSlide(index, { variablePrompt: result.enhancedPrompt });
    } catch (enhanceError) {
      setError(
        isApiError(enhanceError) ? enhanceError.message : "提示词增强失败",
      );
    } finally {
      setEnhancingIndex(null);
    }
  }

  async function handleCreate() {
    const validSlides = slides.filter((slide) => slide.variablePrompt.trim());
    if (!modelId || validSlides.length === 0 || busy) return;

    setBusy(true);
    setError(null);

    try {
      const created = await createPpt({
        modelId,
        fixedPrompt: fixedPrompt.trim(),
        title: title.trim() || undefined,
        slides: validSlides.map((slide) => ({
          variablePrompt: slide.variablePrompt.trim(),
          title: slide.title.trim() || undefined,
        })),
      });
      onCreated(created);
    } catch (createError) {
      setError(isApiError(createError) ? createError.message : "PPT 创建失败");
      setBusy(false);
    }
  }

  const validCount = slides.filter((slide) =>
    slide.variablePrompt.trim(),
  ).length;

  return (
    <div className="mx-auto max-w-3xl px-4 pb-10 pt-5 sm:px-6 sm:pb-16 sm:pt-8">
      <p className="eyebrow">新建</p>
      <h2 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">
        创建一套 PPT 配图
      </h2>
      <p className="mt-2 text-sm leading-6 text-text-muted">
        固定提示词决定整体风格，每页再写各自的变化部分。创建后逐页生成图片，最后导出
        .pptx。
      </p>

      <div className="mt-6 grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-2">
            <span className="field-label">标题（可选）</span>
            <Input
              className="surface-panel-soft h-11 w-full px-3 outline-none"
              placeholder="例如：季度产品复盘"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label className="block space-y-2">
            <span className="field-label">模型</span>
            <Select
              aria-label="模型"
              controlSize="lg"
              value={modelId}
              onValueChange={setModelId}
              options={models.map((model) => ({
                value: model.id,
                label: model.displayName,
              }))}
            />
          </label>
        </div>

        <label className="block space-y-2">
          <span className="field-label">固定提示词（整套风格，可选）</span>
          <Textarea
            className="surface-panel-soft min-h-20 w-full resize-y px-3 py-2 text-sm leading-6 outline-none"
            placeholder="例如：极简商务风格，蓝白配色，扁平插画，16:9 构图"
            value={fixedPrompt}
            onChange={(event) => setFixedPrompt(event.target.value)}
          />
        </label>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="field-label">分页内容（{slides.length} 页）</span>
            <Button
              variant="secondary"
              type="button"
              className="h-8 px-3 text-xs text-text-muted"
              onClick={() =>
                setSlides((current) => [
                  ...current,
                  { title: "", variablePrompt: "" },
                ])
              }
            >
              <Plus className="h-3.5 w-3.5 stroke-[1.5]" />
              加一页
            </Button>
          </div>

          {slides.map((slide, index) => (
            <div key={index} className="surface-panel p-3 sm:p-4">
              <div className="flex min-w-0 items-center gap-2">
                <span className="font-mono text-xs text-text-faint">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <Input
                  className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-text-faint"
                  placeholder="页标题（可选）"
                  value={slide.title}
                  onChange={(event) =>
                    updateSlide(index, { title: event.target.value })
                  }
                />
                <Button
                  variant="secondary"
                  type="button"
                  className="h-8 px-2.5 text-xs text-text-muted disabled:opacity-40"
                  disabled={
                    !slide.variablePrompt.trim() || enhancingIndex !== null
                  }
                  title="用 AI 增强这一页的提示词"
                  onClick={() => void handleEnhance(index)}
                >
                  {enhancingIndex === index ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Wand2 className="h-3.5 w-3.5 stroke-[1.5]" />
                  )}
                  增强
                </Button>
                <Button
                  variant="secondary"
                  type="button"
                  className="h-8 w-8 p-0 text-text-muted disabled:opacity-40"
                  disabled={slides.length <= 1}
                  title="删除这一页"
                  onClick={() =>
                    setSlides((current) =>
                      current.filter((_, i) => i !== index),
                    )
                  }
                >
                  <Trash2 className="h-3.5 w-3.5 stroke-[1.5]" />
                </Button>
              </div>
              <Textarea
                className="surface-panel-soft mt-3 min-h-16 w-full resize-y px-3 py-2 text-sm leading-6 outline-none"
                placeholder="这一页画面里要出现什么？"
                value={slide.variablePrompt}
                onChange={(event) =>
                  updateSlide(index, { variablePrompt: event.target.value })
                }
              />
            </div>
          ))}
        </div>

        {error ? <p className="text-sm text-danger">{error}</p> : null}

        <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-text-muted">
            将创建 {validCount} 页，创建后在右侧逐页生成图片
          </p>
          <Button
            variant="secondary"
            type="button"
            className="h-10 w-full px-5 disabled:opacity-45 sm:w-auto"
            disabled={!modelId || validCount === 0 || busy}
            onClick={() => void handleCreate()}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4 stroke-[1.5]" />
            )}
            {busy ? "创建中…" : "创建 PPT"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------- 详情 ----------

function DeckView({
  deck,
  onDeckChange,
}: {
  deck: PptGeneration;
  onDeckChange: (deck: PptGeneration) => void;
}) {
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [enhancingId, setEnhancingId] = useState<string | null>(null);
  const [generatingAll, setGeneratingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editsRef = useRef(edits);
  editsRef.current = edits;

  const promptFor = useCallback(
    (slide: PptSlide) => edits[slide.id] ?? slide.variablePrompt,
    [edits],
  );

  const pendingSlides = deck.slides.filter(
    (slide) => slide.status === "pending" || slide.status === "failed",
  );
  const completedCount = deck.slides.filter(
    (slide) => slide.status === "completed",
  ).length;
  const publishableCount = deck.slides.filter(
    (slide) =>
      slide.status === "completed" &&
      Boolean(slide.imageId) &&
      Boolean(slide.thumbnailUrl ?? slide.imageUrl),
  ).length;
  const anyActive = deck.slides.some(slideIsActive);

  async function handleGenerate(slide: PptSlide) {
    setError(null);
    try {
      await generatePptSlide({
        pptId: deck.id,
        slideId: slide.id,
        variablePrompt: promptFor(slide).trim() || undefined,
      });
      onDeckChange(await getPpt(deck.id));
    } catch (generateError) {
      setError(
        isApiError(generateError) ? generateError.message : "触发生成失败",
      );
    }
  }

  async function handleGenerateAll() {
    if (generatingAll) return;
    setGeneratingAll(true);
    setError(null);

    for (const slide of pendingSlides) {
      try {
        await generatePptSlide({
          pptId: deck.id,
          slideId: slide.id,
          variablePrompt:
            (editsRef.current[slide.id] ?? slide.variablePrompt).trim() ||
            undefined,
        });
      } catch {
        // 单页失败不阻断后续页
      }
    }

    try {
      onDeckChange(await getPpt(deck.id));
    } catch {
      // 轮询会继续
    }
    setGeneratingAll(false);
  }

  async function handleEnhance(slide: PptSlide) {
    const source = promptFor(slide).trim();
    if (!source || enhancingId) return;

    setEnhancingId(slide.id);
    try {
      const result = await enhancePptPrompt({
        prompt: source,
        theme: deck.title ?? "演示文稿",
        slideType: "content",
      });
      setEdits((current) => ({
        ...current,
        [slide.id]: result.enhancedPrompt,
      }));
    } catch (enhanceError) {
      setError(
        isApiError(enhanceError) ? enhanceError.message : "提示词增强失败",
      );
    } finally {
      setEnhancingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 pb-10 pt-5 sm:px-6 sm:pb-16 sm:pt-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">{DECK_STATUS_LABEL[deck.status]}</p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">
            {deck.title ?? "未命名 PPT"}
          </h2>
          <p className="mt-1 font-mono text-xs text-text-muted">
            {completedCount}/{deck.slides.length} 页完成 · {deck.progress}%
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            type="button"
            className="h-9 text-text-muted disabled:opacity-45"
            disabled={pendingSlides.length === 0 || generatingAll || anyActive}
            onClick={() => void handleGenerateAll()}
          >
            {generatingAll ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4 stroke-[1.5]" />
            )}
            {generatingAll ? "触发中…" : `全部生成（${pendingSlides.length}）`}
          </Button>
          <a
            className={cn(
              "tool-button h-9 text-text-muted",
              publishableCount === 0 &&
                "pointer-events-none opacity-45",
            )}
            href={pptPublishHref(deck.id)}
            aria-disabled={publishableCount === 0}
            tabIndex={publishableCount === 0 ? -1 : undefined}
            title={
              publishableCount === 0
                ? "请先生成至少一页可发布的幻灯片"
                : "带入已完成页面，发布到灵感圈"
            }
          >
            <Share2 className="h-4 w-4 stroke-[1.5]" />
            发布到灵感圈
            {publishableCount > 0
              ? `（${Math.min(publishableCount, 9)}张）`
              : ""}
          </a>
          <a
            className={cn(
              "tool-button h-9 text-text-muted",
              completedCount === 0 && "pointer-events-none opacity-45",
            )}
            href={pptExportUrl(deck.id)}
            download
          >
            <Download className="h-4 w-4 stroke-[1.5]" />
            导出 .pptx
          </a>
        </div>
      </div>

      <div className="mt-4 h-1 overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full bg-accent transition-all"
          style={{ width: `${deck.progress}%` }}
        />
      </div>

      {deck.fixedPrompt ? (
        <p className="mt-4 text-sm leading-6 text-text-muted">
          固定提示词：{deck.fixedPrompt}
        </p>
      ) : null}

      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {deck.slides.map((slide) => {
          const imageUrl = slide.thumbnailUrl ?? slide.imageUrl;
          const active = slideIsActive(slide);

          return (
            <div key={slide.id} className="surface-panel overflow-hidden">
              <div className="relative aspect-video bg-surface-2">
                {imageUrl ? (
                  <img
                    src={imageUrl}
                    alt={slide.title ?? `第 ${slide.index + 1} 页`}
                    className="h-full w-full object-cover"
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-2 text-text-faint">
                    {active ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : null}
                    <span className="text-xs">
                      {SLIDE_STATUS_LABEL[slide.status]}
                    </span>
                  </div>
                )}
                <span className="absolute left-3 top-3 rounded-full bg-black/55 px-2.5 py-1 font-mono text-xs text-white">
                  {String(slide.index + 1).padStart(2, "0")}
                </span>
                {slide.status !== "pending" ? (
                  <span
                    className={cn(
                      "absolute right-3 top-3 rounded-full px-2.5 py-1 text-xs",
                      slide.status === "completed" && "bg-black/55 text-white",
                      slide.status === "failed" && "bg-danger/90 text-white",
                      active && "bg-black/55 text-white",
                    )}
                  >
                    {SLIDE_STATUS_LABEL[slide.status]}
                  </span>
                ) : null}
              </div>

              <div className="p-4">
                {slide.title ? (
                  <p className="mb-2 text-sm font-medium">{slide.title}</p>
                ) : null}
                <Textarea
                  className="surface-panel-soft min-h-16 w-full resize-y px-3 py-2 text-sm leading-6 outline-none"
                  value={promptFor(slide)}
                  disabled={active}
                  onChange={(event) =>
                    setEdits((current) => ({
                      ...current,
                      [slide.id]: event.target.value,
                    }))
                  }
                />
                {slide.error ? (
                  <p className="mt-2 text-xs leading-5 text-danger">
                    {slide.error}
                  </p>
                ) : null}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    type="button"
                    className="h-8 px-3 text-xs text-text-muted disabled:opacity-45"
                    disabled={active || generatingAll}
                    onClick={() => void handleGenerate(slide)}
                  >
                    {active ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5 stroke-[1.5]" />
                    )}
                    {slide.status === "pending" ? "生成" : "重新生成"}
                  </Button>
                  <Button
                    variant="secondary"
                    type="button"
                    className="h-8 px-3 text-xs text-text-muted disabled:opacity-45"
                    disabled={active || enhancingId !== null}
                    onClick={() => void handleEnhance(slide)}
                  >
                    {enhancingId === slide.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Wand2 className="h-3.5 w-3.5 stroke-[1.5]" />
                    )}
                    增强提示词
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
