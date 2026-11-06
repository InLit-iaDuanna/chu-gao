"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  deleteJson,
  patchJson,
} from "@/components/admin/admin-form-utils";

/**
 * 渠道（大渠道）设置：改前台显示名、改总并发、停用整组。
 * 行为从 ProviderChannelGroupPanel 原样抽取：相同的端点与请求体。
 *   - 保存：PATCH /api/admin/providers/{providerId}/channels { baseUrl, displayName?, maxConcurrency? }
 *   - 停用：DELETE /api/admin/providers/{providerId}/channels { baseUrl }
 */
export function ChannelSettingsForm({
  providerId,
  baseUrl,
  displayName: initialDisplayName,
  maxConcurrency: initialMaxConcurrency,
  accountCount,
}: {
  providerId: string;
  baseUrl: string;
  displayName: string;
  maxConcurrency: number;
  accountCount: number;
}) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [maxConcurrency, setMaxConcurrency] = useState(initialMaxConcurrency);
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function saveSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextName = displayName.trim();
    const nextConcurrency = Number(maxConcurrency);
    const payload: {
      baseUrl: string;
      displayName?: string;
      maxConcurrency?: number;
    } = {
      baseUrl,
    };

    if (nextName && nextName !== initialDisplayName) {
      payload.displayName = nextName;
    }

    if (
      Number.isFinite(nextConcurrency) &&
      nextConcurrency > 0 &&
      nextConcurrency !== initialMaxConcurrency
    ) {
      payload.maxConcurrency = nextConcurrency;
    }

    if (!payload.displayName && payload.maxConcurrency === undefined) {
      return;
    }

    setIsSubmitting(true);
    setMessage("保存中...");

    try {
      await patchJson(`/api/admin/providers/${providerId}/channels`, {
        ...payload,
      });
      setMessage("设置已保存");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function disableGroup() {
    if (
      !window.confirm(
        `确定停用「${initialDisplayName}」下的 ${accountCount} 个账号吗？历史任务会保留。`,
      )
    ) {
      return;
    }

    setIsSubmitting(true);
    setMessage("停用中...");

    try {
      const payload = (await deleteJson(
        `/api/admin/providers/${providerId}/channels`,
        { baseUrl },
      )) as { data?: { disabled: number } };

      setMessage(`已停用 ${payload.data?.disabled ?? accountCount} 个账号`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "停用失败");
    } finally {
      setIsSubmitting(false);
    }
  }

  const saveDisabled =
    isSubmitting ||
    ((!displayName.trim() || displayName.trim() === initialDisplayName) &&
      (Number(maxConcurrency) === initialMaxConcurrency ||
        !Number.isFinite(Number(maxConcurrency))));

  return (
    <div className="space-y-5">
      <form
        className="grid items-end gap-3 lg:grid-cols-[minmax(0,1fr)_140px_auto]"
        onSubmit={saveSettings}
      >
        <label className="grid gap-1">
          <span className="field-label">前台显示名</span>
          <input
            className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
            maxLength={80}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </label>
        <label className="grid gap-1">
          <span className="field-label">总并发</span>
          <input
            className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
            type="number"
            min={1}
            max={10_000}
            value={maxConcurrency}
            onChange={(event) => setMaxConcurrency(Number(event.target.value))}
          />
        </label>
        <button
          className="tool-button h-10"
          type="submit"
          disabled={saveDisabled}
        >
          保存
        </button>
      </form>

      <div className="admin-subsection space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="field-label">停用整组</p>
            <p className="mt-1 text-xs leading-5 text-text-faint">
              停用这个大渠道下的 {accountCount} 个账号，历史任务会保留。
            </p>
          </div>
          <button
            className="tool-button h-9 text-danger"
            type="button"
            disabled={isSubmitting || accountCount === 0}
            onClick={() => void disableGroup()}
          >
            停用整组
          </button>
        </div>
      </div>

      {message ? (
        <p className="text-sm text-text-muted">{message}</p>
      ) : null}
    </div>
  );
}
