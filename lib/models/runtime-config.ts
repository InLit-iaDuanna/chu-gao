import { getSystemConfigValue } from "@/lib/system-config";
import { getModel, listModels } from "@/lib/models/registry";
import {
  aspectRatiosForResolution,
  isResolutionAspectRatioSupported,
} from "@/lib/models/capabilities";
import {
  IMAGE_ASPECT_RATIO_OPTIONS,
  IMAGE_RESOLUTION_OPTIONS,
} from "@/lib/models/options";
import type {
  AspectRatio,
  ModelCapabilities,
  ModelDefinition,
  Resolution,
} from "@/lib/models/types";
import { isImage2ModelId } from "@/lib/provider-channels";

function uniqueKnownValues<T extends string>(
  values: unknown,
  allowed: readonly T[],
  fallback: readonly T[],
): T[] {
  if (!Array.isArray(values)) {
    return [...fallback];
  }

  const allowedSet = new Set<string>(allowed);
  const unique = values.filter(
    (value, index): value is T =>
      typeof value === "string" &&
      allowedSet.has(value) &&
      values.indexOf(value) === index,
  );

  return unique.length > 0 ? unique : [...fallback];
}

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

function configuredImage2Capabilities(
  base: ModelCapabilities,
  config: {
    aspectRatios: unknown;
    resolutions: unknown;
    maxN: unknown;
  },
): ModelCapabilities {
  const allowedAspectRatios = uniqueKnownValues<AspectRatio>(
    config.aspectRatios,
    IMAGE_ASPECT_RATIO_OPTIONS,
    base.aspectRatios,
  );
  const requestedResolutions = uniqueKnownValues<Resolution>(
    config.resolutions,
    IMAGE_RESOLUTION_OPTIONS,
    base.resolutions,
  );
  const resolutionAspectRatios: ModelCapabilities["resolutionAspectRatios"] =
    {};
  const resolutions = requestedResolutions.filter((resolution) => {
    const supported = aspectRatiosForResolution(base, resolution).filter(
      (aspectRatio) => allowedAspectRatios.includes(aspectRatio),
    );

    if (supported.length === 0) {
      return false;
    }

    resolutionAspectRatios[resolution] = supported;
    return true;
  });

  if (resolutions.length === 0) {
    return {
      ...base,
      maxN: positiveInteger(config.maxN, base.maxN, base.maxN),
    };
  }

  return {
    ...base,
    aspectRatios: allowedAspectRatios.filter((aspectRatio) =>
      resolutions.some((resolution) =>
        isResolutionAspectRatioSupported(base, resolution, aspectRatio),
      ),
    ),
    resolutions,
    maxN: positiveInteger(config.maxN, base.maxN, base.maxN),
    resolutionAspectRatios,
  };
}

function withValidDefaults(model: ModelDefinition): ModelDefinition {
  const resolution = model.capabilities.resolutions.includes(
    model.defaults.resolution,
  )
    ? model.defaults.resolution
    : model.capabilities.resolutions[0];
  const resolutionAspectRatios = resolution
    ? aspectRatiosForResolution(model.capabilities, resolution)
    : [];
  const aspectRatio =
    resolution &&
    model.capabilities.aspectRatios.includes(model.defaults.aspectRatio) &&
    resolutionAspectRatios.includes(model.defaults.aspectRatio)
      ? model.defaults.aspectRatio
      : resolutionAspectRatios[0];

  if (!resolution || !aspectRatio) {
    return model;
  }

  return {
    ...model,
    defaults: {
      ...model.defaults,
      resolution,
      aspectRatio,
    },
  };
}

export async function applyRuntimeModelConfig(
  model: ModelDefinition,
): Promise<ModelDefinition> {
  if (!isImage2ModelId(model.id)) {
    return model;
  }

  const [aspectRatios, resolutions, maxN] = await Promise.all([
    getSystemConfigValue("generation.image2AspectRatios"),
    getSystemConfigValue("generation.image2Resolutions"),
    getSystemConfigValue("generation.image2MaxN"),
  ]);

  return withValidDefaults({
    ...model,
    capabilities: configuredImage2Capabilities(model.capabilities, {
      aspectRatios,
      resolutions,
      maxN,
    }),
  });
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
