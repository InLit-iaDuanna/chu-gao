import { afterEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

import type { SessionUser } from "@/lib/auth";
import {
  attachDeviceIdCookie,
  attachSessionCookie,
  createSessionToken,
  parseSessionToken,
  readSessionToken,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
} from "@/lib/session-cookie";

const user: SessionUser = {
  id: "user_123",
  email: "student@example.com",
  role: "USER",
  status: "ACTIVE",
  sessionVersion: 7,
};

const deviceSession = {
  deviceType: "WEB" as const,
  deviceId: "1A2b3C4d5E6f7G8h9I0j_k-lMnOpQrStUvWxYz12345",
  version: 4,
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("device-bound session cookie", () => {
  it("round-trips the global and device-slot versions", () => {
    const payload = parseSessionToken(createSessionToken(user, deviceSession));

    expect(payload).toMatchObject({
      sub: user.id,
      email: user.email,
      ver: 7,
      dvc: "WEB",
      did: deviceSession.deviceId,
      dsv: 4,
    });
  });

  it("rejects a tampered token", () => {
    const token = createSessionToken(user, deviceSession);
    const last = token.at(-1);
    const tampered = `${token.slice(0, -1)}${last === "A" ? "B" : "A"}`;

    expect(parseSessionToken(tampered)).toBeNull();
  });

  it("selects the valid token when legacy and domain cookies coexist", () => {
    const token = createSessionToken(user, deviceSession);
    const requestHeaders = new Headers({
      cookie: `${SESSION_COOKIE_NAME}=legacy-cookie; ${SESSION_COOKIE_NAME}=${token}`,
    });

    expect(readSessionToken(requestHeaders)).toBe(token);
  });

  it("rejects an expired token", () => {
    const issuedAt = new Date("2026-08-04T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(issuedAt);
    const token = createSessionToken(user, deviceSession);

    vi.setSystemTime(
      new Date(issuedAt.getTime() + (SESSION_TTL_SECONDS + 1) * 1000),
    );
    expect(parseSessionToken(token)).toBeNull();
  });

  it("keeps both shared cookies and the legacy host-only clear header", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SESSION_SECRET", "12345678901234567890123456789012");
    const response = attachSessionCookie(
      attachDeviceIdCookie(
        NextResponse.json({ ok: true }),
        deviceSession.deviceId,
      ),
      user,
      deviceSession,
    );
    const setCookie = response.headers.get("set-cookie") ?? "";

    expect(setCookie).toContain("chugao_device_id=");
    expect(setCookie).toContain("chugao_session=");
    expect(setCookie).toContain("Domain=.chugao.art");
    expect(setCookie).toContain(
      "chugao_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure",
    );
    expect(setCookie.indexOf("chugao_device_id=")).toBeLessThan(
      setCookie.indexOf("chugao_session="),
    );
  });

  it.each(["127.0.0.1", "localhost", "::1"])(
    "does not erase a fresh loopback production session (%s)",
    (domain) => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("SESSION_SECRET", "12345678901234567890123456789012");
      vi.stubEnv("SESSION_COOKIE_DOMAIN", domain);
      const response = attachSessionCookie(
        attachDeviceIdCookie(
          NextResponse.json({ ok: true }),
          deviceSession.deviceId,
        ),
        user,
        deviceSession,
      );
      const headers = response.headers.getSetCookie();
      expect(
        headers.filter((header) => header.startsWith("chugao_session=")),
      ).toHaveLength(1);
      expect(
        headers.every((header) => !header.toLowerCase().includes("domain=")),
      ).toBe(true);
      expect(headers.every((header) => header.includes("Secure"))).toBe(true);
      expect(headers.some((header) => header.includes("Max-Age=0"))).toBe(
        false,
      );
    },
  );
});
