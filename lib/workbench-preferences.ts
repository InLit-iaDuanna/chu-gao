export interface WorkbenchPreferences {
  modelId?: string;
  aspectRatio?: string;
  resolution?: string;
  providerChannelId?: string;
}

const STORAGE_KEY = "chugao_workbench_preferences";
const STORAGE_PREFIX = `${STORAGE_KEY}:`;

function storageKeyForUser(userId?: string | null): string {
  return userId ? `${STORAGE_PREFIX}${userId}` : STORAGE_KEY;
}

function normalizePreferences(value: unknown): WorkbenchPreferences {
  const parsed = value as WorkbenchPreferences;

  return {
    modelId: typeof parsed.modelId === "string" ? parsed.modelId : undefined,
    aspectRatio:
      typeof parsed.aspectRatio === "string" ? parsed.aspectRatio : undefined,
    resolution:
      typeof parsed.resolution === "string" ? parsed.resolution : undefined,
    providerChannelId:
      typeof parsed.providerChannelId === "string"
        ? parsed.providerChannelId
        : undefined,
  };
}

export function readWorkbenchPreferences(
  userId?: string | null,
): WorkbenchPreferences {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw =
      window.localStorage.getItem(storageKeyForUser(userId)) ??
      window.localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return {};
    }

    return normalizePreferences(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function writeWorkbenchPreferences(
  next: WorkbenchPreferences,
  userId?: string | null,
): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(storageKeyForUser(userId), JSON.stringify(next));
}

export function clearWorkbenchPreferences(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(STORAGE_KEY);

  for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
    const key = window.localStorage.key(index);

    if (key?.startsWith(STORAGE_PREFIX)) {
      window.localStorage.removeItem(key);
    }
  }
}
