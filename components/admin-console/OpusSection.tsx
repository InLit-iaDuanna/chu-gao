"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Loader2, RefreshCw, Save } from "lucide-react";
import { Button, Input, Switch } from "@/components/ui";
import {
  OPUS_MODEL_ID,
  type OpusConfigUpdate,
  type OpusStatus,
} from "@/lib/chat-model-options";
import { getAdminOpus, patchAdminOpus } from "./lib/api";
import { AdminField, ErrorText } from "./ui";

const rates = [
  ["input", "输入"],
  ["output", "输出"],
  ["cacheRead", "缓存读取"],
  ["cacheCreation", "缓存创建"],
] as const;
const formFrom = (data: OpusStatus) => ({
  enabled: data.enabled,
  baseUrl: data.baseUrl,
  apiKey: "",
  input: String(data.pricing.input),
  output: String(data.pricing.output),
  cacheRead: String(data.pricing.cacheRead),
  cacheCreation: String(data.pricing.cacheCreation),
});

export function OpusSection() {
  const [status, setStatus] = useState<OpusStatus | null>(null);
  const [form, setForm] = useState({
    enabled: false,
    baseUrl: "",
    apiKey: "",
    input: "",
    output: "",
    cacheRead: "",
    cacheCreation: "",
  });
  const [clearKey, setClearKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const busy = loading || saving;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    getAdminOpus()
      .then((data) => {
        if (!active) return;
        setStatus(data);
        setForm(formFrom(data));
        setClearKey(false);
      })
      .catch((failure: unknown) => {
        if (active)
          setError(
            failure instanceof Error ? failure.message : "Opus 配置加载失败",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [version]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || !status) return;
    setError(null);
    setNotice(null);
    const pricing: NonNullable<OpusConfigUpdate["pricing"]> = {};
    for (const [key] of rates) {
      const value = Number(form[key]);
      if (
        !form[key].trim() ||
        !Number.isFinite(value) ||
        value < 0 ||
        value > 1_000_000 ||
        value !== Number(value.toFixed(6))
      ) {
        setError("每百万 token 积分须为 0 到 1000000，最多六位小数");
        return;
      }
      pricing[key] = value;
    }
    if (!clearKey && form.apiKey !== "" && !form.apiKey.trim()) {
      setError("API Key 不能仅包含空格");
      return;
    }
    setSaving(true);
    try {
      const data = await patchAdminOpus({
        enabled: form.enabled,
        baseUrl: form.baseUrl.trim(),
        pricing,
        ...(clearKey
          ? { apiKey: "" }
          : form.apiKey
            ? { apiKey: form.apiKey.trim() }
            : {}),
      });
      setStatus(data);
      setForm(formFrom(data));
      setClearKey(false);
      setNotice("Opus 配置已保存");
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Opus 配置保存失败",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className="surface-panel p-5"
      aria-labelledby="opus-section-title"
      aria-busy={busy}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="opus-section-title" className="eyebrow">
          Opus 5.5
        </h2>
        {status ? (
          <span className="text-[11px] text-text-faint">
            {status.hasKey ? "已配置密钥" : "未配置密钥"}
          </span>
        ) : null}
      </div>
      {loading ? (
        <div
          role="status"
          className="mt-4 flex items-center gap-2 text-sm text-text-muted"
        >
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          正在加载 Opus 配置
        </div>
      ) : !status ? (
        <div className="mt-4 grid justify-items-start gap-3">
          <ErrorText message={error} />
          <Button
            leftIcon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
            onClick={() => setVersion((value) => value + 1)}
          >
            重试
          </Button>
        </div>
      ) : (
        <form className="mt-4 grid gap-3" onSubmit={save}>
          <label className="flex items-center gap-2 text-sm text-text-muted">
            <Switch
              checked={form.enabled}
              disabled={busy}
              onChange={(enabled) => setForm({ ...form, enabled })}
            />
            启用
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <AdminField label="Base URL">
              <Input
                type="url"
                required
                disabled={busy}
                value={form.baseUrl}
                onChange={(event) =>
                  setForm({ ...form, baseUrl: event.target.value })
                }
              />
            </AdminField>
            <AdminField label="模型">
              <Input value={OPUS_MODEL_ID} readOnly disabled={busy} />
            </AdminField>
          </div>
          <AdminField label="API Key（留空不修改）">
            <Input
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              disabled={busy || clearKey}
              value={form.apiKey}
              onChange={(event) =>
                setForm({ ...form, apiKey: event.target.value })
              }
            />
          </AdminField>
          <label className="flex items-center gap-2 text-sm text-text-muted">
            <Switch
              checked={clearKey}
              disabled={busy || !status.hasKey}
              onChange={setClearKey}
            />
            保存时清除密钥
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            {rates.map(([key, name]) => (
              <AdminField key={key} label={`${name}积分 / 百万 token`}>
                <Input
                  type="number"
                  min={0}
                  max={1_000_000}
                  step={0.000001}
                  required
                  disabled={busy}
                  value={form[key]}
                  onChange={(event) =>
                    setForm({ ...form, [key]: event.target.value })
                  }
                />
              </AdminField>
            ))}
          </div>
          {error ? (
            <div role="alert">
              <ErrorText message={error} />
            </div>
          ) : null}
          {notice ? (
            <p role="status" className="text-sm text-success">
              {notice}
            </p>
          ) : null}
          <div>
            <Button
              type="submit"
              disabled={busy}
              loading={saving}
              leftIcon={<Save className="h-4 w-4" aria-hidden="true" />}
            >
              保存
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
