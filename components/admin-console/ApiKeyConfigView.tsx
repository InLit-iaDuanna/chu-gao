"use client";

import { useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";

import { Button, Input } from "@/components/ui";

import {
  getAdminApiKeyConfig,
  isAdminApiError,
  patchAdminApiKeyConfig,
  type ApiKeyRuntimeConfig,
} from "./lib/api";
import { AdminPageHeader, ErrorText } from "./ui";

type Field = keyof ApiKeyRuntimeConfig;

const FIELDS: {
  key: Field;
  label: string;
  hint: string;
  step?: number;
  min: number;
  max: number;
  unit: string;
}[] = [
  {
    key: "creditMultiplier",
    label: "积分倍率",
    hint: "API Key 调用时积分价格乘以此系数。1 = 与普通用户相同，1.2 = 贵 20%，0.8 = 便宜 20%",
    step: 0.05,
    min: 0,
    max: 100,
    unit: "×",
  },
  {
    key: "rateLimitPerMin",
    label: "每分钟限速",
    hint: "每个用户通过 API Key 每分钟最多提交的任务数。并发上限请在「用户」详情页按用户单独设置",
    min: 1,
    max: 10000,
    unit: "次/分",
  },
];

export function ApiKeyConfigView() {
  const [config, setConfig] = useState<ApiKeyRuntimeConfig | null>(null);
  const [form, setForm] = useState<ApiKeyRuntimeConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = () => {
    setLoading(true);
    setError(null);
    getAdminApiKeyConfig()
      .then((data) => {
        setConfig(data);
        setForm(data);
      })
      .catch((err) =>
        setError(isAdminApiError(err) ? err.message : "加载失败"),
      )
      .finally(() => setLoading(false));
  };

  useEffect(reload, []);

  // Sync form when config changes from outside
  useEffect(() => {
    if (config) setForm(config);
  }, [config]);

  const isDirty =
    form !== null &&
    config !== null &&
    FIELDS.some((f) => form[f.key] !== config[f.key]);

  const handleSave = async () => {
    if (!form) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await patchAdminApiKeyConfig(form);
      setConfig(updated);
      setForm(updated);
      setNotice("已保存");
      setTimeout(() => setNotice(null), 3000);
    } catch (err) {
      setError(isAdminApiError(err) ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <AdminPageHeader
        eyebrow="API Keys"
        title="API Key 配置"
        description="调整通过 API Key 调用时的积分倍率和提交限速"
        actions={
          <Button
            type="button"
            className="h-8 w-8 p-0 text-text-muted"
            onClick={reload}
            title="刷新"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        }
      />

      <ErrorText message={error} />
      {notice && <p className="mb-4 text-sm text-success">{notice}</p>}

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
        </div>
      ) : form ? (
        <div className="max-w-lg space-y-1 rounded-xl border border-border bg-surface">
          {FIELDS.map((field, i) => (
            <div
              key={field.key}
              className={`px-5 py-4 ${i !== 0 ? "border-t border-border" : ""}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{field.label}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-text-muted">
                    {field.hint}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Input
                    type="number"
                    min={field.min}
                    max={field.max}
                    step={field.step ?? 1}
                    className="h-8 w-28 font-mono text-sm"
                    value={form[field.key]}
                    onChange={(e) =>
                      setForm({ ...form, [field.key]: Number(e.target.value) })
                    }
                  />
                  <span className="w-12 text-xs text-text-muted">
                    {field.unit}
                  </span>
                </div>
              </div>
            </div>
          ))}

          <div className="border-t border-border px-5 py-4">
            <Button
              type="button"
              disabled={busy || !isDirty}
              className="h-8 px-4 text-sm disabled:opacity-40"
              onClick={handleSave}
            >
              {busy ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : null}
              保存配置
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
