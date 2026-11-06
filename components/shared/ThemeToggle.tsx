"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Segmented } from "@/components/ui";

type ThemeValue = "light" | "dark";

export function ThemeToggle(): React.ReactElement {
  const { theme, setTheme } = useTheme();
  // The provider runs with enableSystem={false}, so only light/dark are real.
  const value: ThemeValue = theme === "light" ? "light" : "dark";

  return (
    <Segmented
      aria-label="主题"
      value={value}
      options={[
        {
          value: "light",
          ariaLabel: "浅色",
          label: <Sun className="h-3.5 w-3.5" strokeWidth={1.6} aria-hidden />,
        },
        {
          value: "dark",
          ariaLabel: "深色",
          label: <Moon className="h-3.5 w-3.5" strokeWidth={1.6} aria-hidden />,
        },
      ]}
      onChange={setTheme}
    />
  );
}
