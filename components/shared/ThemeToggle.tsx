"use client";

import { MoonStar, SunMedium } from "lucide-react";
import { useTheme } from "next-themes";

import { cn } from "@/lib/utils";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme !== "light";
  const nextTheme = isDark ? "light" : "dark";

  return (
    <button
      type="button"
      aria-label={isDark ? "切换到浅色主题" : "切换到深色主题"}
      aria-pressed={!isDark}
      title={isDark ? "切换到浅色主题" : "切换到深色主题"}
      className={cn(
        "tool-button h-9 w-9 px-0 text-text-muted transition-all duration-200",
        "shadow-[inset_0_1px_0_rgb(var(--bg)/0.18)]",
        !isDark &&
          "border-border-strong bg-surface text-foreground shadow-[0_10px_30px_rgb(var(--text)/0.08),inset_0_0_0_1px_rgb(var(--text)/0.04)]",
      )}
      onClick={() => setTheme(nextTheme)}
    >
      <SunMedium
        className={cn(
          "h-4 w-4 stroke-[1.5] transition-transform duration-200",
          isDark ? "block" : "hidden",
        )}
      />
      <MoonStar
        className={cn(
          "h-4 w-4 stroke-[1.5] transition-transform duration-200",
          !isDark ? "block" : "hidden",
        )}
      />
    </button>
  );
}
