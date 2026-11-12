"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { Button, IconButton, Input, Select } from "@/components/ui";
import {
  CALL_ERROR_LABELS,
  CALL_OPERATION_LABELS,
  CALL_SOURCE_LABELS,
  formatCallTime,
  type AdminModelCall,
} from "@/lib/model-call-types";
import {
  getAdminModelCall,
  listAdminModelCalls,
  type ModelCallQuery,
} from "./lib/api";
import { ModelCallContent } from "./ModelCallContent";
import { AdminPageHeader, AdminTable, EmptyPanel, ErrorText } from "./ui";

const statusLabels: Record<string, string> = {
  RUNNING: "调用中",
  SUCCEEDED: "成功",
  FAILED: "失败",
};

type DetailState =
  | { status: "loading" }
  | { status: "ready"; item: AdminModelCall }
  | { status: "error"; message: string };

function ModelCallDetails({ item }: { item: AdminModelCall }) {
  const fields: Array<[string, string | number | null | undefined]> = [
    ["调用 ID", item.id],
    ["账号", item.userEmail ?? item.userId],
    ["昵称", item.userName ?? "未设置"],
    ["任务 ID", item.generationId],
    ["图片 ID", item.imageId],
    ["会话 ID", item.conversationId],
    ["对话尝试 ID", item.chatAttemptId],
    ["上游请求 ID", item.requestId],
    ["渠道 ID", item.providerId],
    ["账号 ID", item.providerAccountId],
    ["请求地址", item.endpoint],
    [
      "完成时间（北京）",
      item.finishedAt ? formatCallTime(item.finishedAt) : "—",
    ],
    [
      "输入总量 / 未缓存输入",
      `${item.inputTokens ?? "—"} / ${item.uncachedInputTokens ?? "—"}`,
    ],
    [
      "缓存读取 / 缓存创建",
      `${item.cacheReadTokens ?? "—"} / ${item.cacheCreationTokens ?? "—"}`,
    ],
    ["输出 Token", item.outputTokens],
  ];

  return (
    <div className="min-w-0 max-w-[calc(100vw-4rem)] md:max-w-none">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          <p className="text-xs font-medium text-foreground">调用详情</p>
          <p className="mt-0.5 text-[11px] text-text-muted">
            {CALL_OPERATION_LABELS[item.operation] ?? item.operation} ·{" "}
            {item.modelId}
          </p>
        </div>
        <span className="font-mono text-[11px] text-text-faint">{item.id}</span>
      </div>
      <dl className="grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-2 break-all">
        {fields.map(([label, value]) => (
          <div
            key={label}
            className="min-w-0 rounded-md bg-surface px-2.5 py-2"
          >
            <dt className="text-[11px] text-text-faint">{label}</dt>
            <dd className="mt-1 break-all font-mono text-[11px] leading-5">
              {value ?? "—"}
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 grid gap-3 border-t border-border pt-3 md:grid-cols-2">
        <section className="min-w-0">
          <div className="mt-1.5">
            <ModelCallContent
              value={item.requestContent}
              side="request"
              empty="该调用没有记录发送内容"
            />
          </div>
        </section>
        <section className="min-w-0">
          <div className="mt-1.5">
            <ModelCallContent
              value={item.responseContent}
              side="response"
              empty="该调用没有记录返回内容"
            />
          </div>
        </section>
      </div>
      {item.errorMessage && (
        <div className="mt-3 border-t border-border pt-3">
          <p className="text-[11px] font-medium text-danger">错误信息</p>
          <pre className="mt-1.5 whitespace-pre-wrap break-all rounded-md border border-danger/20 bg-danger/5 px-3 py-2.5 font-mono text-[11px] leading-5 text-danger">
            {item.errorMessage}
          </pre>
        </div>
      )}
    </div>
  );
}

function ModelCallDetailState({ state }: { state?: DetailState }) {
  if (!state) return null;
  if (state.status === "loading") {
    return <p className="text-text-muted">正在读取调用内容…</p>;
  }
  if (state.status === "error") {
    return <p className="text-danger">{state.message}</p>;
  }
  return <ModelCallDetails item={state.item} />;
}

export function ModelCallTable({ items }: { items: AdminModelCall[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detailState, setDetailState] = useState<
    Record<string, DetailState | undefined>
  >({});

  async function toggleDetails(id: string) {
    if (expanded === id) {
      setExpanded(null);
      return;
    }
    setExpanded(id);
    if (
      detailState[id]?.status === "loading" ||
      detailState[id]?.status === "ready"
    )
      return;
    setDetailState((current) => ({ ...current, [id]: { status: "loading" } }));
    try {
      const result = await getAdminModelCall(id);
      setDetailState((current) => ({
        ...current,
        [id]: { status: "ready", item: result },
      }));
    } catch (reason) {
      setDetailState((current) => ({
        ...current,
        [id]: {
          status: "error",
          message: reason instanceof Error ? reason.message : "详情读取失败",
        },
      }));
    }
  }

  if (!items.length) return <EmptyPanel text="暂无调用记录" />;
  return (
    <AdminTable
      head={[
        "时间（北京）",
        "调用",
        "模型 / 渠道",
        "账号 / 昵称",
        "状态",
        "耗时",
        "错误 / 关联任务",
        "操作",
      ]}
    >
      {items.map((item) => (
        <Fragment key={item.id}>
          <tr className="border-b border-border/60 align-top">
            <td className="whitespace-nowrap px-3 py-3 text-xs text-text-muted">
              {formatCallTime(item.startedAt)}
            </td>
            <td className="px-3 py-3 text-xs">
              <span className="whitespace-nowrap">
                {CALL_OPERATION_LABELS[item.operation] ?? item.operation}
              </span>
              <p className="mt-1 text-text-muted">
                {CALL_SOURCE_LABELS[item.source] ?? item.source}
              </p>
            </td>
            <td className="w-44 min-w-40 max-w-56 break-words px-3 py-2.5 text-xs">
              <p>{item.modelId}</p>
              <p className="mt-1 text-text-muted">{item.providerName ?? "—"}</p>
            </td>
            <td className="w-44 min-w-40 max-w-48 break-words px-3 py-2.5 text-xs">
              <p className="break-all">
                {item.userEmail ?? item.userId ?? "系统调用"}
              </p>
              <p className="mt-1 text-text-muted">
                {item.userName ? `昵称：${item.userName}` : "昵称未设置"}
              </p>
            </td>
            <td
              className={`whitespace-nowrap px-3 py-3 text-xs ${item.status === "FAILED" ? "text-danger" : item.status === "SUCCEEDED" ? "text-success" : "text-text-muted"}`}
            >
              {statusLabels[item.status] ?? item.status}
              {item.httpStatus && (
                <p className="mt-1 font-mono">HTTP {item.httpStatus}</p>
              )}
            </td>
            <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs">
              {item.durationMs === null
                ? "—"
                : `${(item.durationMs / 1000).toFixed(1)}s`}
            </td>
            <td className="min-w-52 max-w-md px-3 py-2.5 text-xs">
              {item.errorCategory && (
                <p className="text-danger">
                  {CALL_ERROR_LABELS[item.errorCategory] ?? item.errorCategory}
                </p>
              )}
              {item.errorMessage && (
                <p className="mt-1 line-clamp-2 break-all text-text-muted">
                  {item.errorMessage}
                </p>
              )}
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {item.generationId && (
                  <Link
                    className="text-accent underline underline-offset-2"
                    href={`/admin/generations?generationId=${encodeURIComponent(item.generationId)}`}
                  >
                    图片任务
                  </Link>
                )}
              </div>
            </td>
            <td className="whitespace-nowrap px-3 py-2.5 text-xs">
              <button
                type="button"
                aria-expanded={expanded === item.id}
                onClick={() => void toggleDetails(item.id)}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-[rgb(var(--control-border))] px-2 text-text-muted transition-colors hover:border-[rgb(var(--control-border-hover))] hover:bg-[rgb(var(--control-bg-hover))] hover:text-foreground"
              >
                {expanded === item.id ? (
                  <ChevronDown size={13} />
                ) : (
                  <ChevronRight size={13} />
                )}
                详情
              </button>
            </td>
          </tr>
          {expanded === item.id && (
            <tr className="border-b border-border bg-surface-2/35">
              <td colSpan={8} className="px-3 py-4 text-xs sm:px-4">
                <ModelCallDetailState state={detailState[item.id]} />
              </td>
            </tr>
          )}
        </Fragment>
      ))}
    </AdminTable>
  );
}

export function ModelCallsView() {
  const nextRequest = useRef<AbortController | null>(null);
  const [view, setView] = useState("llm");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [items, setItems] = useState<AdminModelCall[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const query: ModelCallQuery = {
    kind: view === "llm" ? "llm" : "image",
    source: view === "llm" ? undefined : view,
    q: q.trim() || undefined,
    status: status || undefined,
    from: from || undefined,
    to: to || undefined,
  };
  const queryKey = JSON.stringify(query);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setItems(null);
    setNextCursor(null);
    const timer = window.setTimeout(() => {
      listAdminModelCalls(JSON.parse(queryKey), controller.signal)
        .then((result) => {
          if (!controller.signal.aborted) {
            setItems(result.items);
            setNextCursor(result.nextCursor);
          }
        })
        .catch((reason) => {
          if (!controller.signal.aborted)
            setError(
              reason instanceof Error ? reason.message : "调用记录读取失败",
            );
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 200);
    return () => {
      controller.abort();
      nextRequest.current?.abort();
      window.clearTimeout(timer);
    };
  }, [queryKey, refresh]);

  async function next() {
    if (!nextCursor || loading) return;
    setLoading(true);
    setError(null);
    const controller = new AbortController();
    nextRequest.current = controller;
    try {
      const result = await listAdminModelCalls(
        {
          ...query,
          cursor: nextCursor,
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setItems((current) => [...(current ?? []), ...result.items]);
      setNextCursor(result.nextCursor);
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(reason instanceof Error ? reason.message : "调用记录读取失败");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  return (
    <div>
      <AdminPageHeader
        eyebrow="Model calls"
        title="模型调用记录"
        actions={
          <IconButton
            aria-label="刷新调用记录"
            title="刷新调用记录"
            onClick={() => setRefresh((value) => value + 1)}
          >
            <RefreshCw size={15} />
          </IconButton>
        }
      />
      <div
        role="group"
        aria-label="调用分类"
        className="mb-4 flex flex-wrap gap-1 border-b border-border"
      >
        {[
          ["llm", "语言模型"],
          ["web", "网站生图"],
          ["api", "API 生图"],
          ["agent", "Agent 生图"],
        ].map(([value, label]) => (
          <button
            key={value}
            aria-pressed={view === value}
            onClick={() => setView(value)}
            className={`border-b-2 px-3 py-2 text-sm ${view === value ? "border-accent text-foreground" : "border-transparent text-text-muted"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <Input
          aria-label="搜索调用记录"
          className="w-64"
          placeholder="任务 / 请求 ID / 用户邮箱 / 昵称 / 错误"
          value={q}
          onChange={(event) => setQ(event.target.value)}
        />
        <Select
          aria-label="调用状态"
          className="w-32"
          value={status || "all"}
          onValueChange={(value) => setStatus(value === "all" ? "" : value)}
          options={[
            { value: "all", label: "全部状态" },
            ...Object.entries(statusLabels).map(([value, label]) => ({
              value,
              label,
            })),
          ]}
        />
        <label className="text-xs text-text-muted">
          开始日期
          <Input
            aria-label="开始日期"
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </label>
        <label className="text-xs text-text-muted">
          结束日期
          <Input
            aria-label="结束日期"
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </label>
      </div>
      <ErrorText message={error} />
      {items ? (
        <ModelCallTable items={items} />
      ) : loading ? (
        <div className="h-40 animate-pulse bg-surface-2" />
      ) : null}
      {nextCursor && (
        <Button className="mt-4" disabled={loading} onClick={() => void next()}>
          {loading ? "加载中" : "加载更多"}
        </Button>
      )}
    </div>
  );
}
