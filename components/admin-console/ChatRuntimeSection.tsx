"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Loader2, RefreshCw, Save } from "lucide-react";
import { Button, Input, Switch, Textarea, Tooltip } from "@/components/ui";
import { LUNA_MODEL_ID, SOL_MODEL_ID } from "@/lib/chat-model-options";
import {
  getAdminChatRuntime,
  patchAdminChatRuntime,
  type AdminChatRuntime,
} from "./lib/api";
import { AdminField, ErrorText } from "./ui";

const profiles = [
  ["default", "默认对话模型"],
  [LUNA_MODEL_ID, "GPT-5.6 Luna"],
  [SOL_MODEL_ID, "GPT-6.1 Sol"],
] as const;

export function ChatRuntimeSection() {
  const [status, setStatus] = useState<AdminChatRuntime | null>(null);
  const [form, setForm] = useState({
    enabled: true,
    profiles: [] as string[],
    users: "",
    queueSeconds: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const value = await getAdminChatRuntime();
      setStatus(value);
      setForm({
        enabled: value.config.enabled,
        profiles: value.config.profiles,
        users: value.config.userAllowlist.join("\n"),
        queueSeconds:
          value.config.queueTimeoutMs === null
            ? ""
            : String(value.config.queueTimeoutMs / 1000),
      });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "运行状态加载失败");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (loading || saving || !status) return;
    const seconds =
      form.queueSeconds.trim() === "" ? null : Number(form.queueSeconds);
    if (
      seconds !== null &&
      (!Number.isInteger(seconds) || seconds < 1 || seconds > 86400)
    ) {
      setError("排队超时须为 1 到 86400 秒，留空不限时");
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await patchAdminChatRuntime({
        enabled: form.enabled,
        profiles: form.profiles,
        userAllowlist: [
          ...new Set(form.users.split(/[\s,，]+/).filter(Boolean)),
        ],
        queueTimeoutMs: seconds === null ? null : seconds * 1000,
      });
      await load();
      setNotice(
        form.enabled
          ? "新任务准入配置已保存"
          : "已暂停接收新任务，已有任务可继续完成或停止",
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "配置保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="surface-panel min-w-0 overflow-hidden p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">对话运行状态</h2>
        <div className="flex items-center gap-3 text-xs text-text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span
              className={`h-1.5 w-1.5 rounded-full ${status?.health.online ? "bg-success" : "bg-warning"}`}
            />
            {status?.health.online ? "Worker 在线" : "Worker 未就绪"}
          </span>
          <Tooltip content="刷新运行状态">
            <Button
              type="button"
              aria-label="刷新运行状态"
              className="h-8 w-8 p-0"
              disabled={loading || saving}
              onClick={() => void load()}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>
          </Tooltip>
        </div>
      </div>
      <div className="mt-3">
        <ErrorText message={error} />
      </div>
      {notice ? (
        <p role="status" className="mb-3 text-xs text-success">
          {notice}
        </p>
      ) : null}
      {status ? (
        <>
          <dl className="mb-5 grid grid-cols-2 gap-4 border-b border-border pb-4 sm:grid-cols-4">
            {[
              ["排队", status.outstanding.queued],
              ["执行中", status.outstanding.running],
              ["预留", status.outstanding.reserved],
              ["活动会话", status.outstanding.activeConversations],
            ].map(([label, count]) => (
              <div key={label}>
                <dt className="text-xs text-text-muted">{label}</dt>
                <dd className="mt-1 font-mono text-lg font-medium tabular-nums">
                  {count}
                </dd>
              </div>
            ))}
          </dl>
          <form onSubmit={save} className="grid gap-4">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="chat-runtime-enabled" className="text-sm">
                接受新任务
              </label>
              <Switch
                id="chat-runtime-enabled"
                checked={form.enabled}
                disabled={loading || saving}
                onChange={(enabled) =>
                  setForm((current) => ({ ...current, enabled }))
                }
              />
            </div>
            <fieldset disabled={loading || saving} className="min-w-0">
              <legend className="mb-2 text-xs text-text-muted">开放模型</legend>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {profiles.map(([id, label]) => (
                  <label
                    key={id}
                    className="inline-flex cursor-pointer items-center gap-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[var(--accent)]"
                      checked={form.profiles.includes(id)}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          profiles: event.target.checked
                            ? [...current.profiles, id]
                            : current.profiles.filter((item) => item !== id),
                        }))
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              <AdminField label="灰度用户 ID（留空为全部用户）">
                <Textarea
                  aria-label="灰度用户 ID"
                  rows={3}
                  value={form.users}
                  disabled={loading || saving}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      users: event.target.value,
                    }))
                  }
                  className="min-h-20 w-full resize-y font-mono text-xs"
                />
              </AdminField>
              <AdminField label="排队超时（秒，留空不限时）">
                <Input
                  aria-label="排队超时（秒）"
                  type="number"
                  min={1}
                  max={86400}
                  step={1}
                  value={form.queueSeconds}
                  disabled={loading || saving}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      queueSeconds: event.target.value,
                    }))
                  }
                />
              </AdminField>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-text-muted">
                {status.drained
                  ? "无在途任务或预留积分"
                  : "仍有在途任务或预留积分"}{" "}
                · 协议 v{status.protocolVersion}
              </span>
              <Button
                type="submit"
                className="h-9 gap-2 px-4 text-sm"
                disabled={loading || saving}
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                保存
              </Button>
            </div>
          </form>
          {status.health.instances.length ? (
            <div className="mt-5 overflow-x-auto border-t border-border pt-3">
              <table className="w-full min-w-[540px] text-left text-xs">
                <thead className="text-text-muted">
                  <tr>
                    <th className="py-2 font-normal">实例</th>
                    <th className="py-2 font-normal">构建</th>
                    <th className="py-2 font-normal">协议</th>
                    <th className="py-2 font-normal">状态</th>
                    <th className="py-2 font-normal">任务</th>
                  </tr>
                </thead>
                <tbody>
                  {status.health.instances.map((instance) => (
                    <tr
                      key={instance.instanceId}
                      className="border-t border-border"
                    >
                      <td
                        className="max-w-48 truncate py-2 font-mono"
                        title={instance.instanceId}
                      >
                        {instance.hostname}:{instance.pid}
                      </td>
                      <td
                        className="max-w-36 truncate py-2 font-mono"
                        title={instance.buildId}
                      >
                        {instance.buildId}
                      </td>
                      <td className="py-2">
                        {instance.protocolVersions.join(", ")}
                      </td>
                      <td className="py-2">
                        {instance.status === "accepting"
                          ? "接收任务"
                          : "排空中"}
                      </td>
                      <td className="py-2 tabular-nums">{instance.running}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      ) : loading ? (
        <div className="h-44 animate-pulse bg-surface-soft" />
      ) : null}
    </section>
  );
}
