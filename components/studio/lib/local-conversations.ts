// 手机本机对话存储层。只在安卓外壳（window.ChugaoNative）里生效：
// 网页端调用一律返回空结果，不影响原有云端行为。
//
// 原生方法（本地桥协议见 lib/native-bridge.ts）：
//   localStore.put { key, value }        localStore.get { key } → { value }
//   localStore.list { prefix } → { items: [{ key, bytes, updatedAt }] }
//   localStore.delete { key }
//   localStore.saveFile { url, key } → { key, bytes, mime, localUrl }
//   localStore.deleteFile { key }
//
// 快照：conv.<id>.json 保存服务端返回的完整对话（不改写服务端对象），
// conv-index.json 保存列表索引。图片先落盘到 /__local/files/<key>，
// localUrlMap 记录原始 URL → 本地 URL，渲染本地只读视图时再替换。

import type { Conversation, ConversationMessage } from "./types";
import { callNative, hasNativeBridge } from "@/lib/native-bridge";

export const LOCAL_CONVERSATION_INDEX_KEY = "conv-index.json";
const KEY_PATTERN = /^[A-Za-z0-9._-]{1,120}$/;
const LOCAL_FILE_PREFIX = "/__local/files/";
const LOCAL_IMAGE_PREFIX = "img.";
const LOCAL_THUMB_SUFFIX = ".thumb";
const SITE_FALLBACK_ORIGIN = "https://chugao.art";

export type LocalConversationStorage = "local" | "cloud";

export interface LocalConversationIndexEntry {
  id: string;
  title: string;
  updatedAt: string;
  lastMessageAt: string;
  storage: LocalConversationStorage;
  messageCount: number;
}

export interface LocalConversationSnapshot extends Conversation {
  /** 原始图片 URL → 本机 localUrl（/__local/files/<key>）。 */
  localUrlMap?: Record<string, string>;
  savedAt?: string;
}

export interface LocalConversationRecord {
  snapshot: LocalConversationSnapshot;
  localUrlMap: Record<string, string>;
  savedAt: string | null;
}

export function isLocalStoreAvailable(): boolean {
  return hasNativeBridge();
}

export function isValidLocalKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

function conversationKey(id: string) {
  return `conv.${id}.json`;
}

function warn(action: string, error: unknown) {
  console.warn(`[local-conversations] ${action} failed`, error);
}

function absoluteSiteUrl(url: string): string | null {
  if (typeof window === "undefined") return null;
  const origin = window.location?.origin;
  const base =
    origin && /^https?:\/\//.test(origin) && origin !== "null"
      ? origin
      : SITE_FALLBACK_ORIGIN;
  try {
    return new URL(url, base).toString();
  } catch {
    return null;
  }
}

/**
 * 本站生成图片 → 本机文件名。只有 /api/generations/<gen>/images/<image>
 * 这类站内图片会落盘；其它 URL 保持原样（联网时可正常显示）。
 */
export function localFileKeyForUrl(url: string): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url, SITE_FALLBACK_ORIGIN);
  } catch {
    return null;
  }
  if (!/^\/api\/(generations|v1)\//.test(parsed.pathname)) return null;
  const match = parsed.pathname.match(
    /^\/api\/(?:generations|v1)\/([A-Za-z0-9_-]{1,64})\/images\/([A-Za-z0-9_-]{1,64})$/,
  );
  if (!match) return null;
  const [, generationId, imageId] = match;
  const thumb = parsed.searchParams.get("variant") === "thumb";
  const key = `${LOCAL_IMAGE_PREFIX}${generationId}.${imageId}${
    thumb ? LOCAL_THUMB_SUFFIX : ""
  }`;
  return isValidLocalKey(key) ? key : null;
}

function messageImageUrls(message: ConversationMessage): string[] {
  const urls = new Set<string>();
  const push = (value: unknown) => {
    if (typeof value === "string" && value.startsWith("/")) urls.add(value);
  };
  push(message.imageUrl);
  push(message.thumbnailUrl);
  for (const image of message.images ?? []) {
    push(image.src);
    push(image.url);
    push(image.thumbnailUrl);
  }
  return [...urls];
}

