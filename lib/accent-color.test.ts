import { describe, expect, it } from "vitest";

import { accentFromHex } from "./accent-color";

const DARK_INK = "15 15 17";
const LIGHT_INK = "250 250 252";

function linearizeSrgbChannel(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(rgb: readonly [number, number, number]): number {
  const [r, g, b] = rgb.map(linearizeSrgbChannel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(
  first: readonly [number, number, number],
  second: readonly [number, number, number],
): number {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function rgbTriplet(value: string): [number, number, number] {
  return value.split(" ").map(Number) as [number, number, number];
}

describe("accentFromHex", () => {
  it.each([
    ["red", "#ff0000", DARK_INK],
    ["yellow", "#ffff00", DARK_INK],
    ["cyan", "#00ffff", DARK_INK],
    ["near white", "#fefefe", DARK_INK],
    ["near black", "#010101", LIGHT_INK],
    ["gray", "#777777", LIGHT_INK],
  ])(
    "selects the higher-contrast foreground for %s",
    (_name, hex, expected) => {
      const choice = accentFromHex(hex);

      expect(choice).not.toBeNull();
      expect(choice?.onAccent).toBe(expected);

      const accent = rgbTriplet(choice!.primary);
      const selectedContrast = contrastRatio(
        rgbTriplet(choice!.onAccent),
        accent,
      );
      const alternative = choice!.onAccent === DARK_INK ? LIGHT_INK : DARK_INK;
      const alternativeContrast = contrastRatio(
        rgbTriplet(alternative),
        accent,
      );
      expect(selectedContrast).toBeGreaterThanOrEqual(alternativeContrast);
    },
  );

  it("preserves the existing RGB triplet and custom id format", () => {
    expect(accentFromHex("#A1b2C3")).toMatchObject({
      id: "custom-a1b2c3",
      label: "自定义",
      primary: "161 178 195",
    });
  });

  it.each(["", "#fff", "#gggggg", "rgb(255, 0, 0)"])(
    "rejects invalid hex input %s",
    (hex) => {
      expect(accentFromHex(hex)).toBeNull();
    },
  );
});
