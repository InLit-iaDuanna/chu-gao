"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Loader2, RefreshCw, Save } from "lucide-react";

import { Button, Input, Switch } from "@/components/ui";
import {
  ASTRA_MODEL_ID,
  CHAT_PRICE_BASE_MODEL_ID,
  SOL_MODEL_ID,
} from "@/lib/chat-model-options";
import type { GptConfigUpdate, GptStatus } from "@/lib/chat-model-options";

import { getAdminAstra, getAdminSol, patchAdminAstra, patchAdminSol } from "./lib/api";
import { AdminField, ErrorText } from "./ui";

const BASE_LABEL = "Opus 5.5";

/**
 * Sol and Astra share one gateway and key; only the switch and the read-only
 * rate summary differ. Both are priced as Opus 5.5 × fixed multiplier.
 */
export function GptSection({
  variant,
}: {
  variant: "sol" | "astra";
}) {
  const isSol = variant === "sol";
  const name = isSol ? "GPT-6.2 Sol" : "GPT-6.2 Astra";
  const modelId = isSol ? SOL_MODEL_ID : ASTRA_MODEL_ID;
  const getStatus = isSol ? getAdminSol : getAdminAstra;
  const patchStatus = isSol ? patchAdminSol : patchAdminAstra;
  const [status, setStatus] = useState<GptStatus | null>(null);
  const [form, setForm] = useState({ enabled: false, baseUrl: "", apiKey: "" });
  const [clearKey, setClearKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadVersion, setLoadVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const busy = loading || saving;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    getStatus()
      .then((data) => {
        if (!active) return;
        setStatus(data);
        setForm({ enabled: data.enabled, baseUrl: data.baseUrl, apiKey: "" });
      })
      .catch((loadError: unknown) => {
        if (!active) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : `${name} 配置加载失败`,
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [loadVersion, name, getStatus]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !status) return;
    setError(null);
    setNotice(null);
    if (!clearKey && form.apiKey !== "" && !form.apiKey.trim()) {
      setError("API Key 不能仅包含空格");
      return;
    }
    const input: GptConfigUpdate = {
      enabled: form.enabled,
      ...(isSol
        ? {
            baseUrl: form.baseUrl.trim(),
            ...(clearKey
              ? { apiKey: "" }
              : form.apiKey !== ""
                ? { apiKey: form.apiKey.trim() }
                : {}),
          }
        : {}),
    };
    setSaving(true);
    try {
      const data = await patchStatus(input);
      setStatus(data);
      setForm({ enabled: data.enabled, baseUrl: data.baseUrl, apiKey: "" });
      setClearKey(false);
      setNotice(`${name} 配置已保存`);
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : `${name} 配置保存失败`,
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className="min-w-0 border-t border-border pt-5"
      aria-labelledby={`${variant}-section-title`}
      aria-busy={busy}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`${variant}-section-title`} className="text-sm font-semibold">
          {name}
        </h2>
        {status ? (
          <span className="text-xs text-text-faint">
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
          正在加载 {name} 配置
        </div>
      ) : !status ? (
        <div className="mt-4 grid justify-items-start gap-3">
          <div role="alert">
            <ErrorText message={error} />
          </div>
          <Button
            disabled={busy}
            leftIcon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
            onClick={() => setLoadVersion((version) => version + 1)}
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
            <AdminField label={isSol ? "Base URL" : "Base URL（与 Sol 共用）"}>
              <Input
                className="h-9 text-sm"
                type="url"
                required
                readOnly={!isSol}
                disabled={busy}
                value={form.baseUrl}
                onChange={(event) =>
                  setForm({ ...form, baseUrl: event.target.value })
                }
              />
            </AdminField>
            <AdminField label="模型">
              <Input
                className="h-9 text-sm"
                value={modelId}
                readOnly
                disabled={busy}
              />
            </AdminField>
          </div>
          <AdminField label="计费">
            <Input
              className="h-9 text-sm"
              value={`${BASE_LABEL} × ${status.multiplier} · 输入 ${status.pricing.input} / 输出 ${status.pricing.output} 积分每百万 token`}
              readOnly
              disabled={busy}
            />
          </AdminField>
          <p className="text-xs leading-5 text-text-faint">
            价格跟随 {BASE_LABEL}（{CHAT_PRICE_BASE_MODEL_ID}）的单价自动换算，
            改 {BASE_LABEL} 的价格这里会一起变。
          </p>
          {isSol ? (
            <>
              <AdminField label="API Key（留空不修改）">
                <Input
                  className="h-9 text-sm"
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
            </>
          ) : null}
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