export function conversationImageUrls(
  conversation: Pick<Conversation, "messages">,
): string[] {
  const urls = new Set<string>();
  for (const message of conversation.messages ?? [])
    for (const url of messageImageUrls(message)) urls.add(url);
  return [...urls];
}

async function localStoreGet(key: string): Promise<string | null> {
  const result = await callNative<{ value?: string | null }>("localStore.get", {
    key,
  });
  return typeof result?.value === "string" ? result.value : null;
}

async function localStorePut(key: string, value: string): Promise<void> {
  await callNative("localStore.put", { key, value });
}

async function localStoreList(prefix?: string) {
  const result = await callNative<{
    items?: Array<{ key?: string; bytes?: number; updatedAt?: number }>;
  }>("localStore.list", prefix ? { prefix } : {});
  return Array.isArray(result?.items)
    ? result.items.filter(
        (item): item is { key: string; bytes?: number; updatedAt?: number } =>
          typeof item?.key === "string" && isValidLocalKey(item.key),
      )
    : [];
}

async function localStoreDelete(key: string): Promise<void> {
  await callNative("localStore.delete", { key });
}

async function localStoreSaveFile(url: string, key: string) {
  return callNative<{
    key?: string;
    bytes?: number;
    mime?: string;
    localUrl?: string;
  }>("localStore.saveFile", { url, key }, 60_000);
}

async function localStoreDeleteFile(key: string): Promise<void> {
  await callNative("localStore.deleteFile", { key });
}

export async function readLocalIndex(): Promise<LocalConversationIndexEntry[]> {
  if (!isLocalStoreAvailable()) return [];
  try {
    const raw = await localStoreGet(LOCAL_CONVERSATION_INDEX_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is LocalConversationIndexEntry =>
        Boolean(item) &&
        typeof item === "object" &&
        typeof (item as LocalConversationIndexEntry).id === "string" &&
        isValidLocalKey(
          conversationKey((item as LocalConversationIndexEntry).id),
        ),
    );
  } catch (error) {
    warn("read index", error);
    return [];
  }
}

async function writeLocalIndex(entries: LocalConversationIndexEntry[]) {
  await localStorePut(
    LOCAL_CONVERSATION_INDEX_KEY,
    JSON.stringify(
      entries.slice(0, 200).map((entry) => ({
        id: entry.id,
        title: entry.title,
        updatedAt: entry.updatedAt,
        lastMessageAt: entry.lastMessageAt,
        storage: entry.storage === "cloud" ? "cloud" : "local",
        messageCount: Number(entry.messageCount) || 0,
      })),
    ),
  );
}

/** 串行化索引读写，避免并发快照互相覆盖。 */
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task);
  queue = next.catch(() => undefined);
  return next;
}

function indexEntryFor(
  conversation: Conversation,
  savedAt: string,
): LocalConversationIndexEntry {
  return {
    id: conversation.id,
    title: conversation.title,
    updatedAt: savedAt,
    lastMessageAt: conversation.lastMessageAt,
    storage: conversation.storage === "cloud" ? "cloud" : "local",
    messageCount: conversation.messages?.length ?? 0,
  };
}

async function cacheConversationImages(
  conversation: Conversation,
  existingKeys: Set<string>,
): Promise<Record<string, string>> {
  const localUrlMap: Record<string, string> = {};
  for (const url of conversationImageUrls(conversation)) {
    const key = localFileKeyForUrl(url);
    if (!key) continue;
    const localUrl = `${LOCAL_FILE_PREFIX}${key}`;
    if (existingKeys.has(key)) {
      localUrlMap[url] = localUrl;
      continue;
    }
    const absolute = absoluteSiteUrl(url);
    if (!absolute) continue;
    try {
      const saved = await localStoreSaveFile(absolute, key);
      existingKeys.add(key);
      localUrlMap[url] = saved?.localUrl || localUrl;
    } catch (error) {
      warn(`save image ${key}`, error);
    }
  }
  return localUrlMap;
}

async function existingImageKeys(): Promise<Set<string>> {
  try {
    const items = await localStoreList(LOCAL_IMAGE_PREFIX);
    return new Set(items.map((item) => item.key));
  } catch (error) {
    warn("list images", error);
    return new Set();
  }
}

