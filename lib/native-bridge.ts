// 安卓原生桥 client。外壳通过 window.ChugaoNative 与网页通信：
//   请求：postMessage(JSON.stringify({ id, method, params }))
//   响应：onmessage({ data: JSON.stringify({ id, ok: true, result }) })
//         onmessage({ data: JSON.stringify({ id, ok: false, error }) })
//   事件：onmessage({ data: JSON.stringify({ event: "app.resume" }) })
// onmessage 只能有一个处理器，所以这里安装模块级单例分发器。
// 网页端（无桥）调用会直接 reject，调用方需先用 hasNativeBridge() 判断。

export interface NativeEventPayload {
  event: string;
  [key: string]: unknown;
}

export interface NativeBridgeError extends Error {
  code: string;
}

interface NativeBridge {
  postMessage(message: string): void;
  onmessage: ((event: { data: string }) => void) | null;
}

const NATIVE_REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;
const DEFAULT_TIMEOUT_MS = 20_000;

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: NativeBridgeError) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, PendingCall>();
const listeners = new Map<string, Set<(payload: NativeEventPayload) => void>>();
let installedFor: NativeBridge | null = null;
let sequence = 0;

function nativeBridge(): NativeBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as unknown as { ChugaoNative?: NativeBridge })
    .ChugaoNative;
  if (!bridge || typeof bridge.postMessage !== "function") return null;
  return bridge;
}

export function hasNativeBridge(): boolean {
  return nativeBridge() !== null;
}

function bridgeError(code: string, message: string): NativeBridgeError {
  const error = new Error(message) as NativeBridgeError;
  error.code = code;
  return error;
}

function settle(payload: {
  id?: unknown;
  ok?: unknown;
  result?: unknown;
  error?: { code?: unknown; message?: unknown };
}) {
  if (typeof payload.id !== "string") return false;
  const call = pending.get(payload.id);
  if (!call) return false;
  pending.delete(payload.id);
  clearTimeout(call.timer);

  if (payload.ok === true) {
    call.resolve(payload.result);
  } else {
    call.reject(
      bridgeError(
        typeof payload.error?.code === "string"
          ? payload.error.code
          : "NATIVE_ERROR",
        typeof payload.error?.message === "string"
          ? payload.error.message
          : "本机操作失败",
      ),
    );
  }

  return true;
}

function dispatchEvent(payload: NativeEventPayload) {
  const subscribers = listeners.get(payload.event);
  if (!subscribers) return;
  for (const listener of subscribers) {
    try {
      listener(payload);
    } catch (error) {
      console.warn("[native-bridge] event listener failed", error);
    }
  }
}

function installDispatcher(bridge: NativeBridge) {
  // 原生桥只有一个 onmessage；外壳重建 window.ChugaoNative 时重新安装。
  if (installedFor === bridge) return;
  installedFor = bridge;
  bridge.onmessage = (event) => {
    let payload: unknown;
    try {
      payload = typeof event.data === "string" ? JSON.parse(event.data) : null;
    } catch {
      console.warn("[native-bridge] ignored malformed message");
      return;
    }
    if (!payload || typeof payload !== "object") return;
    const message = payload as Record<string, unknown>;
    if (settle(message)) return;
    if (typeof message.event === "string")
      dispatchEvent(message as NativeEventPayload);
  };
}

export function callNative<T = unknown>(
  method: string,
  params?: Record<string, unknown>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const bridge = nativeBridge();
  if (!bridge) {
    return Promise.reject(
      bridgeError("NATIVE_UNAVAILABLE", "当前环境不支持本机存储"),
    );
  }
  installDispatcher(bridge);

  sequence = (sequence + 1) % 1_000_000;
  const id = `c${Date.now().toString(36)}${sequence.toString(36)}${Math.random()
    .toString(36)
    .slice(2, 8)}`.slice(0, 64);
  if (!NATIVE_REQUEST_ID.test(id)) {
    return Promise.reject(
      bridgeError("NATIVE_INVALID_ID", "本机请求标识不合法"),
    );
  }

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(bridgeError("NATIVE_TIMEOUT", "本机操作超时，请重试"));
    }, timeoutMs);
    pending.set(id, {
      resolve: (value) => resolve(value as T),
      reject,
      timer,
    });
    try {
      bridge.postMessage(JSON.stringify({ id, method, params: params ?? {} }));
    } catch (error) {
      clearTimeout(timer);
      pending.delete(id);
      reject(
        bridgeError(
          "NATIVE_POST_FAILED",
          error instanceof Error ? error.message : "本机操作发送失败",
        ),
      );
    }
  });
}

/** 订阅原生事件（如 app.resume / app.pause），返回取消订阅函数。 */
export function onNativeEvent(
  name: string,
  callback: (payload: NativeEventPayload) => void,
): () => void {
  let subscribers = listeners.get(name);
  if (!subscribers) {
    subscribers = new Set();
    listeners.set(name, subscribers);
  }
  subscribers.add(callback);

  return () => {
    subscribers?.delete(callback);
    if (subscribers && subscribers.size === 0) listeners.delete(name);
  };
}

/** 仅用于测试：清空挂起的请求与订阅。 */
export function resetNativeBridgeForTests() {
  for (const [id, call] of pending) {
    clearTimeout(call.timer);
    pending.delete(id);
  }
  listeners.clear();
  installedFor = null;
}
