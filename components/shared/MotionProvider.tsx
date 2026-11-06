"use client";

import { MotionConfig } from "framer-motion";
import type { ReactNode } from "react";

// 只有工作台路由组仍在使用 framer-motion（舞台、抽屉、浮层）。
// MotionConfig 放在 (app) 布局而不是根布局，避免 framer 进入
// 落地页 / 认证 / 管理端的首载 bundle。
// reducedMotion="user" 让所有 framer 动画尊重系统「减少动态效果」设置
// （全局 CSS 的 prefers-reduced-motion 规则管不到 JS 驱动的内联样式动画）。
export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
