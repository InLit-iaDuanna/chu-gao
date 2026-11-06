import type {
  Discipline,
  PostShape,
  PromptVisibility,
} from "./types";

const STORAGE_PREFIX = "chugao.inspiration.publish-preload.v1";
const MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const TOKEN_PATTERN = /^[a-z0-9-]{1,100}$/i;
const MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const SHAPES = new Set<PostShape>([
  "WORK",
  "TEARDOWN",
  "PATTERN",
  "QUESTION",
  "REFERENCE",
  "PROCESS",
]);
const DISCIPLINES = new Set<Discipline>([
  "GRAPHIC",
  "PRODUCT",
  "INDUSTRIAL",
  "SERVICE",
  "SPATIAL",
  "BRAND",
  "MOTION",
  "DATAVIZ",
]);
const PROMPT_VISIBILITIES = new Set<PromptVisibility>([
  "PUBLIC",
  "STRUCTURE_ONLY",
  "PRIVATE",
]);

export type PublishPreloadSource = "CANVAS" | "PPT" | "NODES";

export interface PublishPreloadMedia {
  sourceGeneratedImageId?: string;
  sourceKey?: string;
  mimeType?: "image/png" | "image/jpeg" | "image/webp";
  preview: string;
  role?: "FINAL" | "PROCESS";
  isCover?: boolean;
}

export interface PublishPreloadInput {
  source: PublishPreloadSource;
  shape?: PostShape;
  discipline?: Discipline;
  title?: string;
  story?: string;
  origin?: "ORIGINAL" | "STUDY" | "REPOST";
  externalUrl?: string;
  sourceNote?: string;
  promptVisibility?: PromptVisibility;
  tags?: string[];
  media?: PublishPreloadMedia[];
}

export interface StoredPublishPreload extends PublishPreloadInput {
  version: 1;
  createdAt: number;
}

interface SaveOptions {
  storage?: Storage;
  token?: string;
  now?: number;
}

interface ReadOptions {
  storage?: Storage;
  now?: number;
}

function storageKey(token: string): string {
  return `${STORAGE_PREFIX}.${token}`;
}

