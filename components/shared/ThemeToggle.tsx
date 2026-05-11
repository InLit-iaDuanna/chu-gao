"use client";

import { MoonStar, SunMedium } from "lucide-react";
import { useTheme } from "next-themes";

import { cn } from "@/lib/utils";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme !== "light";

  return (
    <button
      type="button"
      aria-label="切换主题"
      className="tool-button h-9 w-9 px-0 text-text-muted"
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      <SunMedium className={cn("h-4 w-4 stroke-[1.5]", isDark && "hidden")} />
      <MoonStar className={cn("h-4 w-4 stroke-[1.5]", !isDark && "hidden")} />
    </button>
  );
}
