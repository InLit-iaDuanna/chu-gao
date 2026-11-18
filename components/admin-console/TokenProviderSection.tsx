"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Loader2, RefreshCw, Save } from "lucide-react";
import { Button, Input, Switch } from "@/components/ui";
import type {
  ChatTokenPricing,
  GeminiConfigUpdate,
  GeminiStatus,
  PremiumAnthropicConfigUpdate,
  PremiumAnthropicStatus,
} from "@/lib/chat-model-options";
import { AdminField, ErrorText } from "./ui";

type TokenStatus = GeminiStatus | PremiumAnthropicStatus;
type TokenUpdate = GeminiConfigUpdate | PremiumAnthropicConfigUpdate;

const rates = [
  ["input", "输入"],
  ["output", "输出"],
  ["cacheRead", "缓存读取"],
  ["cacheCreation", "缓存创建"],
] as const satisfies ReadonlyArray<
  readonly [keyof Omit<ChatTokenPricing, "type">, string]
>;

interface TokenProviderSectionProps {
  id: string;
  title: string;
  description: string;
  modelLabels: string[];
  load: () => Promise<TokenStatus>;
  save: (input: TokenUpdate) => Promise<TokenStatus>;
  loadingLabel: string;
  savedLabel: string;
}

function formFrom(data: TokenStatus) {
  return {
    enabled: data.enabled,
    baseUrl: data.baseUrl,
    apiKey: "",
    input: String(data.pricing.input),
    output: String(data.pricing.output),
    cacheRead: String(data.pricing.cacheRead),
    cacheCreation: String(data.pricing.cacheCreation),
  };
}

export function TokenProviderSection({
  id,
  title,
  description,
  modelLabels,
  load,
  save,
  loadingLabel,
  savedLabel,
}: TokenProviderSectionProps) {
  const [status, setStatus] = useState<TokenStatus | null>(null);
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
    load()
      .then((data) => {
        if (!active) return;
        setStatus(data);
        setForm(formFrom(data));
        setClearKey(false);
      })
      .catch((failure: unknown) => {
        if (active)
          setError(
            failure instanceof Error ? failure.message : `${title}配置加载失败`,
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [load, title, version]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !status) return;
    setError(null);
    setNotice(null);
    const pricing: NonNullable<TokenUpdate["pricing"]> = {};
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
      const data = await save({
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
      setNotice(savedLabel);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : `${title}配置保存失败`,
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className="surface-panel p-5"
      aria-labelledby={`${id}-title`}
      aria-busy={busy}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id={`${id}-title`} className="eyebrow">
            {title}
          </h2>
          <p className="mt-1 text-sm text-text-muted">{description}</p>
        </div>
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
          {loadingLabel}
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
        <form className="mt-4 grid gap-3" onSubmit={submit}>
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
            <AdminField label="可用模型">
              <Input value={modelLabels.join("、")} readOnly disabled={busy} />
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
