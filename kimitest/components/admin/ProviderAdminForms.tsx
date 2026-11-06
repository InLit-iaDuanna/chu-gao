"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PROVIDER_PROTOCOL_LABELS } from "@/lib/admin-labels";

import { deleteJson, postJson } from "@/components/admin/admin-form-utils";

export function ProviderCreateForm({
  models,
}: {
  models: Array<{ id: string; protocol: string }>;
}) {
  const router = useRouter();
  const [name, setName] = useState("nano-banana");
  const [protocol, setProtocol] = useState("OPENAI_IMAGES");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [priority, setPriority] = useState(100);
  const [costMultiplier, setCostMultiplier] = useState(1);
  const [modelsText, setModelsText] = useState(
    "gpt-image-2-standard, gpt-image-2-high",
  );
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const normalizedModels = modelsText
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const canSubmit =
    name.trim().length > 0 &&
    protocol.trim().length > 0 &&
    baseUrl.trim().length > 0 &&
    apiKey.trim().length > 0 &&
    normalizedModels.length > 0 &&
    !isSubmitting;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    setIsSubmitting(true);
    setMessage("创建中...");

    try {
      await postJson("/api/admin/providers", {
        name: name.trim(),
        protocol,
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        priority,
        costMultiplier,
        modelsSupported:
          protocol === "OPENAI_IMAGES" &&
          normalizedModels.every(
            (modelId) =>
              modelId === "gpt-image-2-standard" ||
              modelId === "gpt-image-2-high" ||
              modelId === "gpt-image-2",
          )
            ? ["gpt-image-2-standard", "gpt-image-2-high"]
            : normalizedModels,
      });
      setMessage("渠道已创建，可继续添加下一个");
      setApiKey("");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "创建失败");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="surface-panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow">新增</p>
          <p className="admin-section-title mt-1">新增渠道池</p>
          <p className="mt-1 text-xs leading-5 text-text-muted">
            每个渠道会自动创建一个默认账号，后续可继续批量导入更多 API。
          </p>
        </div>
        <button
          className="tool-button h-10"
          type="submit"
          disabled={!canSubmit}
        >
          添加渠道
        </button>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          placeholder="渠道名称"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <select
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          value={protocol}
          onChange={(event) => {
            const nextProtocol = event.target.value;
            setProtocol(nextProtocol);
            const nextModels = models
              .filter((model) => {
                if (nextProtocol === "OPENAI_IMAGES") {
                  return model.protocol === "openai-images";
                }

                if (nextProtocol === "GEMINI_IMAGE") {
                  return model.protocol === "gemini-image";
                }

                return model.protocol === "openai-responses-image";
              })
              .map((model) => model.id);
            const normalizedNextModels =
              nextProtocol === "OPENAI_IMAGES"
                ? ["gpt-image-2-standard", "gpt-image-2-high"]
                : nextModels;
            setModelsText(normalizedNextModels.join(", "));
            if (nextProtocol === "GEMINI_IMAGE" && name === "image2") {
              setName("nano-banana");
            }
            if (nextProtocol === "OPENAI_IMAGES" && name === "nano-banana") {
              setName("image2");
            }
          }}
        >
          <option value="OPENAI_IMAGES">{PROVIDER_PROTOCOL_LABELS.OPENAI_IMAGES}</option>
          <option value="OPENAI_RESPONSES_IMAGE">{PROVIDER_PROTOCOL_LABELS.OPENAI_RESPONSES_IMAGE}</option>
          <option value="GEMINI_IMAGE">{PROVIDER_PROTOCOL_LABELS.GEMINI_IMAGE}</option>
        </select>
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          placeholder="模型 ID，多个用逗号分隔"
          required
          value={modelsText}
          onChange={(event) => setModelsText(event.target.value)}
          list="provider-models"
        />
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm lg:col-span-2"
          placeholder="Base URL"
          required
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
        />
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          placeholder="API Key"
          required
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
        />
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          type="number"
          min={0}
          value={priority}
          onChange={(event) => setPriority(Number(event.target.value))}
        />
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          type="number"
          min={0.01}
          step={0.01}
          value={costMultiplier}
          onChange={(event) => setCostMultiplier(Number(event.target.value))}
        />
      </div>
      <datalist id="provider-models">
        {models.map((model) => (
          <option key={model.id} value={model.id} />
        ))}
      </datalist>
      <p className="mt-3 text-xs leading-5 text-text-muted">
        Nano Banana 请选择「{PROVIDER_PROTOCOL_LABELS.GEMINI_IMAGE}」，并填写 nano-banana-2-512。不同 Base URL
        会在前台显示为不同大渠道。
      </p>
      {message ? (
        <p className="mt-3 text-sm text-text-muted">{message}</p>
      ) : null}
    </form>
  );
}

export function ProviderPoolActions({
  providerId,
  providerName,
  accountCount,
}: {
  providerId: string;
  providerName: string;
  accountCount: number;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function deletePool() {
    if (
      !window.confirm(
        `确认删除「${providerName}」号池？这会停用它下面的 ${accountCount} 个账号，历史任务会保留。`,
      )
    ) {
      return;
    }

    setIsSubmitting(true);
    setMessage("删除中...");

    try {
      const payload = (await deleteJson(
        `/api/admin/providers/${providerId}`,
        {},
      )) as {
        data?: { disabledAccounts?: number };
      };

      setMessage(
        `号池已删除，已停用 ${payload.data?.disabledAccounts ?? accountCount} 个账号`,
      );
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除失败");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <button
        className="tool-button h-9 text-danger"
        type="button"
        disabled={isSubmitting}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void deletePool();
        }}
      >
        删除号池
      </button>
      {message ? (
        <span className="text-xs text-text-muted">{message}</span>
      ) : null}
    </div>
  );
}
