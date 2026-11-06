"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, ExternalLink, Loader2, RefreshCw, Save, X } from "lucide-react";
import { Button, Input } from "@/components/ui";
import type { ResearchConfig } from "@/lib/research/config";
import { SCOPE_LABELS, STATUS_LABELS } from "@/lib/research/types";

type View = {
  config: ResearchConfig;
  services: Array<{
    id: string;
    label: string;
    ready: boolean;
    status: string;
  }>;
  workerReady: boolean;
  modelReady: boolean;
  tasks: Array<{
    id: string;
    projectId: string;
    preset: string;
    modelId: string;
    status: string;
    llmCalls: number;
    searchCalls: number;
    crawlCalls: number;
    createdAt: string;
    finishedAt: string | null;
    project: { title: string };
    calls: Array<{ kind: string; costUsd: string | null; status: string }>;
  }>;
};
export function ResearchView() {
  const [data, setData] = useState<View | null>(null);
  const [config, setConfig] = useState<ResearchConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  async function load() {
    try {
      const response = await fetch("/api/admin/research");
      const result = await response.json();
      if (!result.ok) throw Error(result.error?.message);
      setData(result.data);
      setConfig(result.data.config);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "研究设置加载失败");
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function save() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const response = await fetch("/api/admin/research", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const result = await response.json();
      if (!result.ok) throw Error(result.error?.message);
      setConfig(result.data);
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="mx-auto max-w-6xl space-y-7 p-4 sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">研究工作台</h1>
          <p className="mt-1 text-sm text-text-muted">
            管理员内测 · 仅记录成本
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => void load()}>
            <RefreshCw size={14} />
            刷新
          </Button>
          <Button size="sm" asChild>
            <Link href="/app/research">
              <ExternalLink size={14} />
              打开工作台
            </Link>
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {!data || !config ? (
        <p className="flex items-center gap-2 py-8 text-sm text-text-muted">
          <Loader2 size={16} className="animate-spin" />
          读取配置
        </p>
      ) : (
        <>
          <section className="border-y border-border py-5">
            <h2 className="mb-4 text-sm font-semibold">服务状态</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ...data.services,
                {
                  id: "worker",
                  label: "研究执行器",
                  ready: data.workerReady,
                  status: data.workerReady ? "就绪" : "未连接",
                },
                {
                  id: "model",
                  label: "Sol 模型配置",
                  ready: data.modelReady,
                  status: data.modelReady ? "已配置" : "未配置",
                },
              ].map((service) => (
                <div
                  key={service.id}
                  className="flex min-w-0 items-center gap-2 text-sm"
                >
                  {service.ready ? (
                    <Check size={15} className="shrink-0 text-success" />
                  ) : (
                    <X size={15} className="shrink-0 text-danger" />
                  )}
                  <span className="truncate">{service.label}</span>
                  <span className="ml-auto shrink-0 text-xs text-text-muted">
                    {service.status}
                  </span>
                </div>
              ))}
            </div>
          </section>
          <section>
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold">访问与存储</h2>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={config.enabled}
                  onChange={(event) =>
                    setConfig({ ...config, enabled: event.target.checked })
                  }
                />
                允许创建研究任务
              </label>
            </div>
            <label className="flex max-w-xs items-center gap-3 text-sm">
              文件保留天数
              <Input
                type="number"
                min={1}
                max={365}
                value={config.retentionDays}
                onChange={(event) =>
                  setConfig({
                    ...config,
                    retentionDays: Number(event.target.value),
                  })
                }
              />
            </label>
          </section>
          <section className="border-y border-border py-5">
            <h2 className="mb-4 text-sm font-semibold">自建服务地址</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {(
                [
                  ["searxUrl", "SearxNG"],
                  ["crawlUrl", "Crawl4AI"],
                  ["embeddingUrl", "本地向量"],
                  ["gptrUrl", "GPT Researcher"],
                  ["vaneUrl", "Vane"],
                  ["deerflowUrl", "DeerFlow"],
                  ["gatewayUrl", "引擎访问模型网关的内部地址"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="space-y-2 text-xs text-text-muted">
                  {label}
                  <Input
                    value={config[key]}
                    onChange={(event) =>
                      setConfig({ ...config, [key]: event.target.value })
                    }
                  />
                </label>
              ))}
            </div>
          </section>
          <section>
            <h2 className="mb-4 text-sm font-semibold">任务预算</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-left text-sm">
                <thead className="border-b border-border text-xs text-text-muted">
                  <tr>
                    <th className="py-2">范围</th>
                    <th>模型调用</th>
                    <th>搜索次数</th>
                    <th>采集次数</th>
                    <th>总时限 / 分钟</th>
                  </tr>
                </thead>
                <tbody>
                  {(["exploratory", "standard", "deep"] as const).map(
                    (scope) => (
                      <tr key={scope} className="border-b border-border">
                        <td className="py-3">{SCOPE_LABELS[scope]}</td>
                        {(["llm", "search", "crawl", "minutes"] as const).map(
                          (key) => (
                            <td key={key} className="px-1 py-3">
                              <Input
                                type="number"
                                min={1}
                                max={key === "minutes" ? 120 : 200}
                                value={config.limits[scope][key]}
                                onChange={(event) =>
                                  setConfig({
                                    ...config,
                                    limits: {
                                      ...config.limits,
                                      [scope]: {
                                        ...config.limits[scope],
                                        [key]: Number(event.target.value),
                                      },
                                    },
                                  })
                                }
                                className="max-w-28"
                              />
                            </td>
                          ),
                        )}
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          </section>
          <section className="border-b border-border pb-5">
            <h2 className="mb-4 text-sm font-semibold">上游成本估算</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {(
                [
                  ["inputUsdPerMillion", "输入 / 每百万 tokens / 美元"],
                  ["outputUsdPerMillion", "输出 / 每百万 tokens / 美元"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="space-y-2 text-xs text-text-muted">
                  {label}
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="未知"
                    value={config[key] ?? ""}
                    onChange={(event) =>
                      setConfig({
                        ...config,
                        [key]:
                          event.target.value === ""
                            ? null
                            : Number(event.target.value),
                      })
                    }
                  />
                </label>
              ))}
            </div>
          </section>
          <div className="flex items-center justify-end gap-3">
            {saved && <span className="text-xs text-success">已保存</span>}
            <Button
              variant="primary"
              loading={saving}
              onClick={() => void save()}
            >
              <Save size={14} />
              保存设置
            </Button>
          </div>
          <section>
            <h2 className="mb-4 text-sm font-semibold">最近任务</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-left text-xs">
                <thead className="border-b border-border text-text-muted">
                  <tr>
                    <th className="pb-3">项目</th>
                    <th>状态</th>
                    <th>模型 / 搜索 / 采集</th>
                    <th>耗时</th>
                    <th>LLM 成本</th>
                  </tr>
                </thead>
                <tbody>
                  {data.tasks.map((task) => {
                    const unknown = task.calls.some(
                      (call) => call.kind === "llm" && call.costUsd === null,
                    );
                    const cost = task.calls.reduce(
                      (sum, call) => sum + Number(call.costUsd ?? 0),
                      0,
                    );
                    return (
                      <tr key={task.id} className="border-b border-border">
                        <td className="max-w-60 py-3 pr-4">
                          <Link
                            href={
                              task.preset === "intake"
                                ? `/app/research?project=${task.projectId}`
                                : `/app/research?task=${task.id}`
                            }
                            className="block truncate text-brand"
                          >
                            {task.project.title}
                          </Link>
                        </td>
                        <td>{STATUS_LABELS[task.status]}</td>
                        <td>
                          {task.llmCalls} / {task.searchCalls} /{" "}
                          {task.crawlCalls}
                        </td>
                        <td>
                          {task.finishedAt
                            ? `${Math.round((new Date(task.finishedAt).getTime() - new Date(task.createdAt).getTime()) / 1000)} 秒`
                            : "进行中"}
                        </td>
                        <td>{unknown ? "未知" : `$${cost.toFixed(4)}`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
