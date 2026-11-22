import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  callNative,
  hasNativeBridge,
  onNativeEvent,
  resetNativeBridgeForTests,
} from "./native-bridge";

interface FakeBridge {
  postMessage: ReturnType<typeof vi.fn>;
  onmessage: ((event: { data: string }) => void) | null;
}

function installBridge(): FakeBridge {
  const bridge: FakeBridge = { postMessage: vi.fn(), onmessage: null };
  (window as unknown as { ChugaoNative?: FakeBridge }).ChugaoNative = bridge;
  return bridge;
}

function respond(bridge: FakeBridge, payload: unknown) {
  bridge.onmessage?.({ data: JSON.stringify(payload) });
}

function lastRequest(bridge: FakeBridge) {
  const raw = bridge.postMessage.mock.calls.at(-1)?.[0];
  return JSON.parse(String(raw)) as {
    id: string;
    method: string;
    params: Record<string, unknown>;
  };
}

beforeEach(() => {
  resetNativeBridgeForTests();
  delete (window as unknown as { ChugaoNative?: unknown }).ChugaoNative;
});

afterEach(() => {
  resetNativeBridgeForTests();
  vi.useRealTimers();
  delete (window as unknown as { ChugaoNative?: unknown }).ChugaoNative;
});

describe("hasNativeBridge", () => {
  it("is false in a plain browser", () => {
    expect(hasNativeBridge()).toBe(false);
  });

  it("requires a callable postMessage", () => {
    (window as unknown as { ChugaoNative?: unknown }).ChugaoNative = {
      postMessage: "nope",
    };
    expect(hasNativeBridge()).toBe(false);

    installBridge();
    expect(hasNativeBridge()).toBe(true);
  });
});

describe("callNative", () => {
  it("posts a request envelope and resolves the matching result", async () => {
    const bridge = installBridge();
    const pending = callNative<{ value: string | null }>("localStore.get", {
      key: "conv-index.json",
    });

    const request = lastRequest(bridge);
    expect(request.method).toBe("localStore.get");
    expect(request.params).toEqual({ key: "conv-index.json" });
    expect(request.id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);

    respond(bridge, { id: request.id, ok: true, result: { value: "[]" } });
    await expect(pending).resolves.toEqual({ value: "[]" });
  });

  it("rejects with the native error code", async () => {
    const bridge = installBridge();
    const pending = callNative("localStore.put", { key: "a", value: "b" });
    const request = lastRequest(bridge);

    respond(bridge, {
      id: request.id,
      ok: false,
      error: { code: "DISK_FULL", message: "空间不足" },
    });

    await expect(pending).rejects.toMatchObject({
      code: "DISK_FULL",
      message: "空间不足",
    });
  });

  it("ignores responses for other request ids", async () => {
    const bridge = installBridge();
    const pending = callNative("localStore.get", { key: "a" });
    const request = lastRequest(bridge);

    respond(bridge, { id: "someone-else", ok: true, result: 1 });
    respond(bridge, { id: request.id, ok: true, result: 2 });

    await expect(pending).resolves.toBe(2);
  });

  it("times out when the shell never answers", async () => {
    vi.useFakeTimers();
    installBridge();
    const pending = callNative("localStore.list", {}, 1_000);
    const assertion = expect(pending).rejects.toMatchObject({
      code: "NATIVE_TIMEOUT",
    });

    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
  });

  it("rejects immediately without a bridge", async () => {
    await expect(
      callNative("localStore.get", { key: "a" }),
    ).rejects.toMatchObject({ code: "NATIVE_UNAVAILABLE" });
  });

  it("installs one dispatcher that also routes events", async () => {
    const bridge = installBridge();
    const resume = vi.fn();
    const pause = vi.fn();
    const offResume = onNativeEvent("app.resume", resume);
    onNativeEvent("app.pause", pause);

    const pending = callNative("localStore.get", { key: "a" });
    const request = lastRequest(bridge);

    respond(bridge, { event: "app.resume" });
    expect(resume).toHaveBeenCalledTimes(1);
    expect(pause).not.toHaveBeenCalled();

    respond(bridge, { id: request.id, ok: true, result: null });
    await expect(pending).resolves.toBeNull();

    offResume();
    respond(bridge, { event: "app.resume" });
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it("survives malformed messages", async () => {
    const bridge = installBridge();
    const pending = callNative("localStore.get", { key: "a" });
    const request = lastRequest(bridge);

    bridge.onmessage?.({ data: "not-json" });
    respond(bridge, { id: request.id, ok: true, result: "ok" });

    await expect(pending).resolves.toBe("ok");
  });
});
