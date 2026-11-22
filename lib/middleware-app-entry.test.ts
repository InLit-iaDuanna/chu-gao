import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { middleware } from "@/middleware";

const APP_UA =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36 ChugaoApp/1.0.0 (Android; 1)";
const WEB_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("native app entry redirect", () => {
  it("sends the app shell from / to /app", () => {
    const response = middleware(
      new NextRequest("https://chugao.art/", {
        headers: { "user-agent": APP_UA },
      }),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://chugao.art/app");
  });

  it("keeps the query string when redirecting", () => {
    const response = middleware(
      new NextRequest("https://chugao.art/?from=app", {
        headers: { "user-agent": APP_UA },
      }),
    );

    expect(response.headers.get("location")).toBe(
      "https://chugao.art/app?from=app",
    );
  });

  it("leaves a normal browser on the marketing home page", () => {
    const response = middleware(
      new NextRequest("https://chugao.art/", {
        headers: { "user-agent": WEB_UA },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("only redirects the root path", () => {
    for (const path of ["/login", "/register", "/inspiration", "/download"]) {
      const response = middleware(
        new NextRequest(`https://chugao.art${path}`, {
          headers: { "user-agent": APP_UA },
        }),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("location")).toBeNull();
    }
  });
});
