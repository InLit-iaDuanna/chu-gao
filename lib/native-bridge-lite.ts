/**
 * 原生壳桥接的最小实现（无依赖、可在任何客户端组件里调用）。
 *
 * 协议（由 android/ 壳实现）：
 *   window.ChugaoNative.postMessage(JSON.stringify({ id, method, params }))
 *   壳回调 window.ChugaoNative.onmessage = (e) => e.data === JSON.stringify({ id, ok, result | error })
 *
 * 注意：`onmessage` 只能有一个处理器，所以这里做成模块级单例分发，多个组件同时
 * 调用互不覆盖；若壳额外提供 `addEventListener("message")` 也一并监听。
 * `postMessage` 只能传字符串，这里统一 JSON 序列化。
 */

export type NativeCallOutcome =
  | { ok: true; result: unknown }
  | { ok: false; error: { code: string; message: string } };

interface NativeBridge {
  postMessage?: (message: string) => void;
  onmessage?: ((event: { data: string }) => void) | null;
  addEventListener?: (
    type: "message",
    listener: (event: { data: string }) => void,
  ) => void;
  removeEventListener?: (
    type: "message",
    listener: (event: { data: string }) => void,
  ) => void;
}

declare global {
  interface Window {
    /** 原生壳注入的桥对象；网页端不存在。 */
    ChugaoNative?: NativeBridge;
  }
}

type PendingCall = (outcome: NativeCallOutcome) => void;

const pendingCalls = new Map<string, PendingCall>();
let sequence = 0;
let listenersInstalled = false;

function readBridge(): NativeBridge | null {
  if (typeof window === "undefined") return null;
  const candidate = window.ChugaoNative;
  return candidate && typeof candidate === "object" ? candidate : null;
}

function failure(code: string, message: string): NativeCallOutcome {
  return { ok: false, error: { code, message } };
}

function normalizeResponse(payload: unknown): NativeCallOutcome {
  if (!payload || typeof payload !== "object") {
    return failure("invalid_response", "原生返回格式不正确");
  }

  const record = payload as {
    ok?: unknown;
    result?: unknown;
    error?: unknown;
  };

  if (record.ok === true) {
    return { ok: true, result: record.result ?? null };
  }

  const error = record.error;
  if (error && typeof error === "object") {
    const { code, message } = error as { code?: unknown; message?: unknown };
    return failure(
      typeof code === "string" ? code : "native_error",
      typeof message === "string" ? message : "原生调用失败",
    );
  }

  if (typeof error === "string") {
    return failure("native_error", error);
  }

  return failure("native_error", "原生调用失败");
}

function dispatch(raw: unknown): void {
  let payload: unknown = raw;

  if (typeof raw === "string") {
    try {
      payload = JSON.parse(raw) as unknown;
    } catch {
      return;
    }
  }

  if (!payload || typeof payload !== "object") return;

  const id = (payload as { id?: unknown }).id;
  if (typeof id !== "string") return;

  const settle = pendingCalls.get(id);
  if (!settle) return;

  pendingCalls.delete(id);
  settle(normalizeResponse(payload));
}

function onBridgeMessage(event: { data: string }): void {
  dispatch(event?.data);
}

function installListeners(bridge: NativeBridge): void {
  if (listenersInstalled) return;
  listenersInstalled = true;

  // 单例分发：壳只会推送到这一个回调里。
  bridge.onmessage = onBridgeMessage;

  if (typeof bridge.addEventListener === "function") {
    try {
      bridge.addEventListener("message", onBridgeMessage);
    } catch {
      // 某些壳只实现了 onmessage，监听失败不影响主路径。
    }
  }
}

/**
 * 调用原生能力。始终 resolve（不抛错）：桥不存在、超时、壳返回 error 都会
 * 变成 `{ ok: false }`，方便 UI 直接根据 ok 分支。
 */
export function callNative(
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = 15_000,
): Promise<NativeCallOutcome> {
  const bridge = readBridge();

  if (!bridge || typeof bridge.postMessage !== "function") {
    return Promise.resolve(failure("unavailable", "当前不在初稿 APP 内"));
  }

  // 先取出方法引用：后面在 Promise 回调里调用，避免实例属性在闭包中丢失收窄。
  const postMessage = bridge.postMessage.bind(bridge);

  installListeners(bridge);

  const id = `c${Date.now().toString(36)}${(sequence += 1).toString(36)}`;

  return new Promise<NativeCallOutcome>((resolve) => {
    const timer = setTimeout(
      () => {
        pendingCalls.delete(id);
        resolve(failure("timeout", "原生调用超时，请稍后重试"));
      },
      Math.max(0, timeoutMs),
    );

    pendingCalls.set(id, (outcome) => {
      clearTimeout(timer);
      resolve(outcome);
    });

    try {
      postMessage(JSON.stringify({ id, method, params }));
    } catch {
      clearTimeout(timer);
      pendingCalls.delete(id);
      resolve(failure("bridge_error", "无法连接到 APP 原生能力"));
    }
  });
}

/** 仅供测试：清空模块级状态。 */
export function __resetNativeBridgeForTests(): void {
  pendingCalls.clear();
  sequence = 0;
  listenersInstalled = false;
}
