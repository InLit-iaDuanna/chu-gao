"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, Compass, Plus, Search, Sparkles, X } from "lucide-react";

import { Button, EmptyState, Input, Segmented, Select } from "@/components/ui";
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
    return "灵感圈";
  }, [discipline, filters.disciplines, tag]);

  const searchForm = (
    <form
      className={
        embedded ? "flex w-full max-w-2xl gap-2" : "mt-5 flex max-w-xl gap-2"
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
          className="h-9 pl-9"
        />
      </label>
      <Button type="submit" variant="secondary">
        搜索
      </Button>
    </form>
  );

  return (
    <main className="min-w-0 break-words text-sm tracking-normal">
      {embedded ? (
        <section className="border-b border-border">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
            {searchForm}
            {tag || discipline ? (
              <p className="min-w-0 max-w-full break-words text-xs text-text-muted">
                当前筛选：{title}
              </p>
            ) : null}
          </div>
        </section>
      ) : (
        <section className="border-b border-border">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
            <div className="app-page-header flex flex-wrap items-start justify-between gap-4 border-0 pb-0">
              <div className="min-w-0 max-w-3xl">
                <h1 className="app-page-title break-words text-xl font-semibold tracking-normal sm:text-2xl">
                  {title}
                </h1>
                <p className="app-page-description mt-2 max-w-2xl text-sm leading-6 text-text-muted">
                  作品、过程、模式与设计问题。
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild>
                  <Link href={`${basePath}/daily`}>
                    <Sparkles size={16} /> 每日命题
                  </Link>
                </Button>
                <Button asChild variant="primary">
                  <Link href="/app/publish">
                    <Plus size={16} /> 发布灵感
                  </Link>
                </Button>
              </div>
            </div>

            {searchForm}
          </div>
        </section>
      )}

      <section className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
          <Segmented
            aria-label="灵感排序"
            value={tab}
            onChange={(value) => updateFilter("tab", value)}
            className="max-w-full [&_button]:h-9 [&_button]:rounded-md [&_button]:text-sm"
            options={[
              ["recommended", "推荐"],
              ["hot", "热门"],
              ["latest", "最新"],
              ["following", "关注"],
            ].map(([value, label]) => ({ value, label }))}
          />
          <div className="grid w-full grid-cols-2 gap-2 sm:w-auto sm:min-w-80">
            <Select
              aria-label="筛选学科"
              value={discipline || "all"}
              onValueChange={(value) =>
                updateFilter("discipline", value === "all" ? "" : value)
              }
              options={[
                { value: "all", label: "全部学科" },
                ...filters.disciplines,
              ]}
              className="h-9 min-w-0"
            />
            <Select
              aria-label="筛选内容类型"
              value={shape || "all"}
              onValueChange={(value) =>
                updateFilter("shape", value === "all" ? "" : value)
              }
              options={[{ value: "all", label: "全部类型" }, ...filters.shapes]}
              className="h-9 min-w-0"
            />
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
          <EmptyState
            className="mt-6 min-h-64"
            role="alert"
            icon={Compass}
            title="灵感暂时无法读取"
            description={error}
            action={<Button onClick={() => void load()}>重新加载</Button>}
          />
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
          <EmptyState
            className="mt-6 min-h-64"
            icon={Compass}
            title={hasFilters ? "没有找到匹配的灵感" : "还没有灵感内容"}
            description={
              hasFilters
                ? "试试其他关键词，或清空筛选。"
                : "分享你的作品、过程或设计问题。"
            }
            action={
              <Button asChild variant="primary">
                <Link href="/app/publish">
                  <Plus size={16} /> 发布第一条灵感
                </Link>
              </Button>
            }
          />
        )}
      </section>
    </main>
  );
}
