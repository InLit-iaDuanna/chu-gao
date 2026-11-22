import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetNativeBridgeForTests } from "@/lib/native-bridge";
import {
  LOCAL_CONVERSATION_INDEX_KEY,
  conversationImageUrls,
  deleteLocalConversation,
  listLocalConversations,
  loadConversationSnapshot,
  localFileKeyForUrl,
  readLocalIndex,
  saveConversationSnapshot,
  withLocalImageUrls,
} from "./local-conversations";
import type { Conversation } from "./types";

interface StoredFile {
  key: string;
  bytes: number;
  mime: string;
  localUrl: string;
}

function installFakeBridge() {
  const files = new Map<string, string>();
  const savedFiles = new Map<string, StoredFile>();
  const deletedFiles: string[] = [];
  const savedUrls: string[] = [];

  const bridge = {
    onmessage: null as ((event: { data: string }) => void) | null,
    postMessage(raw: string) {
      const request = JSON.parse(raw) as {
        id: string;
        method: string;
        params: Record<string, string>;
      };
      const reply = (payload: unknown) =>
        queueMicrotask(() =>
          bridge.onmessage?.({ data: JSON.stringify(payload) }),
        );
      const params = request.params ?? {};
      switch (request.method) {
        case "localStore.put":
          files.set(params.key, params.value);
          return reply({ id: request.id, ok: true, result: { ok: true } });
        case "localStore.get":
          return reply({
            id: request.id,
            ok: true,
            result: { value: files.get(params.key) ?? null },
          });
        case "localStore.list": {
          const prefix = params.prefix ?? "";
          const items = [...files.keys()]
            .filter((key) => key.startsWith(prefix))
            .map((key) => ({ key, bytes: 1, updatedAt: 1 }));
          return reply({ id: request.id, ok: true, result: { items } });
        }
        case "localStore.delete":
          files.delete(params.key);
          return reply({ id: request.id, ok: true, result: { ok: true } });
        case "localStore.saveFile": {
          savedUrls.push(params.url);
          const key = params.key;
          const file = {
            key,
            bytes: 10,
            mime: "image/png",
            localUrl: `/__local/files/${key}`,
          };
          savedFiles.set(key, file);
          files.set(key, "img");
          return reply({ id: request.id, ok: true, result: file });
        }
        case "localStore.deleteFile":
          deletedFiles.push(params.key);
          files.delete(params.key);
          return reply({ id: request.id, ok: true, result: { ok: true } });
        default:
          return reply({
            id: request.id,
            ok: false,
            error: { code: "UNKNOWN_METHOD", message: request.method },
          });
      }
    },
  };

  (window as unknown as { ChugaoNative?: unknown }).ChugaoNative = bridge;
  return { files, savedFiles, deletedFiles, savedUrls, bridge };
}

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: "conv-1",
    title: "手机上的对话",
    storage: "local",
    lastMessageAt: "2026-11-21T08:00:00.000Z",
    createdAt: "2026-11-21T07:00:00.000Z",
    messages: [
      {
        id: "m1",
        role: "user",
        content: "画一只猫",
        createdAt: "2026-11-21T07:00:01.000Z",
      },
      {
        id: "m2",
        role: "assistant",
        content: "好的",
        generationId: "gen-1",
        imageUrl: "/api/generations/gen-1/images/img-1",
        images: [
          {
            id: "img-1",
            src: "/api/generations/gen-1/images/img-1",
            url: "/api/generations/gen-1/images/img-1",
            downloadUrl: "/api/generations/gen-1/images/img-1",
            thumbnailUrl: "/api/generations/gen-1/images/img-1?variant=thumb",
            width: 1024,
            height: 1024,
            mimeType: "image/png",
            createdAt: "2026-11-21T07:00:02.000Z",
          },
        ],
        createdAt: "2026-11-21T07:00:02.000Z",
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  resetNativeBridgeForTests();
  delete (window as unknown as { ChugaoNative?: unknown }).ChugaoNative;
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  resetNativeBridgeForTests();
  delete (window as unknown as { ChugaoNative?: unknown }).ChugaoNative;
  vi.restoreAllMocks();
});

