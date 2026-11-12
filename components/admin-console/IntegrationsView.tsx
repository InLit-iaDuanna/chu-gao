"use client";

import { Button, Textarea } from "@/components/ui";
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { ChatRuntimeSection } from "./ChatRuntimeSection";
import { LunaSection } from "./LunaSection";
import { OpusSection } from "./OpusSection";
import {
  getAdminIntegrations,
  isAdminApiError,
  patchAdminIntegrations,
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
        <LunaSection variant="sol" />
        <LunaSection />
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
