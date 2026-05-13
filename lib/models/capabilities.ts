import type {
  AspectRatio,
  ModelCapabilities,
  ModelDefinition,
  Resolution,
} from "@/lib/models/types";

export function aspectRatiosForResolution(
  capabilities: ModelCapabilities,
  resolution: Resolution,
): AspectRatio[] {
  return (
    capabilities.resolutionAspectRatios?.[resolution] ??
    capabilities.aspectRatios
  );
}

export function isResolutionAspectRatioSupported(
  capabilities: ModelCapabilities,
  resolution: Resolution,
  aspectRatio: AspectRatio,
): boolean {
  return aspectRatiosForResolution(capabilities, resolution).includes(
    aspectRatio,
  );
}

export function firstSupportedResolutionAspectPair(
  model: ModelDefinition,
  preferred: {
    resolution?: Resolution;
    aspectRatio?: AspectRatio;
  } = {},
): {
  resolution: Resolution;
  aspectRatio: AspectRatio;
} {
  const resolutionCandidates = [
    preferred.resolution,
    model.defaults.resolution,
    ...model.capabilities.resolutions,
  ].filter((value): value is Resolution =>
    Boolean(value && model.capabilities.resolutions.includes(value)),
  );

  for (const resolution of resolutionCandidates) {
    const aspectCandidates = [
      preferred.aspectRatio,
      model.defaults.aspectRatio,
      ...aspectRatiosForResolution(model.capabilities, resolution),
    ].filter((value): value is AspectRatio =>
      Boolean(
        value &&
          model.capabilities.aspectRatios.includes(value) &&
          isResolutionAspectRatioSupported(
            model.capabilities,
            resolution,
            value,
          ),
      ),
    );

    if (aspectCandidates[0]) {
      return {
        resolution,
        aspectRatio: aspectCandidates[0],
      };
    }
  }

  return {
    resolution: model.defaults.resolution,
    aspectRatio: model.defaults.aspectRatio,
  };
}
