import type { Prisma } from "@prisma/client";
import { headers } from "next/headers";
import Link from "next/link";

import { GenerationRecordList } from "@/components/admin/GenerationRecordList";
import { requireAdminSessionFromHeaders } from "@/lib/auth";
import { db } from "@/lib/db";

const ALLOWED_STATUSES = [
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "CANCELED",
];
const PAGE_SIZE = 24;

function dateBoundary(value: string | undefined, nextDay = false) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00+08:00`);
  if (Number.isNaN(date.getTime())) return undefined;
  if (nextDay) date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

async function getRows(
  q?: string,
  status?: string,
  from?: string,
  to?: string,
  requestedPage = 1,
) {
  const admin = await requireAdminSessionFromHeaders(await headers());

  if (!admin || !process.env.DATABASE_URL) {
    return null;
  }

  try {
    const fromDate = dateBoundary(from);
    const toDate = dateBoundary(to, true);
    const where: Prisma.GenerationWhereInput = {
      deletedAt: null,
      ...(status && ALLOWED_STATUSES.includes(status)
        ? {
            status: status as
              | "PENDING"
              | "RUNNING"
              | "SUCCEEDED"
              | "FAILED"
              | "CANCELED",
          }
        : {}),
      ...(fromDate || toDate
        ? {
            createdAt: {
              ...(fromDate ? { gte: fromDate } : {}),
              ...(toDate ? { lt: toDate } : {}),
            },
          }
        : {}),
      ...(q
        ? {
            OR: [
              { id: { contains: q, mode: "insensitive" as const } },
              { prompt: { contains: q, mode: "insensitive" as const } },
              {
                user: {
                  email: { contains: q, mode: "insensitive" as const },
                },
              },
            ],
          }
        : {}),
    };
    const total = await db.generation.count({ where });
    const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const page = Math.min(Math.max(requestedPage, 1), pageCount);
    const generations = await db.generation.findMany({
      include: {
        images: {
          orderBy: { createdAt: "asc" },
        },
        user: {
          select: { id: true, email: true, name: true },
        },
        provider: {
          select: {
            name: true,
          },
        },
        providerAccount: {
          select: {
            name: true,
            baseUrl: true,
          },
        },
      },
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    });

    return { generations, total, page, pageCount };
  } catch {
    return null;
  }
}

export default async function AdminGenerationsPage({
  searchParams,
}: {
  searchParams?: Promise<{
    q?: string;
    status?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
}) {
  const params = await searchParams;
  const requestedPage = Number.parseInt(params?.page ?? "1", 10);
  const data = await getRows(
    params?.q,
    params?.status,
    params?.from,
    params?.to,
    Number.isFinite(requestedPage) ? requestedPage : 1,
  );

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">生成</p>
        <h1 className="mt-2 text-3xl font-semibold">全站任务</h1>
      </div>
      <form className="surface-panel grid gap-3 p-4 lg:grid-cols-[minmax(220px,1fr)_150px_150px_150px_auto_auto]">
        <label className="min-w-0">
          <span className="sr-only">搜索生成记录</span>
          <input
            type="search"
            name="q"
            defaultValue={params?.q ?? ""}
            placeholder="搜索用户邮箱、任务 ID 或提示词"
            className="h-10 w-full rounded-[6px] border border-border bg-surface px-3 text-sm text-foreground outline-none focus:border-[rgb(var(--brand-primary))]"
          />
        </label>
        <label>
          <span className="sr-only">筛选状态</span>
          <select
            name="status"
            defaultValue={params?.status ?? ""}
            className="h-10 w-full rounded-[6px] border border-border bg-surface px-3 text-sm text-foreground outline-none focus:border-[rgb(var(--brand-primary))]"
          >
            <option value="">全部状态</option>
            <option value="PENDING">排队中</option>
            <option value="RUNNING">生成中</option>
            <option value="SUCCEEDED">生成成功</option>
            <option value="FAILED">生成失败</option>
            <option value="CANCELED">已取消</option>
          </select>
        </label>
        <label>
          <span className="sr-only">开始日期</span>
          <input
            type="date"
            name="from"
            defaultValue={params?.from ?? ""}
            aria-label="开始日期"
            className="h-10 w-full rounded-[6px] border border-border bg-surface px-3 text-sm text-foreground outline-none focus:border-[rgb(var(--brand-primary))]"
          />
        </label>
        <label>
          <span className="sr-only">结束日期</span>
          <input
            type="date"
            name="to"
            defaultValue={params?.to ?? ""}
            aria-label="结束日期"
            className="h-10 w-full rounded-[6px] border border-border bg-surface px-3 text-sm text-foreground outline-none focus:border-[rgb(var(--brand-primary))]"
          />
        </label>
        <button
          type="submit"
          className="h-10 rounded-[6px] bg-foreground px-5 text-sm font-medium text-background"
        >
          查询
        </button>
        <Link
          href="/admin/generations"
          className="tool-button h-10 justify-center text-sm text-text-muted"
        >
          重置
        </Link>
      </form>
      {data ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-text-muted">
            <p>
              全部 {data.total} 条 · 第 {data.page}/{data.pageCount} 页
            </p>
            <Pagination
              page={data.page}
              pageCount={data.pageCount}
              q={params?.q}
              status={params?.status}
              from={params?.from}
              to={params?.to}
            />
          </div>
          <GenerationRecordList generations={data.generations} />
          <div className="flex justify-end">
            <Pagination
              page={data.page}
              pageCount={data.pageCount}
              q={params?.q}
              status={params?.status}
              from={params?.from}
              to={params?.to}
            />
          </div>
        </>
      ) : (
        <div className="surface-panel p-6 text-sm leading-6 text-text-muted">
          生成任务服务暂不可用，请确认数据库连接后刷新。
        </div>
      )}
    </div>
  );
}

function Pagination({
  page,
  pageCount,
  q,
  status,
  from,
  to,
}: {
  page: number;
  pageCount: number;
  q?: string;
  status?: string;
  from?: string;
  to?: string;
}) {
  const hrefFor = (targetPage: number) => {
    const search = new URLSearchParams();
    if (q) search.set("q", q);
    if (status) search.set("status", status);
    if (from) search.set("from", from);
    if (to) search.set("to", to);
    search.set("page", String(targetPage));
    return `/admin/generations?${search.toString()}`;
  };

  return (
    <nav className="flex items-center gap-2" aria-label="生成记录分页">
      {page > 1 ? (
        <Link
          href={hrefFor(page - 1)}
          className="rounded-[6px] border border-border bg-surface px-3 py-1.5 text-xs text-foreground hover:bg-surface-2"
        >
          上一页
        </Link>
      ) : (
        <span className="rounded-[6px] border border-border px-3 py-1.5 text-xs text-text-faint opacity-50">
          上一页
        </span>
      )}
      {page < pageCount ? (
        <Link
          href={hrefFor(page + 1)}
          className="rounded-[6px] border border-border bg-surface px-3 py-1.5 text-xs text-foreground hover:bg-surface-2"
        >
          下一页
        </Link>
      ) : (
        <span className="rounded-[6px] border border-border px-3 py-1.5 text-xs text-text-faint opacity-50">
          下一页
        </span>
      )}
    </nav>
  );
}
