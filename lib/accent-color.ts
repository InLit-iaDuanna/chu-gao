"use client";

/**
 * 用户自定义强调色（主题色）。
 * 通过向 <html> 写入内联 CSS 变量 --brand-primary / --on-accent 生效，
 * 覆盖 styles/tokens.css 中的默认值；存于 localStorage（按设备）。
 */

export interface AccentChoice {
  id: string;
  label: string;
  /** "r g b" 三元组，直接写入 --brand-primary。 */
  primary: string;
  onAccent: string;
}

const STORAGE_KEY = "chugao.accent.v1";

const DARK_INK = "15 15 17";
const LIGHT_INK = "250 250 252";

type Rgb = readonly [number, number, number];

const DARK_INK_RGB: Rgb = [15, 15, 17];
const LIGHT_INK_RGB: Rgb = [250, 250, 252];

export const ACCENT_PRESETS: AccentChoice[] = [
  { id: "blue", label: "霁蓝", primary: "96 165 250", onAccent: DARK_INK },
  { id: "violet", label: "堇紫", primary: "167 139 250", onAccent: DARK_INK },
  { id: "emerald", label: "松绿", primary: "52 211 153", onAccent: DARK_INK },
  { id: "amber", label: "蜜蜡", primary: "251 191 36", onAccent: DARK_INK },
  { id: "rose", label: "茜红", primary: "251 113 133", onAccent: DARK_INK },
  { id: "cyan", label: "天青", primary: "34 211 238", onAccent: DARK_INK },
];

function hexToRgbTriplet(hex: string): string | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const value = match[1];
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `${r} ${g} ${b}`;
}

function parseRgbTriplet(primary: string): Rgb | null {
  const values = primary.trim().split(/\s+/).map(Number);
  if (
    values.length !== 3 ||
    values.some((value) => !Number.isFinite(value) || value < 0 || value > 255)
  ) {
    return null;
  }
  return [values[0], values[1], values[2]];
}

/** Convert an sRGB channel to the linear-light value used by WCAG. */
function linearizeSrgbChannel(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

/** Calculate WCAG relative luminance for an sRGB color. */
function relativeLuminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map(linearizeSrgbChannel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Calculate the WCAG contrast ratio between two sRGB colors. */
function contrastRatio(first: Rgb, second: Rgb): number {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Pick the dark or light foreground with the better WCAG contrast. */
function onAccentFor(primary: string): string {
  const accentRgb = parseRgbTriplet(primary);
  if (!accentRgb) return DARK_INK;

  const darkContrast = contrastRatio(DARK_INK_RGB, accentRgb);
  const lightContrast = contrastRatio(LIGHT_INK_RGB, accentRgb);
  return darkContrast >= lightContrast ? DARK_INK : LIGHT_INK;
}

export function accentFromHex(hex: string): AccentChoice | null {
  const primary = hexToRgbTriplet(hex);
  if (!primary) return null;
  const [r, g, b] = primary.split(" ").map(Number);
  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  return {
    id: `custom-${toHex(r)}${toHex(g)}${toHex(b)}`,
    label: "自定义",
    primary,
    onAccent: onAccentFor(primary),
  };
}

export function readAccent(): AccentChoice | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AccentChoice>;
    if (
      typeof parsed.id !== "string" ||
      typeof parsed.primary !== "string" ||
      typeof parsed.onAccent !== "string"
    ) {
      return null;
    }
    return {
      id: parsed.id,
      label: typeof parsed.label === "string" ? parsed.label : "自定义",
      primary: parsed.primary,
      onAccent: parsed.onAccent,
    };
  } catch {
    return null;
  }
}

function writeCssVariables(choice: AccentChoice | null): void {
  const root = document.documentElement;
  if (choice) {
    root.style.setProperty("--brand-primary", choice.primary);
    root.style.setProperty("--on-accent", choice.onAccent);
  } else {
    root.style.removeProperty("--brand-primary");
    root.style.removeProperty("--on-accent");
  }
}

/** 应用并持久化；传 null 恢复默认（单色）。 */
export function applyAccent(choice: AccentChoice | null): void {
  writeCssVariables(choice);
  try {
    if (choice) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(choice));
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // 存储失败仅影响持久化，本次会话仍生效。
  }
}

/** 启动时恢复保存的强调色（在根布局客户端组件中调用一次）。 */
export function restoreAccent(): void {
  const choice = readAccent();
  if (choice) writeCssVariables(choice);
}