describe("localFileKeyForUrl", () => {
  it("maps site generation images and thumbnails", () => {
    expect(localFileKeyForUrl("/api/generations/gen-1/images/img-1")).toBe(
      "img.gen-1.img-1",
    );
    expect(
      localFileKeyForUrl(
        "https://chugao.art/api/generations/gen-1/images/img-1?variant=thumb",
      ),
    ).toBe("img.gen-1.img-1.thumb");
  });

  it("ignores non-site urls and unexpected paths", () => {
    expect(localFileKeyForUrl("https://example.com/a.png")).toBeNull();
    expect(localFileKeyForUrl("/api/upload?key=abc")).toBeNull();
    expect(localFileKeyForUrl("")).toBeNull();
  });
});

describe("本机快照", () => {
  it("is a no-op without the native bridge", async () => {
    expect(await saveConversationSnapshot(conversation())).toBeNull();
    expect(await listLocalConversations()).toEqual([]);
    expect(await loadConversationSnapshot("conv-1")).toBeNull();
  });

  it("stores the conversation, index and cached images", async () => {
    const bridge = installFakeBridge();

    const entry = await saveConversationSnapshot(conversation());

    expect(entry).toMatchObject({
      id: "conv-1",
      title: "手机上的对话",
      storage: "local",
      messageCount: 2,
    });
    const raw = bridge.files.get("conv.conv-1.json");
    expect(raw).toBeTruthy();
    const snapshot = JSON.parse(String(raw));
    expect(snapshot.messages).toHaveLength(2);
    // 不改写服务端对象：消息里的 URL 仍是原始地址。
    expect(snapshot.messages[1].imageUrl).toBe(
      "/api/generations/gen-1/images/img-1",
    );
    expect(snapshot.localUrlMap).toEqual({
      "/api/generations/gen-1/images/img-1": "/__local/files/img.gen-1.img-1",
      "/api/generations/gen-1/images/img-1?variant=thumb":
        "/__local/files/img.gen-1.img-1.thumb",
    });
    expect(bridge.savedUrls).toEqual([
      `${window.location.origin}/api/generations/gen-1/images/img-1`,
      `${window.location.origin}/api/generations/gen-1/images/img-1?variant=thumb`,
    ]);

    const index = JSON.parse(
      String(bridge.files.get(LOCAL_CONVERSATION_INDEX_KEY)),
    );
    expect(index).toHaveLength(1);
    expect(index[0].id).toBe("conv-1");

    const loaded = await loadConversationSnapshot("conv-1");
    expect(loaded?.snapshot.title).toBe("手机上的对话");
    expect(Object.keys(loaded?.localUrlMap ?? {})).toHaveLength(2);
  });

  it("skips images that are already cached", async () => {
    const bridge = installFakeBridge();
    await saveConversationSnapshot(conversation());
    bridge.savedUrls.length = 0;

    await saveConversationSnapshot(conversation({ title: "改名后" }));

    expect(bridge.savedUrls).toEqual([]);
    const index = await readLocalIndex();
    expect(index[0].title).toBe("改名后");
    expect(index).toHaveLength(1);
  });

  it("deletes the snapshot together with its image files", async () => {
    const bridge = installFakeBridge();
    await saveConversationSnapshot(conversation());

    await deleteLocalConversation("conv-1");

    expect(bridge.files.has("conv.conv-1.json")).toBe(false);
    expect(bridge.deletedFiles.sort()).toEqual([
      "img.gen-1.img-1",
      "img.gen-1.img-1.thumb",
    ]);
    expect(await readLocalIndex()).toEqual([]);
  });

  it("survives native failures without throwing", async () => {
    installFakeBridge();
    (
      window as unknown as { ChugaoNative: { postMessage: () => void } }
    ).ChugaoNative.postMessage = () => {
      throw new Error("bridge down");
    };

    await expect(saveConversationSnapshot(conversation())).resolves.toBeNull();
  });
});

describe("withLocalImageUrls", () => {
  it("swaps image urls on a copy and keeps the source untouched", () => {
    const source = conversation();
    const view = withLocalImageUrls(source, {
      "/api/generations/gen-1/images/img-1": "/__local/files/img.gen-1.img-1",
    });

    expect(view.messages[1].imageUrl).toBe("/__local/files/img.gen-1.img-1");
    expect(source.messages[1].imageUrl).toBe(
      "/api/generations/gen-1/images/img-1",
    );
  });

  it("collects only distinct image urls", () => {
    expect(conversationImageUrls(conversation())).toEqual([
      "/api/generations/gen-1/images/img-1",
      "/api/generations/gen-1/images/img-1?variant=thumb",
    ]);
  });
});
