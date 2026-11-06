"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, Compass, Plus, Search, Sparkles, X } from "lucide-react";

import { Button, Input } from "@/components/ui";
import { inspirationRequest } from "./api";
import { InspirationCard } from "./InspirationCard";
import type {
  Discipline,
  InspirationPageData,
  InspirationPost,
  PostShape,
} from "./types";

const DEFAULT_DISCIPLINES: Array<{ value: Discipline; label: string }> = [
  { value: "GRAPHIC", label: "视觉平面" },
  { value: "PRODUCT", label: "产品体验" },
  { value: "INDUSTRIAL", label: "工业硬件" },
  { value: "SERVICE", label: "服务流程" },
  { value: "SPATIAL", label: "空间环境" },
  { value: "BRAND", label: "品牌策略" },
  { value: "MOTION", label: "动态影像" },
  { value: "DATAVIZ", label: "信息可视化" },
];

const DEFAULT_SHAPES: Array<{ value: PostShape; label: string }> = [
  { value: "WORK", label: "作品" },
  { value: "TEARDOWN", label: "拆解" },
  { value: "PATTERN", label: "模式" },
  { value: "QUESTION", label: "命题" },
  { value: "REFERENCE", label: "参考" },
  { value: "PROCESS", label: "过程" },
];

export function InspirationFeed({
  basePath = "/inspiration",
  embedded = false,
}: {
  basePath?: string;
  embedded?: boolean;
} = {}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [items, setItems] = useState<InspirationPost[]>([]);
  const tab = searchParams.get("tab") ?? "recommended";
  const discipline = searchParams.get("discipline") ?? "";
  const shape = searchParams.get("shape") ?? "";
  const query = searchParams.get("q") ?? "";
  const [searchValue, setSearchValue] = useState(searchParams.get("q") ?? "");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [moreError, setMoreError] = useState("");
  const requestRef = useRef<AbortController | null>(null);
  const [filters, setFilters] = useState({
    disciplines: DEFAULT_DISCIPLINES,
    shapes: DEFAULT_SHAPES,
  });
  const tag = searchParams.get("tag") ?? "";
  const hasFilters = Boolean(discipline || shape || query || tag);
  const updateFilter = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    router.push(`${basePath}?${params}`, { scroll: false });
  };

  useEffect(() => setSearchValue(query), [query]);

  const load = useCallback(
    async (cursor?: string) => {
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      setMoreError("");
      if (cursor) setLoadingMore(true);
      else setLoading(true);
      try {
        const params = new URLSearchParams({ tab, limit: "24" });
        if (discipline) params.set("discipline", discipline);
        if (shape) params.set("shape", shape);
        if (query) params.set("q", query);
        if (tag) params.set("tag", tag);
        if (cursor) params.set("cursor", cursor);
        const data = await inspirationRequest<InspirationPageData>(
          `/api/inspiration/posts?${params}`,
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        setItems((current) => {
          if (!cursor) return data.items;
          const seen = new Set(current.map((item) => item.id));
          return [
            ...current,
            ...data.items.filter((item) => !seen.has(item.id)),
          ];
        });
        setNextCursor(data.nextCursor);
        setFilters(data.filters);
        setError("");
      } catch (cause) {
        if (controller.signal.aborted) return;
        (cursor ? setMoreError : setError)(
          cause instanceof Error ? cause.message : "灵感列表暂时无法读取",
        );
        if (!cursor) setItems([]);
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [discipline, query, shape, tab, tag],
  );

  useEffect(() => {
    void load();
    return () => requestRef.current?.abort();
  }, [load]);

  const title = useMemo(() => {
    if (tag) return `#${tag}`;
    if (discipline)
      return (
        filters.disciplines.find((item) => item.value === discipline)?.label ??
        "灵感圈"
      );
    return "把一个设计问题，聊清楚。";
  }, [discipline, filters.disciplines, tag]);

  const searchForm = (
    <form
      className={
        embedded ? "flex w-full max-w-2xl gap-2" : "mt-8 flex max-w-xl gap-2"
      }
      onSubmit={(event) => {
        event.preventDefault();
        updateFilter("q", searchValue.trim());
      }}
    >
      <label className="relative min-w-0 flex-1">
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 text-text-faint"
          size={15}
        />
        <Input
          aria-label="搜索灵感"
          value={searchValue}
          onChange={(event) => setSearchValue(event.target.value)}
          placeholder="搜索设计问题、标签或作品"
          className="h-10 pl-9"
        />
      </label>
      <Button type="submit" variant="secondary" className="h-10 px-4">
        搜索
      </Button>
    </form>
  );

  return (
    <main>
      {embedded ? (
        <section className="border-b border-border">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
            {searchForm}
            {tag || discipline ? (
              <p className="text-xs text-text-muted">当前筛选：{title}</p>
            ) : null}
          </div>
        </section>
      ) : (
        <section className="border-b border-border">
          <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14">
            <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
              <div className="max-w-3xl">
                <p className="font-mono text-xs uppercase tracking-[0.18em] text-brand">
                  Cross-disciplinary design conversations
                </p>
                <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-5xl">
                  {title}
                </h1>
                <p className="mt-4 max-w-2xl text-sm leading-7 text-text-muted">
                  看作品只是开始。这里讨论洞察、过程、模式与问题，让一个想法能够被理解、回应，并继续生长。
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  href={`${basePath}/daily`}
                  className="tool-button h-10 px-4 text-sm text-text-muted"
                >
                  <Sparkles size={15} /> 每日命题
                </Link>
                <Link
                  href="/app/publish"
                  className="tool-button h-10 border-brand bg-brand px-4 text-sm text-on-accent hover:bg-brand-hover"
                >
                  <Plus size={15} /> 发布灵感
                </Link>
              </div>
            </div>

            {searchForm}
          </div>
        </section>
      )}

      <section className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-3 border-b border-border pb-5">
          <div className="flex flex-wrap gap-1">
            {[
              ["recommended", "推荐"],
              ["hot", "热门"],
              ["latest", "最新"],
              ["following", "关注"],
            ].map(([value, label]) => (
              <Button
                key={value}
                variant="ghost"
                onClick={() => updateFilter("tab", value)}
                aria-pressed={tab === value}
                className={`h-8 px-3 text-xs ${tab === value ? "bg-surface-2 text-foreground" : "text-text-muted"}`}
              >
                {label}
              </Button>
            ))}
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => updateFilter("discipline", "")}
              aria-pressed={!discipline}
              className={`shrink-0 rounded-full border px-3 py-1 text-xs ${!discipline ? "border-brand bg-brand/10 text-brand" : "border-border text-text-muted"}`}
            >
              全部学科
            </button>
            {filters.disciplines.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => updateFilter("discipline", item.value)}
                aria-pressed={discipline === item.value}
                className={`shrink-0 rounded-full border px-3 py-1 text-xs ${discipline === item.value ? "border-brand bg-brand/10 text-brand" : "border-border text-text-muted hover:border-border-strong"}`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => updateFilter("shape", "")}
              aria-pressed={!shape}
              className={`shrink-0 rounded-md px-2 py-1 text-xs ${!shape ? "bg-surface-2 text-foreground" : "text-text-muted"}`}
            >
              全部类型
            </button>
            {filters.shapes.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => updateFilter("shape", item.value)}
                aria-pressed={shape === item.value}
                className={`shrink-0 rounded-md px-2 py-1 text-xs ${shape === item.value ? "bg-surface-2 text-foreground" : "text-text-muted hover:text-foreground"}`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {hasFilters ? (
          <div className="flex flex-wrap items-center gap-3 pt-4 text-sm text-text-muted">
            {query ? <span className="break-all">搜索：{query}</span> : null}
            {tag ? <span className="break-all">#{tag}</span> : null}
            <Button
              variant="ghost"
              onClick={() => router.push(basePath, { scroll: false })}
            >
              <X size={14} /> 清空筛选
            </Button>
          </div>
        ) : null}
        {loading ? (
          <div className="columns-1 gap-4 pt-6 sm:columns-2 lg:columns-3 xl:columns-4">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((item) => (
              <div
                key={item}
                className="skeleton-shimmer mb-4 h-80 break-inside-avoid rounded-lg border border-border"
              />
            ))}
          </div>
        ) : error ? (
          <div className="surface-panel mt-6 flex min-h-64 flex-col items-center justify-center gap-3 px-5 text-center">
            <Compass size={24} className="text-text-faint" />
            <p className="text-sm text-text-muted">{error}</p>
            <Button variant="secondary" onClick={() => void load()}>
              重新加载
            </Button>
          </div>
        ) : items.length ? (
          <>
            <div className="columns-1 gap-4 pt-6 sm:columns-2 lg:columns-3 xl:columns-4">
              {items.map((post) => (
                <InspirationCard
                  key={post.id}
                  post={post}
                  basePath={basePath}
                />
              ))}
            </div>
            {nextCursor ? (
              <div className="flex flex-col items-center gap-3 py-8">
                {moreError ? (
                  <p role="alert" className="text-sm text-danger">
                    {moreError}
                  </p>
                ) : null}
                <Button
                  variant="secondary"
                  disabled={loadingMore}
                  onClick={() => void load(nextCursor)}
                >
                  <ArrowDown size={14} />{" "}
                  {loadingMore
                    ? "加载中…"
                    : moreError
                      ? "重试加载"
                      : "加载更多"}
                </Button>
              </div>
            ) : null}
          </>
        ) : (
          <div className="surface-panel mt-6 flex min-h-72 flex-col items-center justify-center gap-3 px-5 text-center">
            <Compass size={26} className="text-text-faint" />
            <h2 className="text-lg font-medium">
              {hasFilters ? "没有找到匹配的灵感" : "还没有灵感内容"}
            </h2>
            <p className="max-w-sm text-sm leading-6 text-text-muted">
              {hasFilters
                ? "试试其他关键词，或清空筛选。"
                : "成为第一个提出问题、拆解模式或分享过程的人。"}
            </p>
            <Link
              href="/app/publish"
              className="tool-button mt-2 h-9 px-4 text-sm text-text-muted"
            >
              发布第一条灵感
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}
