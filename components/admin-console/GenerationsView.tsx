"use client";

import { Button, IconButton, Input, Select } from "@/components/ui";

import { useCallback, useEffect, useRef, useState } from "react";
import { Eye, Loader2, RefreshCw, Trash2 } from "lucide-react";

import { CALL_SOURCE_LABELS, formatCallTime } from "@/lib/model-call-types";
import { GenerationDetails } from "./GenerationDetails";

import {
  clearRecentAdminGenerations,
  isAdminApiError,
  listAdminGenerations,
  type AdminGenerationQuery,
} from "./lib/api";
import type { AdminGenerationItem } from "./lib/types";
import { AdminPageHeader, AdminTable, EmptyPanel, ErrorText } from "./ui";

const STATUS_OPTIONS = [
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "CANCELED",
] as const;

const STATUS_LABEL: Record<string, string> = {
  PENDING: "排队中",
  RUNNING: "生成中",
  SUCCEEDED: "已完成",
  FAILED: "失败",
  CANCELED: "已取消",
};

function statusTone(status: string): string {
  switch (status) {
    case "SUCCEEDED":
      return "text-success";
    case "FAILED":
      return "text-danger";
    case "CANCELED":
      return "text-text-faint";
    default:
      return "text-accent";
  }
}

function msLabel(value: number | null): string {
  if (value === null) return "—";
  if (value < 1000) return `${value}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}

export function GenerationsView({
  initialGenerationId = "",
}: {
  initialGenerationId?: string;
}) {
  const [items, setItems] = useState<AdminGenerationItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  const [q, setQ] = useState(initialGenerationId);
  const [source, setSource] = useState<"" | "web" | "api" | "agent">("");
  const [selected, setSelected] = useState<AdminGenerationItem | null>(null);
  const [status, setStatus] = useState("");
  const [modelId, setModelId] = useState("");
  const [activeOnly, setActiveOnly] = useState(false);
  const loadVersion = useRef(0);
  const initialOpened = useRef("");

  const load = useCallback((query: AdminGenerationQuery) => {
    const version = ++loadVersion.current;
    setFailed(false);
    listAdminGenerations({ ...query, limit: 100 })
      .then((result) => {
        if (version === loadVersion.current) setItems(result.items);
      })
      .catch(() => {
        if (version === loadVersion.current) setFailed(true);
      });
  }, []);

  useEffect(() => {
    setFailed(false);
    const timer = window.setTimeout(() => {
      load({
        source: source || undefined,
        q: q.trim() || undefined,
        status: status ? [status] : undefined,
        modelId: modelId.trim() || undefined,
        active: activeOnly || undefined,
      });
    }, 250);

    return () => window.clearTimeout(timer);
  }, [q, status, modelId, activeOnly, source, load]);

  useEffect(() => {
    if (
      initialGenerationId &&
      items &&
      initialOpened.current !== initialGenerationId
    ) {
      const match = items.find((item) => item.id === initialGenerationId);
      if (match) {
        setSelected(match);
        initialOpened.current = initialGenerationId;
      }
    }
  }, [initialGenerationId, items]);

  async function handleClearRecent() {
    if (!window.confirm("软删除最近 20 条生成记录？")) return;
    setClearing(true);
    setError(null);
    try {
      await clearRecentAdminGenerations(20);
      load({
        source: source || undefined,
        q: q.trim() || undefined,
        status: status ? [status] : undefined,
        modelId: modelId.trim() || undefined,
        active: activeOnly || undefined,
      });
    } catch (clearError) {
      setError(isAdminApiError(clearError) ? clearError.message : "清理失败");
    } finally {
      setClearing(false);
    }
  }

  return (
    <div>
      <AdminPageHeader
        eyebrow="Generations"
        title="生成记录"
        actions={
          <div className="flex gap-2">
            <IconButton
              aria-label="刷新生成记录"
              title="刷新生成记录"
              onClick={() =>
                load({
                  q: q.trim() || undefined,
                  source: source || undefined,
                  status: status ? [status] : undefined,
                  modelId: modelId.trim() || undefined,
                  active: activeOnly || undefined,
                })
              }
            >
              <RefreshCw size={15} />
            </IconButton>
            <Button
              type="button"
              className="h-9 px-3 text-xs text-danger disabled:opacity-45"
              disabled={clearing}
              onClick={() => void handleClearRecent()}
            >
              {clearing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5 stroke-[1.5]" />
              )}
              清理最近 20 条
            </Button>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <Select
          aria-label="任务来源"
          className="w-36"
          value={source || "all"}
          onValueChange={(value) =>
            setSource(value === "all" ? "" : (value as "web" | "api" | "agent"))
          }
          options={[
            { value: "all", label: "全部来源" },
            { value: "web", label: "网站生图" },
            { value: "api", label: "API 生图" },
            { value: "agent", label: "Agent 生图" },
          ]}
        />
        <Input
          className="w-64"
          placeholder="搜索提示词 / ID / 用户邮箱"
          value={q}
          onChange={(event) => setQ(event.target.value)}
        />
        <Select
          aria-label="生成状态"
          className="w-32"
          value={status || "all"}
          onValueChange={(value) => setStatus(value === "all" ? "" : value)}
          options={[
            { value: "all", label: "全部状态" },
            ...STATUS_OPTIONS.map((option) => ({
              value: option,
              label: STATUS_LABEL[option],
            })),
          ]}
        />
        <Input
          className="w-44"
          placeholder="模型 ID 过滤"
          value={modelId}
          onChange={(event) => setModelId(event.target.value)}
        />
        <label className="flex h-9 items-center gap-2 px-1 text-xs text-text-muted">
          <Input
            type="checkbox"
            checked={activeOnly}
            onChange={(event) => setActiveOnly(event.target.checked)}
          />
          仅看进行中
        </label>
      </div>

      <ErrorText message={error} />

      {failed ? (
        <EmptyPanel text="生成记录暂时不可用" />
      ) : !items ? (
        <div className="surface-panel h-64 animate-pulse" />
      ) : items.length === 0 ? (
        <EmptyPanel text="没有匹配的记录" />
      ) : (
        <AdminTable
          head={[
            "时间",
            "来源",
            "用户",
            "模型",
            "提示词",
            "状态",
            "渠道",
            "耗时",
            "点数",
            "图",
            "详情",
          ]}
        >
          {items.map((item) => (
            <tr
              key={item.id}
              className="border-b border-border/60 align-top last:border-0"
            >
              <td className="whitespace-nowrap px-4 py-2.5 text-xs text-text-muted">
                {formatCallTime(item.createdAt)}
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 text-xs">
                {CALL_SOURCE_LABELS[item.source] ?? "网站"}
              </td>
              <td className="max-w-36 truncate px-4 py-2.5 text-xs">
                {item.user?.email ?? item.userId}
              </td>
              <td className="px-4 py-2.5 font-mono text-xs">{item.modelId}</td>
              <td className="max-w-64 px-4 py-2.5">
                <p
                  className="line-clamp-2 text-xs leading-5"
                  title={item.prompt}
                >
                  {item.prompt}
                </p>
                {item.errorMessage ? (
                  <p
                    title={item.errorMessage}
                    className="mt-0.5 line-clamp-2 break-all text-[11px] text-danger"
                  >
                    {item.errorCode ? `[${item.errorCode}] ` : ""}
                    {item.errorMessage}
                  </p>
                ) : null}
              </td>
              <td className="whitespace-nowrap px-4 py-2.5">
                <span className={`text-xs ${statusTone(item.status)}`}>
                  {STATUS_LABEL[item.status] ?? item.status}
                </span>
                {item.isStuck ? (
                  <span className="ml-1 text-[10px] text-danger">(卡住)</span>
                ) : null}
              </td>
              <td className="max-w-32 truncate px-4 py-2.5 text-xs text-text-muted">
                {item.provider?.name ?? "—"}
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-text-muted">
                {msLabel(item.totalMs)}
              </td>
              <td className="px-4 py-2.5 font-mono text-xs">
                {item.costCredits}
              </td>
              <td className="px-4 py-2.5 font-mono text-xs text-text-muted">
                {item.imageCount}
              </td>
              <td className="px-4 py-2.5">
                <IconButton
                  aria-label={`查看任务 ${item.id}`}
                  title="查看图片与错误详情"
                  onClick={() => setSelected(item)}
                >
                  <Eye size={15} />
                </IconButton>
              </td>
            </tr>
          ))}
        </AdminTable>
      )}
      {selected && (
        <GenerationDetails item={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
