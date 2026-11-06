import { describe, expect, it, vi } from "vitest";

import {
  CLIENT_DEVICE_TOUCH_POINTS_HEADER,
  CLIENT_DEVICE_TYPE_HEADER,
  detectSessionDeviceType,
  isValidDeviceId,
  withBrowserAuthLock,
} from "@/lib/session-device";

function headers(
  userAgent: string,
  hint?: "WEB" | "MOBILE" | "IPAD",
  touchPoints?: number,
) {
  return new Headers({
    "user-agent": userAgent,
    ...(hint ? { [CLIENT_DEVICE_TYPE_HEADER]: hint } : {}),
    ...(touchPoints !== undefined
      ? { [CLIENT_DEVICE_TOUCH_POINTS_HEADER]: String(touchPoints) }
      : {}),
  });
}

describe("detectSessionDeviceType", () => {
  it("classifies a desktop browser as WEB", () => {
    expect(
      detectSessionDeviceType(
        headers(
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/138 Safari/537.36",
        ),
      ),
    ).toBe("WEB");
  });

  it("classifies iPhone and Android phone browsers as MOBILE", () => {
    expect(
      detectSessionDeviceType(
        headers(
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
        ),
      ),
    ).toBe("MOBILE");
    expect(
      detectSessionDeviceType(
        headers(
          "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/138 Mobile Safari/537.36",
        ),
      ),
    ).toBe("MOBILE");
  });

  it("classifies a normal iPad User-Agent as IPAD", () => {
    expect(
      detectSessionDeviceType(
        headers(
          "Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
        ),
      ),
    ).toBe("IPAD");
  });

  it("uses the client hint for iPadOS desktop mode", () => {
    expect(
      detectSessionDeviceType(
        headers(
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.5 Safari/605.1.15",
          "IPAD",
          5,
        ),
      ),
    ).toBe("IPAD");

    expect(
      detectSessionDeviceType(
        headers(
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.5 Safari/605.1.15",
          "IPAD",
          0,
        ),
      ),
    ).toBe("WEB");
  });

  it("does not let a WEB hint hide a phone User-Agent", () => {
    expect(
      detectSessionDeviceType(
        headers(
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
          "WEB",
        ),
      ),
    ).toBe("MOBILE");
  });

  it("does not let an arbitrary desktop hint consume another slot", () => {
    const desktopUserAgent =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138 Safari/537.36";

    expect(
      detectSessionDeviceType(headers(desktopUserAgent, "MOBILE", 0)),
    ).toBe("WEB");
    expect(detectSessionDeviceType(headers(desktopUserAgent, "IPAD", 10))).toBe(
      "WEB",
    );
  });
});

describe("isValidDeviceId", () => {
  it("accepts high-entropy URL-safe identifiers", () => {
    expect(isValidDeviceId("1A2b3C4d5E6f7G8h9I0j_k-lMnOpQrStUvWxYz12345")).toBe(
      true,
    );
  });

  it("rejects missing, short, or unsafe values", () => {
    expect(isValidDeviceId(undefined)).toBe(false);
    expect(isValidDeviceId("too-short")).toBe(false);
    expect(isValidDeviceId("device id with spaces and ; separators")).toBe(
      false,
    );
  });
});

describe("withBrowserAuthLock", () => {
  it("does not retry a failed authentication request", async () => {
    const task = vi.fn().mockRejectedValue(new Error("network failed"));

    await expect(withBrowserAuthLock(task)).rejects.toThrow("network failed");
    expect(task).toHaveBeenCalledTimes(1);
  });
});