/**
 * 把服务端返回的完整对话（含 messages）保存为本机快照，并更新索引。
 * 只在 APP 内生效；失败只记录警告，不影响主流程。
 */
export async function saveConversationSnapshot(
  conversation: Conversation,
): Promise<LocalConversationIndexEntry | null> {
  if (!isLocalStoreAvailable()) return null;
  const id = conversation?.id;
  if (!id || !isValidLocalKey(conversationKey(id))) return null;

  try {
    const existing = await existingImageKeys();
    const localUrlMap = await cacheConversationImages(conversation, existing);
    const savedAt = new Date().toISOString();
    // 不改写服务端对象：只写一份带 localUrlMap 的副本。
    const snapshot: LocalConversationSnapshot = {
      ...conversation,
      messages: (conversation.messages ?? []).map((message) => ({
        ...message,
        images: message.images?.map((image) => ({ ...image })),
      })),
      localUrlMap,
      savedAt,
    };

    await enqueue(async () => {
      await localStorePut(conversationKey(id), JSON.stringify(snapshot));
      const entries = await readLocalIndex();
      const entry = indexEntryFor(conversation, savedAt);
      await writeLocalIndex([
        entry,
        ...entries.filter((item) => item.id !== id),
      ]);
    });

    return indexEntryFor(conversation, savedAt);
  } catch (error) {
    warn("save snapshot", error);
    return null;
  }
}

export async function loadConversationSnapshot(
  id: string,
): Promise<LocalConversationRecord | null> {
  if (!isLocalStoreAvailable()) return null;
  if (!id || !isValidLocalKey(conversationKey(id))) return null;
  try {
    const raw = await localStoreGet(conversationKey(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalConversationSnapshot;
    if (!parsed || parsed.id !== id) return null;
    return {
      snapshot: parsed,
      localUrlMap:
        parsed.localUrlMap && typeof parsed.localUrlMap === "object"
          ? parsed.localUrlMap
          : {},
      savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : null,
    };
  } catch (error) {
    warn("load snapshot", error);
    return null;
  }
}

export async function listLocalConversations(): Promise<
  LocalConversationIndexEntry[]
> {
  return readLocalIndex();
}

/** 删除本机快照及其图片文件。 */
export async function deleteLocalConversation(id: string): Promise<void> {
  if (!isLocalStoreAvailable()) return;
  if (!id || !isValidLocalKey(conversationKey(id))) return;

  try {
    const record = await loadConversationSnapshot(id);
    const fileKeys = new Set<string>();
    for (const localUrl of Object.values(record?.localUrlMap ?? {})) {
      if (typeof localUrl !== "string") continue;
      if (!localUrl.startsWith(LOCAL_FILE_PREFIX)) continue;
      const key = localUrl.slice(LOCAL_FILE_PREFIX.length);
      if (isValidLocalKey(key) && key.startsWith(LOCAL_IMAGE_PREFIX))
        fileKeys.add(key);
    }

    for (const key of fileKeys) {
      try {
        await localStoreDeleteFile(key);
      } catch (error) {
        warn(`delete image ${key}`, error);
      }
    }

    await enqueue(async () => {
      await localStoreDelete(conversationKey(id));
      const entries = await readLocalIndex();
      await writeLocalIndex(entries.filter((item) => item.id !== id));
    });
  } catch (error) {
    warn("delete snapshot", error);
  }
}

/**
 * 用 localUrlMap 替换图片地址，生成只读视图使用的副本。
 * 服务端对象与本地快照本身都不会被改写。
 */
export function withLocalImageUrls<T extends Conversation>(
  conversation: T,
  localUrlMap: Record<string, string>,
): T {
  if (!localUrlMap || !Object.keys(localUrlMap).length) return conversation;
  const swap = (url: string | undefined): string | undefined =>
    url && localUrlMap[url] ? localUrlMap[url] : url;

  return {
    ...conversation,
    messages: conversation.messages.map((message) => ({
      ...message,
      imageUrl: swap(message.imageUrl),
      thumbnailUrl: swap(message.thumbnailUrl),
      images: message.images?.map((image) => ({
        ...image,
        src: swap(image.src),
        url: swap(image.url),
        thumbnailUrl: swap(image.thumbnailUrl),
      })),
    })),
  };
}
