export const CLIENT_DEVICE_TYPE_HEADER = "x-chugao-device-type";
export const CLIENT_DEVICE_TOUCH_POINTS_HEADER = "x-chugao-device-touch-points";
export const CLIENT_DEVICE_ID_HEADER = "x-chugao-device-id";
export const DEVICE_ID_COOKIE_NAME = "chugao_device_id";
const DEVICE_ID_STORAGE_KEY = "chugao_device_id";
const AUTH_LOCK_NAME = "chugao-auth-login";
const AUTH_LOCK_DB_NAME = "chugao-auth-coordination";
const AUTH_LOCK_STORE_NAME = "locks";
const AUTH_LOCK_LEASE_MS = 30_000;
const AUTH_LOCK_RETRY_MS = 60;

export const SESSION_DEVICE_TYPES = ["WEB", "MOBILE", "IPAD"] as const;

export type SessionDeviceType = (typeof SESSION_DEVICE_TYPES)[number];

export function isSessionDeviceType(
  value: unknown,
): value is SessionDeviceType {
  return (
    typeof value === "string" &&
    SESSION_DEVICE_TYPES.includes(value as SessionDeviceType)
  );
}

function normalizeDeviceHint(value: string | null): SessionDeviceType | null {
  const normalized = value?.trim().toUpperCase();
  return isSessionDeviceType(normalized) ? normalized : null;
}

/**
 * Server-side platform classification. The explicit hint mainly exists for
 * iPadOS desktop mode, whose User-Agent intentionally looks like macOS.
 */
export function detectSessionDeviceType(headers: Headers): SessionDeviceType {
  const userAgent = headers.get("user-agent") ?? "";
  const normalizedUserAgent = userAgent.toLowerCase();
  const hint = normalizeDeviceHint(headers.get(CLIENT_DEVICE_TYPE_HEADER));
  const touchPoints = Number.parseInt(
    headers.get(CLIENT_DEVICE_TOUCH_POINTS_HEADER) ?? "0",
    10,
  );
  const hasIPadDesktopEvidence =
    hint === "IPAD" &&
    normalizedUserAgent.includes("macintosh") &&
    Number.isFinite(touchPoints) &&
    touchPoints >= 2;

  if (normalizedUserAgent.includes("ipad") || hasIPadDesktopEvidence) {
    return "IPAD";
  }

  if (
    normalizedUserAgent.includes("iphone") ||
    normalizedUserAgent.includes("ipod") ||
    normalizedUserAgent.includes("windows phone") ||
    normalizedUserAgent.includes("iemobile") ||
    normalizedUserAgent.includes("opera mini") ||
    (normalizedUserAgent.includes("android") &&
      normalizedUserAgent.includes("mobile"))
  ) {
    return "MOBILE";
  }

  return "WEB";
}

/** Client hint sent only during login/registration. */
export function detectBrowserDeviceType(): SessionDeviceType {
  if (typeof navigator === "undefined") {
    return "WEB";
  }

  const userAgent = navigator.userAgent ?? "";
  const platform = navigator.platform ?? "";
  const isIPad =
    /iPad/i.test(userAgent) ||
    (/MacIntel/i.test(platform) && navigator.maxTouchPoints > 1);

  if (isIPad) {
    return "IPAD";
  }

  if (
    /iPhone|iPod|Windows Phone|IEMobile|Opera Mini/i.test(userAgent) ||
    (/Android/i.test(userAgent) && /Mobile/i.test(userAgent))
  ) {
    return "MOBILE";
  }

  return "WEB";
}

export function detectBrowserTouchPoints(): string {
  if (typeof navigator === "undefined") {
    return "0";
  }

  return String(Math.max(0, navigator.maxTouchPoints || 0));
}

/**
 * Bootstrap a stable id before the first login response sets the HttpOnly
 * cookie. This keeps simultaneous login tabs from looking like two devices;
 * the server cookie remains authoritative on subsequent requests.
 */
export function getBrowserDeviceId(): string {
  if (typeof window === "undefined") {
    return "";
  }

  try {
    const existing =
      window.localStorage.getItem(DEVICE_ID_STORAGE_KEY) ?? undefined;
    if (existing && isValidDeviceId(existing)) {
      return existing;
    }
  } catch {
    // Storage can be disabled in privacy modes.
  }

  const generated =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? `${crypto.randomUUID()}${crypto.randomUUID()}`
      : `${Math.random().toString(36).slice(2)}${Math.random()
          .toString(36)
          .slice(2)}${Date.now().toString(36)}`;

  try {
    window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, generated);
  } catch {
    // The server will still issue its persistent cookie after login.
  }

  return generated;
}

interface StoredAuthLock {
  name: string;
  owner: string;
  expiresAt: number;
}

function openAuthLockDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(AUTH_LOCK_DB_NAME, 1);

    request.addEventListener("upgradeneeded", () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(AUTH_LOCK_STORE_NAME)) {
        database.createObjectStore(AUTH_LOCK_STORE_NAME, { keyPath: "name" });
      }
    });
    request.addEventListener("success", () => {
      request.result.addEventListener("versionchange", () =>
        request.result.close(),
      );
      resolve(request.result);
    });
    request.addEventListener("error", () =>
      reject(request.error ?? new Error("Could not open the auth lock store.")),
    );
    request.addEventListener("blocked", () =>
      reject(new Error("The auth lock store upgrade is blocked.")),
    );
  });
}

function tryAcquireStoredAuthLock(
  database: IDBDatabase,
  owner: string,
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(AUTH_LOCK_STORE_NAME, "readwrite");
    const store = transaction.objectStore(AUTH_LOCK_STORE_NAME);
    const request = store.get(AUTH_LOCK_NAME);
    let acquired = false;

    request.addEventListener("success", () => {
      const current = request.result as StoredAuthLock | undefined;
      const now = Date.now();
      acquired = !current || current.expiresAt <= now;

      if (acquired) {
        store.put({
          name: AUTH_LOCK_NAME,
          owner,
          expiresAt: now + AUTH_LOCK_LEASE_MS,
        } satisfies StoredAuthLock);
      }
    });
    transaction.addEventListener("complete", () => resolve(acquired));
    transaction.addEventListener("abort", () =>
      reject(transaction.error ?? new Error("Auth lock transaction aborted.")),
    );
    transaction.addEventListener("error", () =>
      reject(transaction.error ?? new Error("Auth lock transaction failed.")),
    );
  });
}

function renewStoredAuthLock(
  database: IDBDatabase,
  owner: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(AUTH_LOCK_STORE_NAME, "readwrite");
    const store = transaction.objectStore(AUTH_LOCK_STORE_NAME);
    const request = store.get(AUTH_LOCK_NAME);

    request.addEventListener("success", () => {
      const current = request.result as StoredAuthLock | undefined;
      if (current?.owner === owner) {
        store.put({
          ...current,
          expiresAt: Date.now() + AUTH_LOCK_LEASE_MS,
        } satisfies StoredAuthLock);
      }
    });
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("abort", () =>
      reject(transaction.error ?? new Error("Auth lock transaction aborted.")),
    );
    transaction.addEventListener("error", () =>
      reject(transaction.error ?? new Error("Auth lock transaction failed.")),
    );
  });
}

function releaseStoredAuthLock(
  database: IDBDatabase,
  owner: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(AUTH_LOCK_STORE_NAME, "readwrite");
    const store = transaction.objectStore(AUTH_LOCK_STORE_NAME);
    const request = store.get(AUTH_LOCK_NAME);

    request.addEventListener("success", () => {
      const current = request.result as StoredAuthLock | undefined;
      if (current?.owner === owner) {
        store.delete(AUTH_LOCK_NAME);
      }
    });
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("abort", () =>
      reject(transaction.error ?? new Error("Auth lock transaction aborted.")),
    );
    transaction.addEventListener("error", () =>
      reject(transaction.error ?? new Error("Auth lock transaction failed.")),
    );
  });
}

function authLockOwnerId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function waitForAuthLockRetry(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(
      resolve,
      AUTH_LOCK_RETRY_MS + Math.floor(Math.random() * AUTH_LOCK_RETRY_MS),
    );
  });
}

async function withStoredBrowserAuthLock<T>(
  task: () => Promise<T>,
): Promise<T> {
  if (typeof indexedDB === "undefined") {
    return task();
  }

  let database: IDBDatabase | null = null;
  const owner = authLockOwnerId();

  try {
    database = await openAuthLockDatabase();
    while (!(await tryAcquireStoredAuthLock(database, owner))) {
      await waitForAuthLockRetry();
    }
  } catch {
    database?.close();
    return task();
  }

  const lockDatabase = database;
  const heartbeat = window.setInterval(() => {
    void renewStoredAuthLock(lockDatabase, owner).catch(() => undefined);
  }, AUTH_LOCK_LEASE_MS / 3);

  try {
    return await task();
  } finally {
    window.clearInterval(heartbeat);
    await releaseStoredAuthLock(lockDatabase, owner).catch(() => undefined);
    lockDatabase.close();
  }
}

export async function withBrowserAuthLock<T>(
  task: () => Promise<T>,
): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request(AUTH_LOCK_NAME, task);
  }

  if (typeof window === "undefined") {
    return task();
  }

  return withStoredBrowserAuthLock(task);
}

export function isValidDeviceId(value: string | undefined): value is string {
  return Boolean(value && /^[A-Za-z0-9_-]{20,128}$/.test(value));
}