function sessionStorageOrThrow(): Storage {
  if (typeof window === "undefined") {
    throw new Error("发布预填仅可在浏览器中使用");
  }
  return window.sessionStorage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function optionalString(
  value: unknown,
  maximum: number,
): value is string | undefined {
  return value === undefined || (typeof value === "string" && value.length <= maximum);
}

function parseMedia(value: unknown): PublishPreloadMedia | null {
  if (!isRecord(value)) return null;
  const sourceGeneratedImageId = value.sourceGeneratedImageId;
  const sourceKey = value.sourceKey;
  const mimeType = value.mimeType;
  const role = value.role;
  const isCover = value.isCover;

  if (
    !optionalString(sourceGeneratedImageId, 160) ||
    !optionalString(sourceKey, 500) ||
    (!sourceGeneratedImageId && !sourceKey) ||
    !optionalString(mimeType, 32) ||
    (mimeType !== undefined && !MIME_TYPES.has(mimeType)) ||
    typeof value.preview !== "string" ||
    value.preview.length === 0 ||
    value.preview.length > 2_000 ||
    (role !== undefined && role !== "FINAL" && role !== "PROCESS") ||
    (isCover !== undefined && typeof isCover !== "boolean")
  ) {
    return null;
  }

  return {
    ...(sourceGeneratedImageId ? { sourceGeneratedImageId } : {}),
    ...(sourceKey ? { sourceKey } : {}),
    ...(mimeType
      ? {
          mimeType: mimeType as PublishPreloadMedia["mimeType"],
        }
      : {}),
    preview: value.preview,
    ...(role ? { role } : {}),
    ...(typeof isCover === "boolean" ? { isCover } : {}),
  };
}

export function parsePublishPreload(value: unknown): StoredPublishPreload | null {
  if (!isRecord(value) || value.version !== 1) return null;
  if (
    (value.source !== "CANVAS" &&
      value.source !== "PPT" &&
      value.source !== "NODES") ||
    typeof value.createdAt !== "number" ||
    !Number.isFinite(value.createdAt) ||
    (value.shape !== undefined && !SHAPES.has(value.shape as PostShape)) ||
    (value.discipline !== undefined &&
      !DISCIPLINES.has(value.discipline as Discipline)) ||
    !optionalString(value.title, 120) ||
    !optionalString(value.story, 10_000) ||
    (value.origin !== undefined &&
      value.origin !== "ORIGINAL" &&
      value.origin !== "STUDY" &&
      value.origin !== "REPOST") ||
    !optionalString(value.externalUrl, 2_000) ||
    !optionalString(value.sourceNote, 3_000) ||
    (value.promptVisibility !== undefined &&
      !PROMPT_VISIBILITIES.has(value.promptVisibility as PromptVisibility)) ||
    (value.tags !== undefined &&
      (!Array.isArray(value.tags) ||
        value.tags.length > 12 ||
        value.tags.some(
          (tag) => typeof tag !== "string" || tag.length === 0 || tag.length > 32,
        ))) ||
    (value.media !== undefined &&
      (!Array.isArray(value.media) || value.media.length > 9))
  ) {
    return null;
  }

  const media = value.media?.map(parseMedia);
  if (media?.some((item) => item === null)) return null;

  return {
    version: 1,
    createdAt: value.createdAt,
    source: value.source,
    ...(value.shape ? { shape: value.shape as PostShape } : {}),
    ...(value.discipline
      ? { discipline: value.discipline as Discipline }
      : {}),
    ...(value.title !== undefined ? { title: value.title } : {}),
    ...(value.story !== undefined ? { story: value.story } : {}),
    ...(value.origin ? { origin: value.origin } : {}),
    ...(value.externalUrl !== undefined
      ? { externalUrl: value.externalUrl }
      : {}),
    ...(value.sourceNote !== undefined
      ? { sourceNote: value.sourceNote }
      : {}),
    ...(value.promptVisibility
      ? {
          promptVisibility: value.promptVisibility as PromptVisibility,
        }
      : {}),
    ...(value.tags ? { tags: [...value.tags] as string[] } : {}),
    ...(media ? { media: media as PublishPreloadMedia[] } : {}),
  };
}

export function savePublishPreload(
  input: PublishPreloadInput,
  options: SaveOptions = {},
): string {
  const storage = options.storage ?? sessionStorageOrThrow();
  const token = options.token ?? crypto.randomUUID();
  if (!TOKEN_PATTERN.test(token)) throw new Error("发布预填标识无效");

  const payload: StoredPublishPreload = {
    ...input,
    version: 1,
    createdAt: options.now ?? Date.now(),
  };
  if (!parsePublishPreload(payload)) throw new Error("发布预填内容无效");
  storage.setItem(storageKey(token), JSON.stringify(payload));
  return token;
}

export function readPublishPreload(
  token: string | null,
  options: ReadOptions = {},
): StoredPublishPreload | null {
  if (!token || !TOKEN_PATTERN.test(token)) return null;
  const storage = options.storage ?? sessionStorageOrThrow();
  const key = storageKey(token);
  const raw = storage.getItem(key);
  if (!raw) return null;

  try {
    const parsed = parsePublishPreload(JSON.parse(raw));
    const now = options.now ?? Date.now();
    if (
      !parsed ||
      parsed.createdAt > now + 60_000 ||
      now - parsed.createdAt > MAX_AGE_MS
    ) {
      storage.removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    storage.removeItem(key);
    return null;
  }
}

export function removePublishPreload(
  token: string | null,
  storage?: Storage,
): void {
  if (!token || !TOKEN_PATTERN.test(token)) return;
  (storage ?? sessionStorageOrThrow()).removeItem(storageKey(token));
}
