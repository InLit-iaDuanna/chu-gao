/**
 * 安卓客户端发布信息（单一来源）。
 *
 * 由部署环境变量提供，`GET /api/app/version` 与 `/download` 页面共用同一套
 * 解析规则，避免两个入口对“是否已上线”判断不一致：
 *   APP_ANDROID_LATEST_VERSION_CODE  int，必须 > 0 才视为已发布
 *   APP_ANDROID_LATEST_VERSION_NAME  例 1.0.0
 *   APP_ANDROID_MIN_VERSION_CODE     int，默认 1
 *   APP_ANDROID_APK_URL              必须 https 且 host 为 chugao.art
 *   APP_ANDROID_APK_SHA256           64 位 hex
 *   APP_ANDROID_NOTES                更新说明，纯文本
 *   APP_ANDROID_PUBLISHED_AT         ISO 时间
 */

export interface AndroidAppVersion {
  latestVersionCode: number;
  latestVersionName: string;
  minSupportedVersionCode: number;
  apkUrl: string | null;
  sha256: string | null;
  notes: string | null;
  publishedAt: string | null;
}

type EnvSource = Record<string, string | undefined>;

export const UNCONFIGURED_VERSION: AndroidAppVersion = {
  latestVersionCode: 0,
  latestVersionName: "",
  minSupportedVersionCode: 1,
  apkUrl: null,
  sha256: null,
  notes: null,
  publishedAt: null,
};

function readTrimmed(env: EnvSource, name: string): string {
  return (env[name] ?? "").trim();
}

function readPositiveInt(env: EnvSource, name: string): number | null {
  const raw = readTrimmed(env, name);
  if (!raw) return null;
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * 只接受 https + chugao.art（含子域）的下载地址：
 * 防止误配置到第三方网盘或 http 链接，导致用户下载到不可信安装包。
 */
export function isTrustedApkUrl(value: string): boolean {
  if (!value) return false;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.protocol !== "https:") return false;

  // 与安卓壳的校验保持一致：只接受 chugao.art 本身，不含子域、不带端口和 userinfo。
  if (url.port || url.username || url.password) return false;
  return url.hostname.toLowerCase() === "chugao.art";
}

export function normalizeSha256(value: string): string | null {
  const raw = value.trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(raw) ? raw : null;
}

function normalizePublishedAt(value: string): string | null {
  if (!value) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return new Date(time).toISOString();
}

export function readAndroidAppVersion(
  env: EnvSource = process.env,
): AndroidAppVersion {
  const latestVersionCode = readPositiveInt(
    env,
    "APP_ANDROID_LATEST_VERSION_CODE",
  );
  const apkUrlRaw = readTrimmed(env, "APP_ANDROID_APK_URL");
  const apkUrl = isTrustedApkUrl(apkUrlRaw) ? apkUrlRaw : null;

  // 没有版本号或没有可信下载地址，都视为“尚未发布”。
  if (!latestVersionCode || !apkUrl) {
    return { ...UNCONFIGURED_VERSION };
  }

  const configuredMin = readPositiveInt(env, "APP_ANDROID_MIN_VERSION_CODE");
  const minSupportedVersionCode = Math.min(
    configuredMin ?? 1,
    latestVersionCode,
  );

  const notes = readTrimmed(env, "APP_ANDROID_NOTES");
  const publishedAt = normalizePublishedAt(
    readTrimmed(env, "APP_ANDROID_PUBLISHED_AT"),
  );

  return {
    latestVersionCode,
    latestVersionName: readTrimmed(env, "APP_ANDROID_LATEST_VERSION_NAME"),
    minSupportedVersionCode,
    apkUrl,
    sha256: normalizeSha256(readTrimmed(env, "APP_ANDROID_APK_SHA256")),
    notes: notes ? notes.slice(0, 2_000) : null,
    publishedAt,
  };
}
