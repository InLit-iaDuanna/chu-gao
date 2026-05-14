"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Segmented, Tooltip } from "@/components/ui";

type ThemeValue = "system" | "light" | "dark";

export function ThemeToggle(): React.ReactElement {
  const { theme, setTheme } = useTheme();
  const value: ThemeValue =
    theme === "light" || theme === "dark" || theme === "system"
      ? theme
      : "system";

  return (
    <Segmented
      aria-label="主题"
      value={value}
      options={[
        {
          value: "system",
          label: (
            <Tooltip content="跟随系统">
              <Monitor className="h-3.5 w-3.5" strokeWidth={1.6} />
            </Tooltip>
          ),
        },
        {
          value: "light",
          label: (
            <Tooltip content="浅色">
              <Sun className="h-3.5 w-3.5" strokeWidth={1.6} />
            </Tooltip>
          ),
        },
        {
          value: "dark",
          label: (
            <Tooltip content="深色">
              <Moon className="h-3.5 w-3.5" strokeWidth={1.6} />
            </Tooltip>
          ),
        },
      ]}
      onChange={setTheme}
    />
  );
}
