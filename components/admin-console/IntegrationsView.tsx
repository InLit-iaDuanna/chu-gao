"use client";

import { Button, Textarea } from "@/components/ui";
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { ChatRuntimeSection } from "./ChatRuntimeSection";
import { GptSection } from "./GptSection";
import { OpusSection } from "./OpusSection";
import { TokenProviderSection } from "./TokenProviderSection";
import {
  getAdminIntegrations,
  getAdminGemini,
  getAdminPremiumAnthropic,
  isAdminApiError,
  patchAdminIntegrations,
  patchAdminGemini,
  patchAdminPremiumAnthropic,
} from "./lib/api";
import type { AdminIntegrations } from "./lib/types";
import { AdminPageHeader, EmptyPanel, ErrorText } from "./ui";

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
        description="Opus 5.5、对话运行时与 PPT 指令"
      />

      <ErrorText message={error} />
      {notice ? <p className="mb-3 text-sm text-success">{notice}</p> : null}

      <div className="grid gap-4">
        <ChatRuntimeSection />
        <OpusSection />
        <TokenProviderSection
          id="premium-anthropic"
          title="Opus 5.5 高价 / Fable 5.2"
          description="高价 Anthropic 通道；Fable 5.2 按 Opus 基准价格的 2 倍计费。"
          modelLabels={["claude-opus-5-5", "claude-fable-5-2"]}
          load={getAdminPremiumAnthropic}
          save={patchAdminPremiumAnthropic}
          loadingLabel="正在加载高价 Claude 配置"
          savedLabel="高价 Claude 配置已保存"
        />
        <TokenProviderSection
          id="gemini"
          title="Gemini 4"
          description="Argon、Carbon 共用此通道；Hydrogen 按 Argon 的 50% 计费；默认价格为高价 Opus 的 7 折。"
          modelLabels={[
            "gemini-4-argon",
            "gemini-4-carbon",
            "gemini-4-hydrogen",
          ]}
          load={getAdminGemini}
          save={patchAdminGemini}
          loadingLabel="正在加载 Gemini 4 配置"
          savedLabel="Gemini 4 配置已保存"
        />
        <GptSection variant="sol" />
        <GptSection variant="astra" />
        {failed ? (
          <EmptyPanel text="集成配置暂时不可用" />
        ) : !data ? (
          <div className="surface-panel h-64 animate-pulse" />
        ) : (
          <PptSection
            prompt={data.pptSystemPrompt}
            onSave={(pptSystemPrompt) =>
              run(() => patchAdminIntegrations({ pptSystemPrompt }), "已保存")
            }
          />
        )}
      </div>
    </div>
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
