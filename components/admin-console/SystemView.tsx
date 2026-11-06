"use client";

import { Button, Input, Select, Textarea } from "@/components/ui";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import {
  getAdminSystemConfig,
  isAdminApiError,
  patchAdminSystemConfig,
} from "./lib/api";
import type { SystemConfigEntry } from "./lib/types";
import { AdminPageHeader, EmptyPanel, ErrorText } from "./ui";

const KEY_LABEL: Record<string, string> = {
  "registration.inviteOnly": "仅邀请注册",
  "registration.defaultCredits": "注册默认点数",
  "generation.globalConcurrency": "全局并发出图数",
  "generation.defaultDailyLimit": "新用户默认日限",
  "generation.image2AspectRatios": "图生图可用比例",
  "generation.image2Resolutions": "图生图可用分辨率",
  "generation.image2ResolutionAspectRatios": "分辨率-比例映射",
  "generation.image2MaxN": "图生图最大张数",
  "moderation.enabled": "启用内容审核",
  "moderation.blockedKeywords": "拦截关键词",
};

const BOOLEAN_KEYS = new Set(["registration.inviteOnly", "moderation.enabled"]);

const NUMBER_KEYS = new Set([
  "registration.defaultCredits",
  "generation.globalConcurrency",
  "generation.defaultDailyLimit",
  "generation.image2MaxN",
]);

const STRING_KEYS = new Set<string>();

const ENUM_KEYS: Record<string, string[]> = {};

const LIST_KEYS = new Set([
  "generation.image2AspectRatios",
  "generation.image2Resolutions",
  "moderation.blockedKeywords",
]);

export function SystemView() {
  const [entries, setEntries] = useState<SystemConfigEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(() => {
    getAdminSystemConfig()
      .then(setEntries)
      .catch(() => setFailed(true));
  }, []);

  useEffect(reload, [reload]);

  async function save(key: string, value: unknown) {
    setError(null);
    setNotice(null);
    try {
      await patchAdminSystemConfig(key, value);
      setNotice(`「${KEY_LABEL[key] ?? key}」已保存`);
      reload();
    } catch (saveError) {
      setError(isAdminApiError(saveError) ? saveError.message : "保存失败");
    }
  }

  if (failed) return <EmptyPanel text="系统配置暂时不可用" />;
  if (!entries) return <div className="surface-panel h-64 animate-pulse" />;

  return (
    <div>
      <AdminPageHeader
        eyebrow="System"
        title="系统配置"
        description="改动即时生效，记录进审计日志"
      />

      <ErrorText message={error} />
      {notice ? <p className="mb-3 text-sm text-success">{notice}</p> : null}

      <div className="grid gap-3">
        {entries.map((entry) => (
          <ConfigRow key={entry.key} entry={entry} onSave={save} />
        ))}
      </div>
    </div>
  );
}

function ConfigRow({
  entry,
  onSave,
}: {
  entry: SystemConfigEntry;
  onSave: (key: string, value: unknown) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState(() => textFor(entry));
  const [boolValue, setBoolValue] = useState(Boolean(entry.value));
  const [enumValue, setEnumValue] = useState(String(entry.value));

  const label = KEY_LABEL[entry.key] ?? entry.key;

  const submit = (value: unknown) => {
    setBusy(true);
    void onSave(entry.key, value).finally(() => setBusy(false));
  };

  let editor: React.ReactNode;

  if (BOOLEAN_KEYS.has(entry.key)) {
    editor = (
      <label className="flex items-center gap-2 text-sm text-text-muted">
        <Input
          type="checkbox"
          checked={boolValue}
          onChange={(event) => {
            setBoolValue(event.target.checked);
            submit(event.target.checked);
          }}
        />
        {boolValue ? "开启" : "关闭"}
      </label>
    );
  } else if (NUMBER_KEYS.has(entry.key)) {
    editor = (
      <div className="flex items-center gap-2">
        <Input
          type="number"
          className="w-32"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <SaveButton busy={busy} onClick={() => submit(Number(text))} />
      </div>
    );
  } else if (STRING_KEYS.has(entry.key)) {
    editor = (
      <div className="flex items-center gap-2">
        <Input
          className="flex-1"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <SaveButton busy={busy} onClick={() => submit(text.trim())} />
      </div>
    );
  } else if (ENUM_KEYS[entry.key]) {
    editor = (
      <div className="flex items-center gap-2">
        <Select
          aria-label={KEY_LABEL[entry.key] ?? entry.key}
          className="w-40"
          value={enumValue}
          onValueChange={(value) => {
            setEnumValue(value);
            submit(value);
          }}
          options={ENUM_KEYS[entry.key].map((option) => ({
            value: option,
            label: option,
          }))}
        />
      </div>
    );
  } else if (LIST_KEYS.has(entry.key)) {
    editor = (
      <div className="flex items-center gap-2">
        <Input
          className="flex-1"
          placeholder="逗号分隔"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <SaveButton
          busy={busy}
          onClick={() =>
            submit(
              text
                .split(/[,，]/)
                .map((item) => item.trim())
                .filter(Boolean),
            )
          }
        />
      </div>
    );
  } else {
    // 复杂对象（如分辨率-比例映射）用 JSON 编辑
    editor = (
      <div className="space-y-2">
        <Textarea
          className="surface-panel-soft min-h-20 w-full resize-y px-3 py-2 font-mono text-xs leading-5 outline-none"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <SaveButton
          busy={busy}
          onClick={() => {
            try {
              submit(JSON.parse(text));
            } catch {
              // JSON 不合法时不提交
            }
          }}
        />
      </div>
    );
  }

  return (
    <div className="surface-panel flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-40">
        <p className="text-sm">{label}</p>
        <p className="font-mono text-[10px] text-text-faint">{entry.key}</p>
      </div>
      <div className="min-w-0 flex-1 sm:max-w-md">{editor}</div>
    </div>
  );
}

function textFor(entry: SystemConfigEntry): string {
  if (Array.isArray(entry.value)) return entry.value.join(", ");
  if (typeof entry.value === "object" && entry.value !== null) {
    return JSON.stringify(entry.value, null, 2);
  }
  return String(entry.value ?? "");
}

function SaveButton({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <Button
      type="button"
      className="h-9 shrink-0 px-4 text-text-muted disabled:opacity-45"
      disabled={busy}
      onClick={onClick}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      保存
    </Button>
  );
}
