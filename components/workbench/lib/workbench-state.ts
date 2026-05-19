import { firstSupportedResolutionAspectPair } from "@/lib/models/capabilities";
import type {
  AspectRatio,
  Image2Mode,
  PublicModelDefinition,
} from "@/lib/models/types";
import { normalizeSelectableProviderChannelId } from "@/lib/provider-channels";
import type { WorkbenchPreferences } from "@/lib/workbench-preferences";

import type {
  WorkbenchState,
  WorkbenchTaskStatus,
} from "@/components/workbench/types";

export const DEFAULT_MODEL_ID = "gpt-image-2";

function image2ModeFor(
  model: PublicModelDefinition,
  preferred?: string,
): Image2Mode | undefined {
  if (!model.capabilities.image2Modes?.length) {
    return undefined;
  }

  return model.capabilities.image2Modes.includes(preferred as Image2Mode)
    ? (preferred as Image2Mode)
    : (model.defaults.image2Mode ?? model.capabilities.image2Modes[0]);
}

export const WORKBENCH_STATUS_LABEL: Record<WorkbenchTaskStatus, string> = {
  idle: "可输入",
  pending: "排队中",
  running: "生成中",
  succeeded: "已完成",
  failed: "失败",
  canceled: "已取消",
};

export function statusFromGeneration(status: string): WorkbenchTaskStatus {
  if (status === "PENDING") return "pending";
  if (status === "RUNNING") return "running";
  if (status === "SUCCEEDED") return "succeeded";
  if (status === "FAILED") return "failed";
  if (status === "CANCELED") return "canceled";
  return "idle";
}

export function initialStateFor(
  model: PublicModelDefinition,
  preferences: WorkbenchPreferences = {},
): WorkbenchState {
  const pair = firstSupportedResolutionAspectPair(model, {
    aspectRatio: preferences.aspectRatio as AspectRatio | undefined,
    resolution: preferences.resolution as WorkbenchState["resolution"],
  });

  return {
    modelId: model.id,
    providerChannelId: normalizeSelectableProviderChannelId(
      model.id,
      preferences.providerChannelId,
      model.providerChannels,
    ),
    aspectRatio: pair.aspectRatio,
    resolution: pair.resolution,
    image2Mode: image2ModeFor(model, preferences.image2Mode),
    n: 1,
    outputFormat: model.defaults.outputFormat,
    background: model.defaults.background,
    outputCompression: model.defaults.outputCompression,
    referenceImageKeys: [],
  };
}
