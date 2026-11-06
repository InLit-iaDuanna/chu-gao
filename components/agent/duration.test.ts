import { describe, expect, it } from "vitest";

import { parseDurationHours, type DurationUnit } from "./duration";

describe("Agent authorization duration", () => {
  it.each<[string, DurationUnit, number]>([
    ["1", "hours", 1],
    ["720", "hours", 720],
    ["1", "days", 24],
    ["7", "days", 168],
    ["30", "days", 720],
  ])("converts %s %s to whole hours", (value, unit, hours) => {
    expect(parseDurationHours(value, unit)).toBe(hours);
  });

  it.each<[string, DurationUnit]>([
    ["", "hours"],
    [" ", "days"],
    ["0", "hours"],
    ["-1", "days"],
    ["721", "hours"],
    ["31", "days"],
    ["1.5", "hours"],
    ["1.5", "days"],
    ["Infinity", "hours"],
    ["invalid", "days"],
  ])("rejects invalid duration %s %s", (value, unit) => {
    expect(parseDurationHours(value, unit)).toBeNull();
  });
});
