import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  entries: new Map<string, string>(),
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
}));

vi.mock("@/lib/redis", () => ({ getRedis: () => mocks }));

import {
  isChannelCircuitOpen,
  resetChannelCircuit,
  tripChannelCircuit,
} from "@/lib/providers/channel-circuit-breaker";

describe("channel circuit isolation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.entries.clear();
    mocks.get.mockImplementation(
      async (key: string) => mocks.entries.get(key) ?? null,
    );
    mocks.set.mockImplementation(async (key: string, value: string) => {
      mocks.entries.set(key, value);
      return "OK";
    });
    mocks.del.mockImplementation(async (key: string) =>
      Number(mocks.entries.delete(key)),
    );
  });

  it("isolates different models and channels sharing a provider pool", async () => {
    await tripChannelCircuit("channel-a", undefined, "gpt-image-2.6");

    expect(await isChannelCircuitOpen("channel-a", "gpt-image-2.6")).toBe(true);
    expect(await isChannelCircuitOpen("channel-a", "gpt-image-2.6-flare")).toBe(
      false,
    );
    expect(await isChannelCircuitOpen("channel-b", "gpt-image-2.6")).toBe(
      false,
    );
  });

  it("resets only the successful model and channel", async () => {
    await tripChannelCircuit("channel-a", undefined, "gpt-image-2.6");
    await tripChannelCircuit("channel-a", undefined, "gpt-image-2.6-flare");
    await resetChannelCircuit("channel-a", "gpt-image-2.6");

    expect(await isChannelCircuitOpen("channel-a", "gpt-image-2.6")).toBe(
      false,
    );
    expect(await isChannelCircuitOpen("channel-a", "gpt-image-2.6-flare")).toBe(
      true,
    );
  });

  it.each([
    [0, 1000],
    [1500, 1500],
    [60 * 60_000, 15 * 60_000],
  ])("bounds a requested cooldown of %s ms", async (durationMs, expected) => {
    await tripChannelCircuit("channel-a", durationMs);

    expect(mocks.set).toHaveBeenCalledWith(
      expect.any(String),
      "open",
      "PX",
      expected,
    );
  });

  it("allows routing when Redis fails and tolerates failed health writes", async () => {
    mocks.get.mockRejectedValueOnce(new Error("redis unavailable"));
    mocks.set.mockRejectedValueOnce(new Error("redis unavailable"));
    mocks.del.mockRejectedValueOnce(new Error("redis unavailable"));

    expect(await isChannelCircuitOpen("channel-a", "gpt-image-2.6")).toBe(
      false,
    );
    await expect(
      tripChannelCircuit("channel-a", undefined, "gpt-image-2.6"),
    ).resolves.toBeUndefined();
    await expect(
      resetChannelCircuit("channel-a", "gpt-image-2.6"),
    ).resolves.toBeUndefined();
  });

  it("does not open a circuit for automatic channel selection", async () => {
    await tripChannelCircuit(undefined);
    await resetChannelCircuit(undefined);

    expect(await isChannelCircuitOpen(undefined)).toBe(false);
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
    expect(mocks.del).not.toHaveBeenCalled();
  });
});
