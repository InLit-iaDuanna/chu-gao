"use client";

import { Button, Input, Textarea } from "@/components/ui";

import { useCallback, useEffect, useState } from "react";
import { Loader2, PlugZap } from "lucide-react";

import { LunaSection } from "./LunaSection";
import { ChatRuntimeSection } from "./ChatRuntimeSection";
import {
  getAdminIntegrations,
  isAdminApiError,
  patchAdminIntegrations,
  testAdminDeepseek,
} from "./lib/api";
import type { AdminIntegrations } from "./lib/types";
import { AdminField, AdminPageHeader, EmptyPanel, ErrorText } from "./ui";

export function IntegrationsView() {
  const [data, setData] = useState<AdminIntegrations | null>(null);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(() => {
    getAdminIntegrations()
      .then(setData)
      .catch(() => setFailed(true));
  }, []);

  useEffect(reload, [reload]);

  async function run(action: () => Promise<unknown>, okMessage: string) {
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(okMessage);
      reload();
    } catch (actionError) {
      setError(isAdminApiError(actionError) ? actionError.message : "操作失败");
    }
  }

  return (
    <div>
      <AdminPageHeader
        eyebrow="Integrations"
        title="AI 集成"
        description="提示词优化、对话模型与 PPT 指令"
      />

      <ErrorText message={error} />
      {notice ? <p className="mb-3 text-sm text-success">{notice}</p> : null}

      <div className="grid gap-4">
        <ChatRuntimeSection />
        <LunaSection variant="sol" />
        <LunaSection />
        {failed ? (
          <EmptyPanel text="集成配置暂时不可用" />
        ) : !data ? (
          <div className="surface-panel h-64 animate-pulse" />
        ) : (
          <>
            <DeepSeekSection
              data={data.deepseek}
              onSave={(patch) =>
                run(() => patchAdminIntegrations({ deepseek: patch }), "已保存")
              }
              onTest={() =>
                run(async () => {
                  const result = await testAdminDeepseek();
                  setNotice(`连接成功（模型 ${result.model}）`);
                }, "")
              }
            />
            <ConversationSection
              status={data.conversation}
              systemPrompt={data.conversationSystemPrompt}
              compileSystemPrompt={data.conversationCompileSystemPrompt}
              onSave={(patch) =>
                run(
                  () => patchAdminIntegrations({ conversation: patch }),
                  "已保存",
                )
              }
            />
            <PptSection
              prompt={data.pptSystemPrompt}
              onSave={(pptSystemPrompt) =>
                run(() => patchAdminIntegrations({ pptSystemPrompt }), "已保存")
              }
            />
          </>
        )}
      </div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-text-muted">
      <Input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}

function DeepSeekSection({
  data,
  onSave,
  onTest,
}: {
  data: AdminIntegrations["deepseek"];
  onSave: (patch: {
    enabled?: boolean;
    baseUrl?: string;
    model?: string;
    systemPrompt?: string;
    apiKey?: string;
  }) => Promise<void>;
  onTest: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    enabled: data.enabled,
    baseUrl: data.baseUrl,
    model: data.model,
    systemPrompt: data.systemPrompt,
    apiKey: "",
  });
  const [busy, setBusy] = useState<string | null>(null);

  return (
    <section className="surface-panel p-5">
      <div className="flex items-center justify-between">
        <p className="eyebrow">DeepSeek 提示词优化</p>
        <span className="text-[11px] text-text-faint">
          {data.hasKey ? "已配置密钥" : "未配置密钥"}
        </span>
      </div>
      <div className="mt-4 grid gap-3">
        <Toggle
          checked={form.enabled}
          onChange={(enabled) => setForm({ ...form, enabled })}
          label="启用"
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <AdminField label="Base URL">
            <Input
              value={form.baseUrl}
              onChange={(event) =>
                setForm({ ...form, baseUrl: event.target.value })
              }
            />
          </AdminField>
          <AdminField label="模型">
            <Input
              value={form.model}
              onChange={(event) =>
                setForm({ ...form, model: event.target.value })
              }
            />
          </AdminField>
        </div>
        <AdminField label="API Key（留空不变，输入空字符串清除）">
          <Input
            value={form.apiKey}
            onChange={(event) =>
              setForm({ ...form, apiKey: event.target.value })
            }
          />
        </AdminField>
        <AdminField label="系统提示词">
          <Textarea
            className="surface-panel-soft min-h-20 w-full resize-y px-3 py-2 text-sm leading-6 outline-none"
            value={form.systemPrompt}
            onChange={(event) =>
              setForm({ ...form, systemPrompt: event.target.value })
            }
          />
        </AdminField>
        <div className="flex gap-2">
          <Button
            type="button"
            className="h-9 px-4 text-text-muted disabled:opacity-45"
            disabled={busy !== null}
            onClick={() => {
              setBusy("save");
              void onSave({
                enabled: form.enabled,
                baseUrl: form.baseUrl.trim() || undefined,
                model: form.model.trim() || undefined,
                systemPrompt: form.systemPrompt,
                ...(form.apiKey !== "" ? { apiKey: form.apiKey } : {}),
              }).finally(() => setBusy(null));
            }}
          >
            {busy === "save" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : null}
            保存
          </Button>
          <Button
            type="button"
            className="h-9 px-4 text-text-muted disabled:opacity-45"
            disabled={busy !== null || !data.hasKey}
            onClick={() => {
              setBusy("test");
              void onTest().finally(() => setBusy(null));
            }}
          >
            {busy === "test" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <PlugZap className="h-4 w-4 stroke-[1.5]" />
            )}
            连通性测试
          </Button>
        </div>
      </div>
    </section>
  );
}

