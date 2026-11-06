import { getSystemConfigValue } from "@/lib/system-config";
import { getModel, listModels } from "@/lib/models/registry";
import type { ModelDefinition } from "@/lib/models/types";
import { isImage2ModelId } from "@/lib/provider-channels";

function positiveInteger(
  value: unknown,
  fallback: number,
  max: number,
): number {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= max
    ? value
    : fallback;
}

// 运行时合并后台可调项。出图主参数已改为显式 size（能力来自 registry），
// 这里仅沿用「单次最多张数」上限（管理员只能下调，不能超过模型上限）。
export async function applyRuntimeModelConfig(
  model: ModelDefinition,
): Promise<ModelDefinition> {
  if (!isImage2ModelId(model.id)) {
    return model;
  }

  const maxN = await getSystemConfigValue("generation.image2MaxN");

  return {
    ...model,
    capabilities: {
      ...model.capabilities,
      maxN: positiveInteger(
        maxN,
        model.capabilities.maxN,
        model.capabilities.maxN,
      ),
    },
  };
}

export async function getConfiguredModel(
  id: string,
): Promise<ModelDefinition | null> {
  const model = getModel(id);

  return model ? applyRuntimeModelConfig(model) : null;
}

export async function listConfiguredModels(): Promise<ModelDefinition[]> {
  return Promise.all(
    listModels().map((model) => applyRuntimeModelConfig(model)),
  );
}
