"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  IMAGE_SIZE_LABEL,
  IMAGE_SIZE_OPTIONS,
  RESPONSE_FORMAT_LABEL,
  RESPONSE_FORMAT_OPTIONS,
} from "@/lib/models/options";
import type { ImageSize, ResponseFormat } from "@/lib/models/types";
import type { ChannelRequestConfig } from "@/lib/provider-channel-request-config";
import { cn } from "@/lib/utils";

const TEMPLATE_PLACEHOLDER = `{
  "model": "{model}",
  "prompt": "{prompt}",
  "size": "{size}",
  "quality": "{quality}",
  "response_format": "{response_format}",
  "n": {n}
}`;

export function ChannelRequestConfigForm({
  baseUrl,
  initial,
}: {
  baseUrl: string;
  initial: ChannelRequestConfig;
}) {
  const router = useRouter();
  const [sizes, setSizes] = useState<ImageSize[]>(initial.sizes ?? []);
  const [responseFormat, setResponseFormat] = useState<ResponseFormat>(
    initial.responseFormat ?? "b64_json",
  );
  const [bodyTemplate, setBodyTemplate] = useState(initial.bodyTemplate ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function toggleSize(size: ImageSize) {
    setSizes((current) =>
      current.includes(size)
        ? current.filter((item) => item !== size)
        : [...current, size],
    );
  }

  async function save() {
    // 校验模板是否为合法 JSON（留空表示用结构化字段自动拼）。
    const template = bodyTemplate.trim();
    if (template) {
      try {
        JSON.parse(
          template
            .split("{prompt}")
            .join("placeholder")
            .replace(/\{n\}/g, "1"),
        );
      } catch {
        setMessage("原始模板不是合法 JSON（占位符替换后无法解析）");
        return;
      }
    }

    setIsSubmitting(true);
    setMessage("保存中...");

    try {
      const response = await fetch(
        "/api/admin/providers/channel-request-config",
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            baseUrl,
            sizes,
            responseFormat,
            bodyTemplate: template || null,
          }),
        },
      );
      const payload = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;

      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "保存失败");
      }

      setMessage("请求格式已保存");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <details className="admin-collapsible admin-subsection mt-3">
      <summary className="text-xs font-medium text-text-muted">
        请求格式（尺寸 / 返回格式 / 原始模板）
      </summary>

      <div className="mt-3 space-y-4">
        <div className="space-y-2">
          <p className="field-label">
            允许尺寸{" "}
            <span className="font-normal text-text-faint">
              （不选 = 全部允许）
            </span>
          </p>
          <div className="grid grid-cols-2 gap-2">
            {IMAGE_SIZE_OPTIONS.map((size) => {
              const active = sizes.includes(size);
              return (
                <button
                  key={size}
                  type="button"
                  className={cn(
                    "selection-card rounded-[8px] border px-2.5 py-2 text-left text-[11px] leading-4",
                    active && "selection-card-active text-foreground",
                  )}
                  aria-pressed={active}
                  onClick={() => toggleSize(size)}
                >
                  {IMAGE_SIZE_LABEL[size]}
                </button>
              );
            })}
          </div>
        </div>

        <label className="grid gap-1">
          <span className="field-label">默认返回格式</span>
          <select
            className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
            value={responseFormat}
            onChange={(event) =>
              setResponseFormat(event.target.value as ResponseFormat)
            }
          >
            {RESPONSE_FORMAT_OPTIONS.map((format) => (
              <option key={format} value={format}>
                {RESPONSE_FORMAT_LABEL[format]}
              </option>
            ))}
          </select>
        </label>

        <details className="admin-collapsible rounded-[6px] border border-border bg-surface/60 p-3">
          <summary className="text-xs font-medium text-text-muted">
            高级：原始请求体模板（留空 = 用上面结构化字段自动拼）
          </summary>
          <div className="mt-2 space-y-2">
            <p className="text-[11px] leading-4 text-text-faint">
              占位符：{"{model}"} / {"{prompt}"} / {"{size}"} / {"{quality}"} /{" "}
              {"{response_format}"} / {"{n}"} / {"{output_format}"} /{" "}
              {"{background}"}。仅用于无参考图的 JSON 出图请求。
            </p>
            <textarea
              className="min-h-40 w-full rounded-[6px] border border-border bg-surface px-3 py-2 font-mono text-xs leading-5"
              value={bodyTemplate}
              placeholder={TEMPLATE_PLACEHOLDER}
              maxLength={8000}
              onChange={(event) => setBodyTemplate(event.target.value)}
            />
          </div>
        </details>

        <div className="flex flex-wrap items-center gap-3">
          <button
            className="tool-button h-9"
            type="button"
            disabled={isSubmitting}
            onClick={() => void save()}
          >
            保存请求格式
          </button>
          {message ? (
            <span className="text-xs text-text-muted">{message}</span>
          ) : null}
        </div>
      </div>
    </details>
  );
}
