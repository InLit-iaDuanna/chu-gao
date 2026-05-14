"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import {
  IMAGE_ASPECT_RATIO_OPTIONS,
  IMAGE_RESOLUTION_OPTIONS,
} from "@/lib/models/options";
import type { AnnouncementTone } from "@/lib/system-config";

type ConfigEntry = { key: string; value: unknown };

async function patchSystemConfig(key: string, value: unknown) {
  const response = await fetch("/api/admin/system-config", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key, value }),
  });
  const payload = (await response.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;

  if (!response.ok) {
    throw new Error(payload?.error?.message ?? "保存失败");
  }
}

function entryValue(entries: ReadonlyArray<ConfigEntry>, key: string): unknown {
  return entries.find((entry) => entry.key === key)?.value;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function toneValue(value: unknown): AnnouncementTone {
  return value === "warning" ||
    value === "success" ||
    value === "danger" ||
    value === "info"
    ? value
    : "info";
}

function stringArrayValue(
  value: unknown,
  allowed: readonly string[],
  fallback: readonly string[],
): string[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  const allowedSet = new Set(allowed);
  const unique = value.filter(
    (item, index): item is string =>
      typeof item === "string" &&
      allowedSet.has(item) &&
      value.indexOf(item) === index,
  );

  return unique.length > 0 ? unique : [...fallback];
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clampImage2MaxN(value: unknown): number {
  return Math.max(1, Math.min(4, numberValue(value, 4)));
}

const TONE_OPTIONS: Array<{ value: AnnouncementTone; label: string }> = [
  { value: "info", label: "普通" },
  { value: "warning", label: "提醒" },
  { value: "success", label: "成功" },
  { value: "danger", label: "紧急" },
];

export function ConfigEditor({
  entries,
}: {
  entries: ReadonlyArray<ConfigEntry>;
}) {
  const router = useRouter();
  const initialAnnouncement = useMemo(
    () => ({
      enabled: booleanValue(entryValue(entries, "announcement.enabled")),
      title: stringValue(entryValue(entries, "announcement.title")),
      body: stringValue(entryValue(entries, "announcement.body")),
      tone: toneValue(entryValue(entries, "announcement.tone")),
    }),
    [entries],
  );
  const initialImage2Limits = useMemo(
    () => ({
      aspectRatios: stringArrayValue(
        entryValue(entries, "generation.image2AspectRatios"),
        IMAGE_ASPECT_RATIO_OPTIONS,
        IMAGE_ASPECT_RATIO_OPTIONS,
      ),
      resolutions: stringArrayValue(
        entryValue(entries, "generation.image2Resolutions"),
        IMAGE_RESOLUTION_OPTIONS,
        IMAGE_RESOLUTION_OPTIONS,
      ),
      maxN: clampImage2MaxN(entryValue(entries, "generation.image2MaxN")),
    }),
    [entries],
  );
  const [enabled, setEnabled] = useState(initialAnnouncement.enabled);
  const [title, setTitle] = useState(initialAnnouncement.title);
  const [body, setBody] = useState(initialAnnouncement.body);
  const [tone, setTone] = useState<AnnouncementTone>(initialAnnouncement.tone);
  const [image2AspectRatios, setImage2AspectRatios] = useState(
    initialImage2Limits.aspectRatios,
  );
  const [image2Resolutions, setImage2Resolutions] = useState(
    initialImage2Limits.resolutions,
  );
  const [image2MaxN, setImage2MaxN] = useState(initialImage2Limits.maxN);
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const canSubmit = body.length <= 500 && title.length <= 80 && !isSubmitting;
  const canSubmitImage2 =
    image2AspectRatios.length > 0 &&
    image2Resolutions.length > 0 &&
    image2MaxN >= 1 &&
    image2MaxN <= 4 &&
    !isSubmitting;

  function toggleListValue(
    values: string[],
    value: string,
    fallback: readonly string[],
  ) {
    const next = values.includes(value)
      ? values.filter((item) => item !== value)
      : [...values, value];

    return next.length > 0 ? next : [fallback[0] as string];
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    setIsSubmitting(true);
    setMessage("保存中...");

    try {
      await Promise.all([
        patchSystemConfig("announcement.enabled", enabled),
        patchSystemConfig("announcement.title", title.trim()),
        patchSystemConfig("announcement.body", body.trim()),
        patchSystemConfig("announcement.tone", tone),
      ]);
      setMessage("公告已保存");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function submitImage2Limits(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmitImage2) {
      return;
    }

    setIsSubmitting(true);
    setMessage("保存中...");

    try {
      await Promise.all([
        patchSystemConfig("generation.image2AspectRatios", image2AspectRatios),
        patchSystemConfig("generation.image2Resolutions", image2Resolutions),
        patchSystemConfig("generation.image2MaxN", image2MaxN),
      ]);
      setMessage("Image2 限制已保存");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="surface-panel grid gap-4 p-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="space-y-2">
        {entries.map((entry) => (
          <div
            key={entry.key}
            className="rounded-[6px] border border-border px-3 py-2 text-sm text-text-muted"
          >
            {entry.key}
          </div>
        ))}
      </aside>
      <div className="space-y-4">
        <div className="surface-panel-soft p-4">
          <p className="text-sm text-text-muted">系统配置编辑器</p>
          <p className="mt-2 text-lg font-semibold">运行配置</p>
          <p className="mt-3 text-sm leading-6 text-text-muted">
            这里展示注册、点数、并发和内容审核相关配置。修改配置会写入审计记录。
          </p>
        </div>
        <form onSubmit={submit} className="surface-panel-soft p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">全站公告</p>
              <p className="mt-1 text-xs text-text-muted">
                开启后会显示在全站顶部。
              </p>
            </div>
            <label className="inline-flex items-center gap-2 text-sm text-text-muted">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
              />
              启用
            </label>
          </div>
          <div className="mt-4 grid gap-3">
            <label className="grid gap-1">
              <span className="field-label">标题</span>
              <input
                className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
                maxLength={80}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label className="grid gap-1">
              <span className="field-label">正文</span>
              <textarea
                className="min-h-28 rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
                maxLength={500}
                value={body}
                onChange={(event) => setBody(event.target.value)}
              />
            </label>
            <label className="grid gap-1 sm:max-w-xs">
              <span className="field-label">级别</span>
              <select
                className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
                value={tone}
                onChange={(event) =>
                  setTone(event.target.value as AnnouncementTone)
                }
              >
                {TONE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              className="tool-button h-10"
              type="submit"
              disabled={!canSubmit}
            >
              保存公告
            </button>
            {message ? (
              <span className="text-sm text-text-muted">{message}</span>
            ) : null}
          </div>
        </form>
        <form onSubmit={submitImage2Limits} className="surface-panel-soft p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Image2 前台限制</p>
              <p className="mt-1 text-xs text-text-muted">
                控制创作页可选的比例、分辨率和单次张数。
              </p>
            </div>
            <label className="grid gap-1 text-sm text-text-muted">
              <span className="field-label">最大张数</span>
              <input
                className="h-9 w-24 rounded-[6px] border border-border bg-surface px-3"
                type="number"
                min={1}
                max={4}
                value={image2MaxN}
                onChange={(event) =>
                  setImage2MaxN(
                    clampImage2MaxN(Number.parseInt(event.target.value, 10)),
                  )
                }
              />
            </label>
          </div>

          <div className="mt-4 grid gap-4">
            <div className="space-y-2">
              <p className="field-label">比例</p>
              <div className="grid grid-cols-3 gap-2 md:grid-cols-5">
                {IMAGE_ASPECT_RATIO_OPTIONS.map((ratio) => (
                  <label
                    key={ratio}
                    className="inline-flex items-center gap-2 rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={image2AspectRatios.includes(ratio)}
                      onChange={() =>
                        setImage2AspectRatios((current) =>
                          toggleListValue(
                            current,
                            ratio,
                            IMAGE_ASPECT_RATIO_OPTIONS,
                          ),
                        )
                      }
                    />
                    {ratio}
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <p className="field-label">分辨率</p>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                {IMAGE_RESOLUTION_OPTIONS.map((resolution) => (
                  <label
                    key={resolution}
                    className="inline-flex items-center gap-2 rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={image2Resolutions.includes(resolution)}
                      onChange={() =>
                        setImage2Resolutions((current) =>
                          toggleListValue(
                            current,
                            resolution,
                            IMAGE_RESOLUTION_OPTIONS,
                          ),
                        )
                      }
                    />
                    {resolution}
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              className="tool-button h-10"
              type="submit"
              disabled={!canSubmitImage2}
            >
              保存 Image2 限制
            </button>
            {message ? (
              <span className="text-sm text-text-muted">{message}</span>
            ) : null}
          </div>
        </form>
      </div>
    </div>
  );
}
