import { describe, expect, it } from "vitest";

import {
  UNCONFIGURED_VERSION,
  isTrustedApkUrl,
  normalizeSha256,
  readAndroidAppVersion,
} from "./app-version";

const SHA = "a".repeat(64);

function configuredEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    APP_ANDROID_LATEST_VERSION_CODE: "7",
    APP_ANDROID_LATEST_VERSION_NAME: "1.2.3",
    APP_ANDROID_MIN_VERSION_CODE: "3",
    APP_ANDROID_APK_URL: "https://chugao.art/downloads/chugao-1.2.3.apk",
    APP_ANDROID_APK_SHA256: SHA,
    APP_ANDROID_NOTES: "修复若干问题",
    APP_ANDROID_PUBLISHED_AT: "2026-11-20T10:00:00.000Z",
    ...overrides,
  };
}

describe("readAndroidAppVersion", () => {
  it("returns the unconfigured shape for an empty environment", () => {
    expect(readAndroidAppVersion({})).toEqual(UNCONFIGURED_VERSION);
    expect(UNCONFIGURED_VERSION).toMatchObject({
      latestVersionCode: 0,
      apkUrl: null,
    });
  });

  it("parses a fully configured release", () => {
    expect(readAndroidAppVersion(configuredEnv())).toEqual({
      latestVersionCode: 7,
      latestVersionName: "1.2.3",
      minSupportedVersionCode: 3,
      apkUrl: "https://chugao.art/downloads/chugao-1.2.3.apk",
      sha256: SHA,
      notes: "修复若干问题",
      publishedAt: "2026-11-20T10:00:00.000Z",
    });
  });

  it("defaults the minimum version to 1 and never exceeds the latest code", () => {
    expect(
      readAndroidAppVersion(
        configuredEnv({ APP_ANDROID_MIN_VERSION_CODE: undefined }),
      ).minSupportedVersionCode,
    ).toBe(1);

    expect(
      readAndroidAppVersion(
        configuredEnv({ APP_ANDROID_MIN_VERSION_CODE: "99" }),
      ).minSupportedVersionCode,
    ).toBe(7);

    expect(
      readAndroidAppVersion(
        configuredEnv({ APP_ANDROID_MIN_VERSION_CODE: "not-a-number" }),
      ).minSupportedVersionCode,
    ).toBe(1);
  });

  it("treats a missing or untrusted apk url as unpublished", () => {
    for (const apkUrl of [
      undefined,
      "",
      "http://chugao.art/downloads/app.apk",
      "https://example.com/downloads/app.apk",
      "https://chugao.art.evil.com/app.apk",
      "not-a-url",
    ]) {
      expect(
        readAndroidAppVersion(configuredEnv({ APP_ANDROID_APK_URL: apkUrl })),
      ).toMatchObject({ latestVersionCode: 0, apkUrl: null });
    }
  });

  it("rejects chugao.art subdomains because the Android shell only trusts chugao.art", () => {
    const version = readAndroidAppVersion(
      configuredEnv({
        APP_ANDROID_APK_URL: "https://cdn.chugao.art/app/chugao.apk",
      }),
    );

    expect(version.apkUrl).toBeNull();
  });

  it("treats a missing or invalid version code as unpublished", () => {
    for (const code of [undefined, "0", "-2", "abc"]) {
      expect(
        readAndroidAppVersion(
          configuredEnv({ APP_ANDROID_LATEST_VERSION_CODE: code }),
        ).latestVersionCode,
      ).toBe(0);
    }
  });

  it("drops an invalid sha256 and timestamp without hiding the release", () => {
    const version = readAndroidAppVersion(
      configuredEnv({
        APP_ANDROID_APK_SHA256: "xyz",
        APP_ANDROID_PUBLISHED_AT: "not-a-date",
        APP_ANDROID_NOTES: "   ",
      }),
    );

    expect(version).toMatchObject({
      latestVersionCode: 7,
      sha256: null,
      publishedAt: null,
      notes: null,
    });
  });
});

describe("apk url and digest guards", () => {
  it("only trusts https chugao.art urls", () => {
    expect(isTrustedApkUrl("https://chugao.art/app.apk")).toBe(true);
    expect(isTrustedApkUrl("https://files.chugao.art/app.apk")).toBe(false);
    expect(isTrustedApkUrl("https://chugao.art:8443/app.apk")).toBe(false);
    expect(isTrustedApkUrl("https://a@chugao.art/app.apk")).toBe(false);
    expect(isTrustedApkUrl("https://evilchugao.art/app.apk")).toBe(false);
    expect(isTrustedApkUrl("http://chugao.art/app.apk")).toBe(false);
  });

  it("normalises sha256 hex", () => {
    expect(normalizeSha256(SHA.toUpperCase())).toBe(SHA);
    expect(normalizeSha256("abc")).toBeNull();
    expect(normalizeSha256(`${SHA}00`)).toBeNull();
  });
});
