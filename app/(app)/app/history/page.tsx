import Link from "next/link";
import { headers } from "next/headers";
import {
  ArrowLeft,
  CircleAlert,
  Download,
  History,
  Search,
  SearchX,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Button, EmptyState, Input } from "@/components/ui";
import type { GenerationStatus } from "@/components/studio/lib/types";

import {
  downloadImageUrl,
  previewImageUrl,
} from "@/components/canvas/gallery-images";
import { friendlyErrorMessage } from "@/components/shared/error-copy";
import { ClearHistoryButton } from "@/components/studio/ClearHistoryButton";
import {
  generationStatusLabel,
  generationStatusTone,
} from "@/components/studio/lib/status";
import { StudioPageShell } from "@/components/studio/StudioPageShell";
import { CopyTextButton } from "@/components/studio/CopyTextButton";
import { checkSessionFromHeaders } from "@/lib/auth";
import {
  conversationSummaryRowInclude,
  serializeConversationSummary,
} from "@/lib/conversations";
import { db } from "@/lib/db";
import {
  serializeGeneration,
  isGenerationStatus,
  GENERATION_STATUSES,
} from "@/lib/generations";
import { getImage2ChannelDisplayNameMap } from "@/lib/provider-channel-config";
import { isDatabaseUnavailableError } from "@/lib/service-errors";
import { formatDate } from "@/lib/utils";

const PAGE_SIZE = 24;
type HistoryFilters = {
  query: string;
  status?: GenerationStatus;
  page: number;
};

async function getGenerations({ query, status, page }: HistoryFilters) {
  const sessionResult = await checkSessionFromHeaders(await headers());

  if (sessionResult.status !== "authenticated" || !process.env.DATABASE_URL) {
    return null;
  }

  try {
    const [rows, displayNameMap] = await Promise.all([
      db.generation.findMany({
        where: {
          userId: sessionResult.user.id,
          deletedAt: null,
          ...(query
            ? { prompt: { contains: query, mode: "insensitive" as const } }
            : {}),
          ...(status ? { status } : {}),
        },
        include: {
          images: true,
          provider: {
            select: { id: true, name: true },
          },
          providerAccount: {
            select: { id: true, name: true, baseUrl: true },
          },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE + 1,
      }),
      getImage2ChannelDisplayNameMap(),
    ]);

    return rows.map((row) => serializeGeneration(row, { displayNameMap }));
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      return null;
    }

    throw error;
  }
}

