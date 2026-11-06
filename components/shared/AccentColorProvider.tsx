"use client";

import { useEffect, type ReactNode } from "react";

import { restoreAccent } from "@/lib/accent-color";

/** 挂载后从 localStorage 恢复用户自定义强调色。 */
export function AccentColorProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    restoreAccent();
  }, []);

  return <>{children}</>;
}