function ConversationSection({
  status,
  systemPrompt,
  compileSystemPrompt,
  onSave,
}: {
  status: AdminIntegrations["conversation"];
  systemPrompt: string;
  compileSystemPrompt: string;
  onSave: (patch: {
    enabled?: boolean;
    baseUrl?: string;
    model?: string;
    reasoning?: boolean;
    systemPrompt?: string;
    compileSystemPrompt?: string;
    apiKey?: string;
  }) => Promise<void>;
}) {
  const [form, setForm] = useState({
    enabled: status.enabled,
    baseUrl: status.baseUrl,
    model: status.model,
    reasoning: status.reasoning,
    systemPrompt,
    compileSystemPrompt,
    apiKey: "",
  });
  const [busy, setBusy] = useState(false);

  return (
    <section className="surface-panel p-5">
      <div className="flex items-center justify-between">
        <p className="eyebrow">对话模型</p>
        <span className="text-[11px] text-text-faint">
          {status.hasKey ? "已配置密钥" : "未配置密钥"}
        </span>
      </div>
      <div className="mt-4 grid gap-3">
        <div className="flex gap-6">
          <Toggle
            checked={form.enabled}
            onChange={(enabled) => setForm({ ...form, enabled })}
            label="启用"
          />
          <Toggle
            checked={form.reasoning}
            onChange={(reasoning) => setForm({ ...form, reasoning })}
            label="推理模式"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <AdminField label="Base URL">
            <Input
              value={form.baseUrl}
              onChange={(event) =>
                setForm({ ...form, baseUrl: event.target.value })
              }
            />
          </AdminField>
          <AdminField label="模型">
            <Input
              value={form.model}
              onChange={(event) =>
                setForm({ ...form, model: event.target.value })
              }
            />
          </AdminField>
        </div>
        <AdminField label="API Key（留空不变）">
          <Input
            value={form.apiKey}
            onChange={(event) =>
              setForm({ ...form, apiKey: event.target.value })
            }
          />
        </AdminField>
        <AdminField label="对话系统提示词">
          <Textarea
            className="surface-panel-soft min-h-20 w-full resize-y px-3 py-2 text-sm leading-6 outline-none"
            value={form.systemPrompt}
            onChange={(event) =>
              setForm({ ...form, systemPrompt: event.target.value })
            }
          />
        </AdminField>
        <AdminField label="出图编译指令（compile）">
          <Textarea
            className="surface-panel-soft min-h-20 w-full resize-y px-3 py-2 text-sm leading-6 outline-none"
            value={form.compileSystemPrompt}
            onChange={(event) =>
              setForm({ ...form, compileSystemPrompt: event.target.value })
            }
          />
        </AdminField>
        <div>
          <Button
            type="button"
            className="h-9 px-4 text-text-muted disabled:opacity-45"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void onSave({
                enabled: form.enabled,
                reasoning: form.reasoning,
                baseUrl: form.baseUrl.trim() || undefined,
                model: form.model.trim() || undefined,
                systemPrompt: form.systemPrompt,
                compileSystemPrompt: form.compileSystemPrompt,
                ...(form.apiKey !== "" ? { apiKey: form.apiKey } : {}),
              }).finally(() => setBusy(false));
            }}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            保存
          </Button>
        </div>
      </div>
    </section>
  );
}

function PptSection({
  prompt,
  onSave,
}: {
  prompt: string;
  onSave: (pptSystemPrompt: string) => Promise<void>;
}) {
  const [value, setValue] = useState(prompt);
  const [busy, setBusy] = useState(false);

  return (
    <section className="surface-panel p-5">
      <p className="eyebrow">PPT 系统提示词</p>
      <div className="mt-4 grid gap-3">
        <Textarea
          className="surface-panel-soft min-h-28 w-full resize-y px-3 py-2 text-sm leading-6 outline-none"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <div>
          <Button
            type="button"
            className="h-9 px-4 text-text-muted disabled:opacity-45"
            disabled={busy || !value.trim()}
            onClick={() => {
              setBusy(true);
              void onSave(value.trim()).finally(() => setBusy(false));
            }}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            保存
          </Button>
        </div>
      </div>
    </section>
  );
}
