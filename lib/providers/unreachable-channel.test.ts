import { describe, expect, it } from "vitest";

import { isInterruptedNetworkError, isUnreachableNetworkError } from "@/lib/http";
import { classifyProviderFailure } from "@/lib/providers/diagnostics";
import { isDowngradable, shouldRecordProviderPoolError } from "@/lib/providers/failure-policy";

const connectTimeout = () =>
  Object.assign(new TypeError("fetch failed"), {
    cause: Object.assign(new Error("Connect Timeout Error"), {
      code: "UND_ERR_CONNECT_TIMEOUT",
    }),
  });

const dnsFailure = () =>
  Object.assign(new TypeError("fetch failed"), {
    cause: Object.assign(new Error("getaddrinfo ENOTFOUND ai.example"), {
      code: "ENOTFOUND",
    }),
  });

const terminated = () =>
  Object.assign(new TypeError("terminated"), {
    cause: Object.assign(new Error("other side closed"), {
      code: "UND_ERR_SOCKET",
    }),
  });

describe("unreachable channel handling", () => {
  it("recognises connection-level failures through the cause chain", () => {
    expect(isUnreachableNetworkError(connectTimeout())).toBe(true);
    expect(isUnreachableNetworkError(dnsFailure())).toBe(true);
    expect(isUnreachableNetworkError(new Error("fetch failed"))).toBe(false);
    expect(isUnreachableNetworkError(new Error("boom"))).toBe(false);
    expect(isInterruptedNetworkError(terminated())).toBe(true);
    expect(isInterruptedNetworkError(connectTimeout())).toBe(false);
  });

  it("treats an unreachable channel as transient so the pool fails over", () => {
    for (const error of [connectTimeout(), dnsFailure(), terminated()]) {
      expect(classifyProviderFailure(error).category).toBe("TRANSIENT_PROVIDER");
      expect(isDowngradable(error)).toBe(true);
      expect(shouldRecordProviderPoolError(error)).toBe(true);
    }
  });
});