async function getConversations({ query, status, page }: HistoryFilters) {
  const sessionResult = await checkSessionFromHeaders(await headers());

  if (sessionResult.status !== "authenticated" || !process.env.DATABASE_URL) {
    return null;
  }

  try {
    const [rows, displayNameMap] = await Promise.all([
      db.conversation.findMany({
        where: {
          userId: sessionResult.user.id,
          archivedAt: null,
          ...(query
            ? { title: { contains: query, mode: "insensitive" as const } }
            : {}),
          ...(status
            ? { generations: { some: { status, deletedAt: null } } }
            : {}),
        },
        include: conversationSummaryRowInclude(),
        orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE + 1,
      }),
      getImage2ChannelDisplayNameMap(),
    ]);

    return rows.map((row) =>
      serializeConversationSummary(row, { displayNameMap }),
    );
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      return null;
    }

    throw error;
  }
}

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const search = await searchParams;
  const query = typeof search.q === "string" ? search.q.trim() : "";
  const status =
    typeof search.status === "string" && isGenerationStatus(search.status)
      ? search.status
      : undefined;
  const requestedPage =
    typeof search.page === "string" ? Number(search.page) : 1;
  const page =
    Number.isSafeInteger(requestedPage) &&
    requestedPage > 0 &&
    requestedPage <= Math.floor(2147483647 / PAGE_SIZE)
      ? requestedPage
      : 1;
  const filters = { query, status, page };
  const [conversationRows, generationRows] = await Promise.all([
    getConversations(filters),
    getGenerations(filters),
  ]);
  const hasNext = Boolean(
    (conversationRows && conversationRows.length > PAGE_SIZE) ||
    (generationRows && generationRows.length > PAGE_SIZE),
  );
  const conversations = conversationRows?.slice(0, PAGE_SIZE) ?? null;
  const generations = generationRows?.slice(0, PAGE_SIZE) ?? null;
  const pageHref = (nextPage: number) => {
    const params = new URLSearchParams({ page: String(nextPage) });
    if (query) params.set("q", query);
    if (status) params.set("status", status);
    return `/app/history?${params}`;
  };
  const hasHistory = Boolean(
    conversations &&
    generations &&
    (conversations.length > 0 || generations.length > 0),
  );

  return (
    <StudioPageShell
      title="历史"
      wide
      actions={
        <>
          {hasHistory && !query && !status && page === 1 ? (
            <ClearHistoryButton />
          ) : null}
          <Button asChild variant="secondary">
            <Link href="/app">
              <ArrowLeft size={16} aria-hidden="true" />
              回到工作台
            </Link>
          </Button>
        </>
      }
    >
      <form
        action="/app/history"
        className="mb-6 flex min-w-0 flex-wrap items-center gap-2 border-y border-border py-4 tracking-normal"
      >
        <Input
          key={query}
          name="q"
          defaultValue={query}
          aria-label="搜索历史提示词或对话标题"
          placeholder="搜索提示词或对话标题"
          className="h-9 min-w-0 flex-1 basis-full sm:basis-56"
        />
        <select
          key={status ?? "all"}
          name="status"
          defaultValue={status ?? ""}
          aria-label="任务状态"
          className="h-9 min-w-0 flex-1 basis-36 rounded-md border border-[rgb(var(--control-border))] bg-[rgb(var(--control-bg))] px-3 text-sm text-foreground outline-none hover:border-[rgb(var(--control-border-hover))] focus:border-brand focus:shadow-[var(--shadow-focus)] sm:w-40 sm:flex-none sm:basis-auto"
        >
          <option value="">全部状态</option>
          {GENERATION_STATUSES.map((value) => (
            <option key={value} value={value}>
              {generationStatusLabel(value)}
            </option>
          ))}
        </select>
        <Button type="submit" variant="primary">
          <Search size={16} /> 搜索
        </Button>
        {query || status ? (
          <Button asChild variant="ghost">
            <Link href="/app/history">清空筛选</Link>
          </Button>
        ) : null}
      </form>
      {!conversations || !generations ? (
        <EmptyState
          role="status"
          icon={CircleAlert}
          className="min-h-72"
          title="历史暂时无法读取"
          description="请稍后刷新页面。你仍然可以返回工作台，服务恢复后新的任务会继续保存。"
          action={
            <Button asChild>
              <Link href="/app">返回工作台</Link>
            </Button>
          }
        />
      ) : conversations.length === 0 && generations.length === 0 ? (
        <EmptyState
          icon={query || status || page > 1 ? SearchX : History}
          className="min-h-72"
          title={
            query || status || page > 1
              ? "没有找到匹配的历史记录"
              : "当前账户还没有创作历史"
          }
          description={
            query || status || page > 1
              ? "调整关键词、状态或返回前一页。"
              : "回到工作台，描述第一张图。完成后的结果会出现在这里。"
          }
          action={
            <Button asChild variant="primary">
              <Link href="/app">开始创作</Link>
            </Button>
          }
        />
      ) : (
        <div className="min-w-0 space-y-8 text-sm tracking-normal">
          {conversations.length ? (
            <section
              aria-labelledby="history-conversations-heading"
              className="min-w-0"
            >
              <header className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2
                  id="history-conversations-heading"
                  className="app-section-title"
                >
                  对话
                </h2>
                <p className="text-xs text-text-muted">继续创作</p>
              </header>
              <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {conversations.map((conversation) => (
                  <Link
                    key={conversation.id}
                    href={`/app?thread=${conversation.id}`}
                    className="img-enter block min-w-0 overflow-hidden rounded-lg border border-border bg-surface p-3 transition-colors hover:border-border-strong focus-visible:outline-brand"
                  >
                    <div className="relative mb-3 aspect-video overflow-hidden rounded-md bg-surface-2">
                      {conversation.thumbnailUrl ? (
                        <img
                          src={conversation.thumbnailUrl}
                          alt={conversation.title}
                          className="h-full w-full object-cover"
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center px-6 text-center text-sm text-text-muted">
                          对话还没有完成的图片
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-text-muted">
                      <span>{formatDate(conversation.lastMessageAt)}</span>
                      <span>{conversation.generationCount} 个任务</span>
                    </div>
                    <h3 className="mt-2 line-clamp-1 break-words text-sm font-medium [overflow-wrap:anywhere]">
                      {conversation.title}
                    </h3>
                    {conversation.latestMessage ? (
                      <p className="mt-2 line-clamp-2 break-words text-sm leading-6 text-text-muted [overflow-wrap:anywhere]">
                        {conversation.latestMessage}
                      </p>
                    ) : null}
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          <section
            aria-labelledby="history-generations-heading"
            className="min-w-0 border-t border-border pt-6"
          >
            <header className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2
                id="history-generations-heading"
                className="app-section-title"
              >
                任务
              </h2>
              <p className="text-xs text-text-muted">单次生成记录</p>
            </header>
            {generations.length === 0 ? (
              <EmptyState title="暂无匹配的生成任务" />
            ) : null}
            <div className="min-w-0 columns-1 gap-4 md:columns-2 xl:columns-3">
              {generations.map((generation) => {
                const previewImages = generation.images.filter(
                  (image) => image.src ?? image.url,
                );
                const latestImage = previewImages.at(-1);
                const imageUrl = previewImageUrl(latestImage);
                const detailHref = generation.conversationId
                  ? `/app?thread=${generation.conversationId}`
                  : `/app/g/${generation.id}`;

                return (
                  <article
                    key={generation.id}
                    className="img-enter mb-4 block min-w-0 break-inside-avoid rounded-lg border border-border bg-surface p-3 transition-colors hover:border-border-strong"
                  >
                    <Link
                      href={detailHref}
                      className="block min-w-0 rounded-md focus-visible:outline-brand"
                    >
                      <div className="relative mb-3 aspect-square overflow-hidden rounded-md bg-surface-2">
                        {imageUrl ? (
                          <>
                            <img
                              src={imageUrl}
                              alt={generation.prompt}
                              className="h-full w-full object-contain"
                              loading="lazy"
                              decoding="async"
                            />
                            {previewImages.length > 1 ? (
                              <span className="absolute left-3 top-3 rounded-md border border-border bg-surface/95 px-2 py-1 text-xs text-foreground">
                                {previewImages.length} 张
                              </span>
                            ) : null}
                          </>
                        ) : (
                          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-text-muted">
                            {generation.status === "FAILED"
                              ? friendlyErrorMessage(
                                  {
                                    code: generation.errorCode ?? undefined,
                                    message:
                                      generation.errorMessage ?? undefined,
                                  },
                                  "任务失败，可以打开详情查看原因",
                                )
                              : generationStatusLabel(generation.status)}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-text-muted">
                        <span>
                          {formatDate(generation.createdAt)}
                          {generation.source === "agent" ? " · Agent" : ""}
                        </span>
                        <span
                          className={generationStatusTone(generation.status)}
                        >
                          {generationStatusLabel(generation.status)}
                        </span>
                      </div>
                      <p className="mt-2 line-clamp-3 break-words text-sm leading-6 [overflow-wrap:anywhere]">
                        {generation.prompt}
                      </p>
                    </Link>
                    <div className="mt-2 flex items-center justify-end [&_button]:h-9 [&_button]:w-9">
                      <CopyTextButton text={generation.prompt} />
                    </div>
                    {previewImages.length ? (
                      <div className="mt-3 grid gap-2">
                        {previewImages.map((image, index) => {
                          const href = downloadImageUrl(image);

                          return href ? (
                            <Button
                              asChild
                              variant="secondary"
                              key={image.id ?? `${href}-${index}`}
                            >
                              <a href={href} download>
                                <Download className="h-4 w-4 stroke-[1.5]" />
                                下载原图 {index + 1}
                              </a>
                            </Button>
                          ) : null;
                        })}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      )}
      {conversations && generations && (page > 1 || hasNext) ? (
        <nav
          aria-label="历史分页"
          className="mt-6 flex flex-wrap items-center justify-center gap-3 border-t border-border pt-5"
        >
          {page > 1 ? (
            <Button asChild>
              <Link href={pageHref(page - 1)}>
                <ChevronLeft size={16} /> 上一页
              </Link>
            </Button>
          ) : null}
          <span className="text-sm text-text-muted">第 {page} 页</span>
          {hasNext ? (
            <Button asChild>
              <Link href={pageHref(page + 1)}>
                下一页 <ChevronRight size={16} />
              </Link>
            </Button>
          ) : null}
        </nav>
      ) : null}
    </StudioPageShell>
  );
}
