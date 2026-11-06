"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Loader2, RefreshCw, Save } from "lucide-react";

import { Button, Input, Switch } from "@/components/ui";
import { LUNA_MODEL_ID, SOL_MODEL_ID } from "@/lib/chat-model-options";
import type { LunaConfigUpdate, LunaStatus } from "@/lib/chat-model-options";

import {
  getAdminLuna,
  getAdminSol,
  patchAdminLuna,
  patchAdminSol,
} from "./lib/api";
import { AdminField, ErrorText } from "./ui";

export function LunaSection({
  variant = "luna",
}: { variant?: "luna" | "sol" } = {}) {
  const modelId = variant === "sol" ? SOL_MODEL_ID : LUNA_MODEL_ID;
  const name = variant === "sol" ? "GPT-6.1 Sol" : "GPT-5.6 Luna";
  const getStatus = variant === "sol" ? getAdminSol : getAdminLuna;
  const patchStatus = variant === "sol" ? patchAdminSol : patchAdminLuna;
  const [status, setStatus] = useState<LunaStatus | null>(null);
  const [form, setForm] = useState({
    enabled: false,
    baseUrl: "",
    credits: "",
    apiKey: "",
  });
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
        setForm({
          enabled: data.enabled,
          baseUrl: data.baseUrl,
          credits: String(data.credits),
          apiKey: "",
        });
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
  }, [loadVersion, variant, getStatus, name]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !status) return;
    setError(null);
    setNotice(null);

    const credits = Number(form.credits);
    if (
      form.credits.trim() === "" ||
      !Number.isFinite(credits) ||
      credits < 0 ||
      credits > 1_000_000 ||
      credits !== Number(credits.toFixed(1))
    ) {
      setError("每轮积分须为 0 到 1000000，最多一位小数");
      return;
    }
    if (!clearKey && form.apiKey !== "" && !form.apiKey.trim()) {
      setError("API Key 不能仅包含空格");
      return;
    }

    const input: LunaConfigUpdate = {
      enabled: form.enabled,
      baseUrl: form.baseUrl.trim(),
      credits,
      ...(clearKey
        ? { apiKey: "" }
        : form.apiKey !== ""
          ? { apiKey: form.apiKey.trim() }
          : {}),
    };

    setSaving(true);
    try {
      const data = await patchStatus(input);
      setStatus(data);
      setForm({
        enabled: data.enabled,
        baseUrl: data.baseUrl,
        credits: String(data.credits),
        apiKey: "",
      });
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
      className="surface-panel p-5"
      aria-labelledby={`${variant}-section-title`}
      aria-busy={busy}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`${variant}-section-title`} className="eyebrow">
          {name}
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
              <Input value={modelId} readOnly disabled={busy} />
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
          <AdminField label="每轮积分">
            <Input
              type="number"
              min={0}
              max={1_000_000}
              step={0.1}
              required
              disabled={busy}
              value={form.credits}
              onChange={(event) =>
                setForm({ ...form, credits: event.target.value })
              }
            />
          </AdminField>
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
