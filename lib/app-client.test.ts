import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  APP_UA_RE,
  appVersionFromUserAgent,
  isAppRequestHeaders,
  isAppUserAgent,
  isDesktopOnlyPath,
  useIsNativeApp,
} from "./app-client";

const ANDROID_APP_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.6723.58 Mobile Safari/537.36 ChugaoApp/1.0.0 (Android; 1)";

const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as { ChugaoNative?: unknown }).ChugaoNative;
});

describe("app user agent detection", () => {
  it("matches the native shell marker at the end of the UA", () => {
    expect(APP_UA_RE.test(ANDROID_APP_UA)).toBe(true);
    expect(isAppUserAgent(ANDROID_APP_UA)).toBe(true);
    expect(appVersionFromUserAgent(ANDROID_APP_UA)).toBe("1.0.0");
  });

  it("ignores browsers and malformed versions", () => {
    expect(isAppUserAgent(DESKTOP_UA)).toBe(false);
    expect(isAppUserAgent("")).toBe(false);
    expect(isAppUserAgent(null)).toBe(false);
    expect(isAppUserAgent(undefined)).toBe(false);
    expect(appVersionFromUserAgent(DESKTOP_UA)).toBeNull();
    expect(appVersionFromUserAgent("ChugaoApp/1.0")).toBeNull();
    expect(appVersionFromUserAgent("ChugaoApp/1.0.0 (Android; 1)")).toBe(
      "1.0.0",
    );
  });

  it("keeps the regex stateless so repeated calls stay stable", () => {
    expect(APP_UA_RE.global).toBe(false);
    expect(isAppUserAgent(ANDROID_APP_UA)).toBe(true);
    expect(isAppUserAgent(ANDROID_APP_UA)).toBe(true);
    expect(appVersionFromUserAgent("x ChugaoApp/2.13.4 (Android; 1)")).toBe(
      "2.13.4",
    );
  });

  it("reads the marker from server request headers", () => {
    expect(
      isAppRequestHeaders(new Headers({ "user-agent": ANDROID_APP_UA })),
    ).toBe(true);
    expect(isAppRequestHeaders(new Headers({ "user-agent": DESKTOP_UA }))).toBe(
      false,
    );
    expect(isAppRequestHeaders(new Headers())).toBe(false);
    expect(isAppRequestHeaders(null)).toBe(false);
  });

  it("flags the desktop-only routes", () => {
    expect(isDesktopOnlyPath("/app/canvas")).toBe(true);
    expect(isDesktopOnlyPath("/app/nodes/board-1")).toBe(true);
    expect(isDesktopOnlyPath("/app/ppt")).toBe(true);
    expect(isDesktopOnlyPath("/app/pptx")).toBe(false);
    expect(isDesktopOnlyPath("/app")).toBe(false);
  });
});

describe("useIsNativeApp", () => {
  it("stays false in a normal browser", () => {
    const { result } = renderHook(() => useIsNativeApp());
    expect(result.current).toBe(false);
  });

  it("turns true after mounting inside the shell UA", () => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
      ANDROID_APP_UA,
    );

    const { result } = renderHook(() => useIsNativeApp());
    expect(result.current).toBe(true);
  });

  it("also turns true when the native bridge is injected", () => {
    (window as { ChugaoNative?: unknown }).ChugaoNative = {
      postMessage: () => undefined,
    };

    const { result } = renderHook(() => useIsNativeApp());
    expect(result.current).toBe(true);
  });
});
