import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { middleware } from "@/middleware";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("canonical authentication origin", () => {
  it("redirects authentication pages from a sibling subdomain", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_CANONICAL_HOST", "chugao.art");

    const response = middleware(
      new NextRequest("https://iwish.chugao.art/login?next=%2Fapp"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://chugao.art/login?next=%2Fapp",
    );
  });

  it("keeps public sibling-subdomain pages on their original host", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_CANONICAL_HOST", "chugao.art");

    const response = middleware(new NextRequest("https://iwish.chugao.art/"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("trusts the forwarded public host when Next.js uses an internal URL", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_CANONICAL_HOST", "chugao.art");

    const response = middleware(
      new NextRequest("http://0.0.0.0:3000/login", {
        headers: {
          host: "chugao.art",
          "x-forwarded-host": "chugao.art",
          "x-forwarded-proto": "https",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });
});
