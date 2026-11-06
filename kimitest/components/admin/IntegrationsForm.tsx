"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Sparkles, FileText, Loader2, MessagesSquare } from "lucide-react";

import { Button, FormField, Input, Switch, Textarea } from "@/components/ui";

interface DeepSeekStatus {
  enabled: boolean;
  baseUrl: string;
  model: string;
  systemPrompt: string;
  hasKey: boolean;
}

interface ConversationStatus {
  enabled: boolean;
  baseUrl: string;
  model: string;
  reasoning: boolean;
  hasKey: boolean;
}

interface IntegrationsFormProps {
  initial: {
    deepseek: DeepSeekStatus;
    pptSystemPrompt: string;
    conversation: ConversationStatus;
    conversationSystemPrompt: string;
    conversationCompileSystemPrompt: string;
  };
}

type DeepSeekPatch = {
  enabled?: boolean;
  baseUrl?: string;
  model?: string;
  systemPrompt?: string;
  apiKey?: string;
};

type ConversationPatch = {
  enabled?: boolean;
  baseUrl?: string;
  model?: string;
  systemPrompt?: string;
  compileSystemPrompt?: string;
  reasoning?: boolean;
  apiKey?: string;
};

async function patchIntegrations(body: {
  deepseek?: DeepSeekPatch;
  conversation?: ConversationPatch;
  pptSystemPrompt?: string;
}) {
  const response = await fetch("/api/admin/integrations", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;

  if (!response.ok) {
    throw new Error(payload?.error?.message ?? "保存失败");
  }
}

export function IntegrationsForm({ initial }: IntegrationsFormProps) {
  const router = useRouter();

  const [enabled, setEnabled] = useState(initial.deepseek.enabled);
  const [baseUrl, setBaseUrl] = useState(initial.deepseek.baseUrl);
  const [model, setModel] = useState(initial.deepseek.model);
  const [dsSystemPrompt, setDsSystemPrompt] = useState(
    initial.deepseek.systemPrompt,
  );
  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState(initial.deepseek.hasKey);

  const [systemPrompt, setSystemPrompt] = useState(initial.pptSystemPrompt);

  // 对话模型
  const [convEnabled, setConvEnabled] = useState(initial.conversation.enabled);
  const [convBaseUrl, setConvBaseUrl] = useState(initial.conversation.baseUrl);
  const [convModel, setConvModel] = useState(initial.conversation.model);
  const [convReasoning, setConvReasoning] = useState(
    initial.conversation.reasoning,
  );
  const [convSystemPrompt, setConvSystemPrompt] = useState(
    initial.conversationSystemPrompt,
  );
  const [convCompilePrompt, setConvCompilePrompt] = useState(
    initial.conversationCompileSystemPrompt,
  );
  const [convApiKey, setConvApiKey] = useState("");
  const [convHasKey, setConvHasKey] = useState(initial.conversation.hasKey);

  const [savingDeepSeek, setSavingDeepSeek] = useState(false);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [savingConversation, setSavingConversation] = useState(false);
  const [testing, setTesting] = useState(false);
  const [deepSeekMessage, setDeepSeekMessage] = useState<string | null>(null);
  const [promptMessage, setPromptMessage] = useState<string | null>(null);
  const [conversationMessage, setConversationMessage] = useState<string | null>(
    null,
  );

  async function saveDeepSeek(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingDeepSeek(true);
    setDeepSeekMessage("保存中...");

    try {
      const patch: DeepSeekPatch = {
        enabled,
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        systemPrompt: dsSystemPrompt,
      };
      // 仅在用户输入了新 key 时提交（避免清空已存密钥）。
      if (apiKey.trim()) {
        patch.apiKey = apiKey.trim();
      }

      await patchIntegrations({ deepseek: patch });

      if (apiKey.trim()) {
        setHasKey(true);
        setApiKey("");
      }
      setDeepSeekMessage("DeepSeek 配置已保存");
      router.refresh();
    } catch (error) {
      setDeepSeekMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSavingDeepSeek(false);
    }
  }

  async function clearKey() {
    if (!window.confirm("确定清除已保存的 DeepSeek API Key 吗？")) return;

    setSavingDeepSeek(true);
    setDeepSeekMessage("清除中...");

    try {
      await patchIntegrations({ deepseek: { apiKey: "" } });
      setHasKey(false);
      setApiKey("");
      setDeepSeekMessage("已清除 API Key");
      router.refresh();
    } catch (error) {
      setDeepSeekMessage(error instanceof Error ? error.message : "清除失败");
    } finally {
      setSavingDeepSeek(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    setDeepSeekMessage("测试连接中...");

    try {
      const response = await fetch("/api/admin/integrations/test", {
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;

      setDeepSeekMessage(
        response.ok
          ? "连接成功 ✓"
          : (payload?.error?.message ?? "连接失败"),
      );
    } catch {
      setDeepSeekMessage("连接失败");
    } finally {
      setTesting(false);
    }
  }

  async function savePrompt(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingPrompt(true);
    setPromptMessage("保存中...");

    try {
      await patchIntegrations({ pptSystemPrompt: systemPrompt });
      setPromptMessage("PPT 系统提示词已保存");
      router.refresh();
    } catch (error) {
      setPromptMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSavingPrompt(false);
    }
  }

  async function saveConversation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingConversation(true);
    setConversationMessage("保存中...");

    try {
      const patch: ConversationPatch = {
        enabled: convEnabled,
        baseUrl: convBaseUrl.trim(),
        model: convModel.trim(),
        systemPrompt: convSystemPrompt,
        compileSystemPrompt: convCompilePrompt,
        reasoning: convReasoning,
      };
      // 仅在用户输入了新 key 时提交（避免清空已存密钥）。
      if (convApiKey.trim()) {
        patch.apiKey = convApiKey.trim();
      }

      await patchIntegrations({ conversation: patch });

      if (convApiKey.trim()) {
        setConvHasKey(true);
        setConvApiKey("");
      }
      setConversationMessage("对话模型配置已保存");
      router.refresh();
    } catch (error) {
      setConversationMessage(
        error instanceof Error ? error.message : "保存失败",
      );
    } finally {
      setSavingConversation(false);
    }
  }

  async function clearConversationKey() {
    if (!window.confirm("确定清除已保存的对话模型 API Key 吗？")) return;

    setSavingConversation(true);
    setConversationMessage("清除中...");

    try {
      await patchIntegrations({ conversation: { apiKey: "" } });
      setConvHasKey(false);
      setConvApiKey("");
      setConversationMessage("已清除 API Key");
      router.refresh();
    } catch (error) {
      setConversationMessage(
        error instanceof Error ? error.message : "清除失败",
      );
    } finally {
      setSavingConversation(false);
    }
  }

  return (
    <div className="grid gap-4">
      {/* DeepSeek 接入 */}
      <form onSubmit={saveDeepSeek} className="surface-panel-soft p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-[8px] border border-border bg-surface-2 text-foreground">
              <Sparkles className="h-4 w-4 stroke-[1.5]" />
            </span>
            <div>
              <p className="text-base font-semibold">DeepSeek 接入</p>
              <p className="mt-1 text-xs leading-5 text-text-muted">
                用于把「不变提示词 + 该页提示词」优化成出图 prompt。关闭或未配置时自动回退为直接拼接。
              </p>
            </div>
          </div>
          <label className="inline-flex items-center gap-2 text-sm text-text-muted">
            <Switch checked={enabled} onChange={setEnabled} aria-label="启用 DeepSeek" />
            启用
          </label>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <FormField label="Base URL" htmlFor="ds-base-url" className="sm:col-span-1">
            <Input
              id="ds-base-url"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://api.deepseek.com"
              autoComplete="off"
            />
          </FormField>
          <FormField label="模型" htmlFor="ds-model" className="sm:col-span-1">
            <Input
              id="ds-model"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder="deepseek-chat"
              autoComplete="off"
            />
          </FormField>
          <FormField
            label="API Key"
            htmlFor="ds-api-key"
            description={
              hasKey
                ? "已配置（出于安全不回显）。留空表示不修改；填写新值将覆盖。"
                : "尚未配置。"
            }
            className="sm:col-span-2"
          >
            <Input
              id="ds-api-key"
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={hasKey ? "••••••••（已配置）" : "sk-..."}
              autoComplete="off"
            />
          </FormField>
          <FormField
            label="优化系统提示词"
            htmlFor="ds-system-prompt"
            description="DeepSeek 优化提示词时使用的系统指令（如何把内容优化成出图 prompt）。PPT 会在此之上叠加 PPT 专属约束。"
            className="sm:col-span-2"
          >
            <Textarea
              id="ds-system-prompt"
              value={dsSystemPrompt}
              onChange={(event) => setDsSystemPrompt(event.target.value)}
              rows={6}
              maxLength={4000}
              className="min-h-32 font-mono text-xs leading-6"
            />
          </FormField>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" loading={savingDeepSeek}>
            保存 DeepSeek 配置
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={testConnection}
            disabled={testing || !hasKey}
            leftIcon={testing ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}
          >
            测试连接
          </Button>
          {hasKey ? (
            <Button type="button" variant="ghost" onClick={clearKey} disabled={savingDeepSeek}>
              清除 Key
            </Button>
          ) : null}
          {deepSeekMessage ? (
            <span className="text-sm text-text-muted">{deepSeekMessage}</span>
          ) : null}
        </div>
      </form>

      {/* 对话模型 */}
      <form onSubmit={saveConversation} className="surface-panel-soft p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-[8px] border border-border bg-surface-2 text-foreground">
              <MessagesSquare className="h-4 w-4 stroke-[1.5]" />
            </span>
            <div>
              <p className="text-base font-semibold">对话模型</p>
              <p className="mt-1 text-xs leading-5 text-text-muted">
                独立于提示词优化与出图渠道，用于多轮流式对话；可协助用户打磨出图提示词，并在确认后进入生成。
              </p>
            </div>
          </div>
          <label className="inline-flex items-center gap-2 text-sm text-text-muted">
            <Switch
              checked={convEnabled}
              onChange={setConvEnabled}
              aria-label="启用对话模型"
            />
            启用
          </label>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <FormField label="Base URL" htmlFor="conv-base-url" className="sm:col-span-1">
            <Input
              id="conv-base-url"
              value={convBaseUrl}
              onChange={(event) => setConvBaseUrl(event.target.value)}
              placeholder="https://api.deepseek.com"
              autoComplete="off"
            />
          </FormField>
          <FormField label="模型" htmlFor="conv-model" className="sm:col-span-1">
            <Input
              id="conv-model"
              value={convModel}
              onChange={(event) => setConvModel(event.target.value)}
              placeholder="deepseek-chat"
              autoComplete="off"
            />
          </FormField>
          <FormField
            label="API Key"
            htmlFor="conv-api-key"
            description={
              convHasKey
                ? "已配置（出于安全不回显）。留空表示不修改；填写新值将覆盖。"
                : "尚未配置。"
            }
            className="sm:col-span-2"
          >
            <Input
              id="conv-api-key"
              type="password"
              value={convApiKey}
              onChange={(event) => setConvApiKey(event.target.value)}
              placeholder={convHasKey ? "••••••••（已配置）" : "sk-..."}
              autoComplete="off"
            />
          </FormField>
          <FormField
            label="对话系统提示词"
            htmlFor="conv-system-prompt"
            description="对话模型的系统指令：多轮助手，可协助用户打磨出图提示词，并在确认后进入生成。"
            className="sm:col-span-2"
          >
            <Textarea
              id="conv-system-prompt"
              value={convSystemPrompt}
              onChange={(event) => setConvSystemPrompt(event.target.value)}
              rows={6}
              maxLength={4000}
              className="min-h-32 font-mono text-xs leading-6"
            />
          </FormField>
          <FormField
            label="出图提示词编译指令"
            htmlFor="conv-compile-prompt"
            description="点「预览出图提示词」时，对话模型据此把整段对话整理成最终出图 prompt（要求输出 JSON）。未配置对话模型时回退为本地拼接。"
            className="sm:col-span-2"
          >
            <Textarea
              id="conv-compile-prompt"
              value={convCompilePrompt}
              onChange={(event) => setConvCompilePrompt(event.target.value)}
              rows={6}
              maxLength={4000}
              className="min-h-32 font-mono text-xs leading-6"
            />
          </FormField>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 text-sm text-text-muted">
            <Switch
              checked={convReasoning}
              onChange={setConvReasoning}
              aria-label="启用思考模式"
            />
            思考模式
          </label>
          <Button type="submit" variant="primary" loading={savingConversation}>
            保存对话模型配置
          </Button>
          {convHasKey ? (
            <Button
              type="button"
              variant="ghost"
              onClick={clearConversationKey}
              disabled={savingConversation}
            >
              清除 Key
            </Button>
          ) : null}
          <span className="text-xs text-text-faint">
            {convSystemPrompt.length} / 4000
          </span>
          {conversationMessage ? (
            <span className="text-sm text-text-muted">{conversationMessage}</span>
          ) : null}
        </div>
      </form>

      {/* PPT 系统提示词 */}
      <form onSubmit={savePrompt} className="surface-panel-soft p-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-[8px] border border-border bg-surface-2 text-foreground">
            <FileText className="h-4 w-4 stroke-[1.5]" />
          </span>
          <div>
            <p className="text-base font-semibold">PPT 系统提示词</p>
            <p className="mt-1 text-xs leading-5 text-text-muted">
              作为 DeepSeek 的系统指令，统一指导每页幻灯片出图 prompt 的生成风格与规则。
            </p>
          </div>
        </div>

        <FormField label="系统提示词" htmlFor="ppt-system-prompt" className="mt-5">
          <Textarea
            id="ppt-system-prompt"
            value={systemPrompt}
            onChange={(event) => setSystemPrompt(event.target.value)}
            rows={8}
            maxLength={4000}
            className="min-h-44 font-mono text-xs leading-6"
          />
        </FormField>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" loading={savingPrompt}>
            保存系统提示词
          </Button>
          <span className="text-xs text-text-faint">{systemPrompt.length} / 4000</span>
          {promptMessage ? (
            <span className="text-sm text-text-muted">{promptMessage}</span>
          ) : null}
        </div>
      </form>
    </div>
  );
}
