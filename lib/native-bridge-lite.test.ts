import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetNativeBridgeForTests, callNative } from "./native-bridge-lite";

interface SentMessage {
  id: string;
  method: string;
  params: Record<string, unknown>;
}

function installFakeBridge() {
  const sent: SentMessage[] = [];
  const bridge = {
    postMessage: vi.fn((raw: string) => {
      sent.push(JSON.parse(raw) as SentMessage);
    }),
    onmessage: null as ((event: { data: string }) => void) | null,
  };
  (window as { ChugaoNative?: unknown }).ChugaoNative = bridge;

  return {
    bridge,
    sent,
    reply(message: SentMessage, payload: Record<string, unknown>) {
      bridge.onmessage?.({
        data: JSON.stringify({ id: message.id, ...payload }),
      });
    },
  };
}

beforeEach(() => {
  __resetNativeBridgeForTests();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (window as { ChugaoNative?: unknown }).ChugaoNative;
});

describe("callNative", () => {
  it("resolves ok:false when the bridge does not exist", async () => {
    await expect(callNative("app.info")).resolves.toEqual({
      ok: false,
      error: { code: "unavailable", message: expect.any(String) },
    });
  });

  it("serialises the request and matches the response by id", async () => {
    const fake = installFakeBridge();
    const promise = callNative("app.checkUpdate", { manual: true });

    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]).toMatchObject({
      method: "app.checkUpdate",
      params: { manual: true },
    });
    expect(typeof fake.sent[0].id).toBe("string");

    fake.reply(fake.sent[0], { ok: true, result: { status: "latest" } });

    await expect(promise).resolves.toEqual({
      ok: true,
      result: { status: "latest" },
    });
  });

  it("maps shell errors to ok:false", async () => {
    const fake = installFakeBridge();
    const promise = callNative("app.info");

    fake.reply(fake.sent[0], {
      ok: false,
      error: { code: "not_supported", message: "不支持" },
    });

    await expect(promise).resolves.toEqual({
      ok: false,
      error: { code: "not_supported", message: "不支持" },
    });
  });

  it("keeps one handler for concurrent calls", async () => {
    const fake = installFakeBridge();
    const first = callNative("app.info");
    const second = callNative("app.checkUpdate", { manual: false });

    expect(fake.sent).toHaveLength(2);
    expect(fake.sent[0].id).not.toBe(fake.sent[1].id);

    fake.reply(fake.sent[1], { ok: true, result: 2 });
    fake.reply(fake.sent[0], { ok: true, result: 1 });

    await expect(first).resolves.toEqual({ ok: true, result: 1 });
    await expect(second).resolves.toEqual({ ok: true, result: 2 });
  });

  it("times out without a response", async () => {
    vi.useFakeTimers();
    installFakeBridge();

    const promise = callNative("app.info", {}, 1_000);
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(promise).resolves.toMatchObject({
      ok: false,
      error: { code: "timeout" },
    });
  });

  it("ignores malformed payloads and other ids", async () => {
    const fake = installFakeBridge();
    const promise = callNative("app.info", {}, 500);

    fake.bridge.onmessage?.({ data: "not-json" });
    fake.bridge.onmessage?.({
      data: JSON.stringify({ id: "someone-else", ok: true, result: 1 }),
    });
    fake.reply(fake.sent[0], { ok: true, result: "1.0.0" });

    await expect(promise).resolves.toEqual({ ok: true, result: "1.0.0" });
  });
});
