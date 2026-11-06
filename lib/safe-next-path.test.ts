import { describe, expect, it } from "vitest";

import { safeNextPath } from "@/lib/safe-next-path";

describe("safeNextPath", () => {
  it("keeps same-origin paths, queries, and hashes", () => {
    expect(safeNextPath("/app/history?page=2#latest")).toBe(
      "/app/history?page=2#latest",
    );
  });

  it.each([
    undefined,
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "/%5Cevil.example",
    "/%2F%2Fevil.example",
    "/%255Cevil.example",
    ["/app", "/admin"],
  ])("falls back for an unsafe redirect target: %s", (value) => {
    expect(safeNextPath(value)).toBe("/app");
  });
});
