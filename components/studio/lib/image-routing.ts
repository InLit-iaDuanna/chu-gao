import type { ModelInfo } from "./types";

export const AUTO_IMAGE_MODEL_ID = "__auto__";
export const IMAGE_PREFERENCE_STORAGE_KEY = "chugao.image-routing.v1";

export type ImageRouteMode = "auto" | "fixed";

export interface StoredImagePreferences {
  modelId?: string;
  quality?: string;
}

const MODEL_ROUTE_PRIORITY: Record<string, number> = {
  "gpt-image-2.6": 0,
  "gpt-image-2.6-flare": 1,
  "gpt-image-2.6-sunburst": 2,
  "gpt-image-2.5-flare": 3,
  "gpt-image-2.5-sunburst": 4,
  "gpt-image-2": 5,
  "nano-banana-2-512": 6,
};

export function sortImageModels(models: ModelInfo[]): ModelInfo[] {
  return [...models].sort((left, right) => {
    const priorityDelta =
      (MODEL_ROUTE_PRIORITY[left.id] ?? 100) -
      (MODEL_ROUTE_PRIORITY[right.id] ?? 100);
    if (priorityDelta !== 0) return priorityDelta;
    return left.displayName.localeCompare(right.displayName, "zh-CN");
  });
}

export function automaticImageModel(models: ModelInfo[]): ModelInfo | null {
  return sortImageModels(models).find((model) => model.available) ?? null;
}

export function imageRouteCandidates(
  models: ModelInfo[],
  routeMode: ImageRouteMode,
  modelId: string | null,
): ModelInfo[] {
  const ordered = sortImageModels(models);
  if (routeMode !== "fixed" || !modelId) return ordered;
  const selected = ordered.find((model) => model.id === modelId);
  return selected
    ? [selected, ...ordered.filter((model) => model.id !== selected.id)]
    : ordered;
}

export function imagePreferenceStorageKey(userId: string): string {
  return `${IMAGE_PREFERENCE_STORAGE_KEY}.${userId}`;
}

export function readStoredImagePreferences(
  userId: string | undefined,
): StoredImagePreferences | null {
  if (!userId || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(imagePreferenceStorageKey(userId));
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    return {
      ...(typeof record.modelId === "string"
        ? { modelId: record.modelId }
        : {}),
      ...(typeof record.quality === "string"
        ? { quality: record.quality }
        : {}),
    };
  } catch {
    return null;
  }
}

export function updateStoredImagePreferences(
  userId: string | undefined,
  patch: StoredImagePreferences,
): StoredImagePreferences | null {
  if (!userId || typeof window === "undefined") return null;
  const next = {
    ...(readStoredImagePreferences(userId) ?? {}),
    ...patch,
  };
  try {
    window.localStorage.setItem(
      imagePreferenceStorageKey(userId),
      JSON.stringify(next),
    );
    return next;
  } catch {
    return null;
  }
}
