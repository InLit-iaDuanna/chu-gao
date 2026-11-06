"use client";

import { useState } from "react";

import { IMAGE_SIZE_LABEL } from "@/lib/models/options";
import type { ImageSize, PublicModelDefinition } from "@/lib/models/types";
import {
  readWorkbenchPreferences,
  writeWorkbenchPreferences,
} from "@/lib/workbench-preferences";

type PreferenceFormState = {
  modelId: string;
  size: ImageSize;
};

function initialFormState(
  models: PublicModelDefinition[],
): PreferenceFormState {
  const firstModel = models[0] ?? null;
  const saved = readWorkbenchPreferences();
  const selectedModel = saved.modelId
    ? (models.find((item) => item.id === saved.modelId) ?? firstModel)
    : firstModel;

  if (!selectedModel) {
    return {
      modelId: "",
      size: "auto",
    };
  }

  return {
    modelId: selectedModel.id,
    size:
      saved.size &&
      selectedModel.capabilities.sizes.includes(saved.size as ImageSize)
        ? (saved.size as ImageSize)
        : selectedModel.defaults.size,
  };
}

export function WorkbenchPreferencesForm({
  models,
}: {
  models: PublicModelDefinition[];
}) {
  const [form, setForm] = useState<PreferenceFormState>(() =>
    initialFormState(models),
  );
  const [status, setStatus] = useState<"idle" | "saved">("idle");

  function savePreferences() {
    writeWorkbenchPreferences({
      modelId: form.modelId,
      size: form.size,
    });
    setStatus("saved");
    window.setTimeout(() => setStatus("idle"), 1200);
  }

  const selectedModel =
    models.find((item) => item.id === form.modelId) ?? models[0] ?? null;

  return (
    <div className="surface-panel p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow">偏好</p>
          <h2 className="mt-2 text-2xl">工作台默认项</h2>
          <p className="mt-3 text-sm leading-6 text-text-muted">
            这里保存到当前浏览器。工作台下次打开时会自动读取这些默认值。
          </p>
        </div>
        <button
          type="button"
          className="tool-button h-9 text-text-muted"
          onClick={savePreferences}
        >
          {status === "saved" ? "已保存" : "保存"}
        </button>
      </div>

      <div className="mt-6 grid gap-4">
        <label className="block space-y-2">
          <span className="field-label">默认模型</span>
          <select
            className="surface-panel-soft h-11 w-full px-3 outline-none"
            value={form.modelId}
            onChange={(event) => {
              const nextId = event.target.value;
              const nextModel = models.find((item) => item.id === nextId);

              if (!nextModel) {
                return;
              }

              setForm({
                modelId: nextId,
                size: nextModel.defaults.size,
              });
            }}
          >
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.displayName}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-2">
          <span className="field-label">默认尺寸</span>
          <select
            className="surface-panel-soft h-11 w-full px-3 outline-none"
            value={form.size}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                size: event.target.value as ImageSize,
              }))
            }
          >
            {selectedModel?.capabilities.sizes.map((size) => (
              <option key={size} value={size}>
                {IMAGE_SIZE_LABEL[size]}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
