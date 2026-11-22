import { useEffect, useState } from "react";

/**
 * 安卓原生壳（WebView）识别 —— 对外入口。
 *
 * 壳会在 WebView 的 User-Agent 末尾追加 ` ChugaoApp/1.0.0 (Android; 1)`。
 * 纯函数部分放在 `lib/app-ua.ts`（不依赖 React），方便 middleware 与 RSC 复用；
 * 这里统一 re-export，页面只认 `@/lib/app-client`。
 *
 * ⚠️ 安全边界：User-Agent 只用于 **界面分支**（隐藏电脑端功能、显示 APP 文案、
 * 调用原生桥），**绝不用于鉴权或授权判断**。任何人都可以伪造 UA，所有权限、
 * 计费与内容访问都必须继续依赖服务端会话（cookie + device session）。
 */
export {
  APP_UA_RE,
  DESKTOP_ONLY_PATHS,
  appVersionFromUserAgent,
  isAppRequestHeaders,
  isAppUserAgent,
  isDesktopOnlyPath,
} from "@/lib/app-ua";

import { APP_UA_RE } from "@/lib/app-ua";

/**
 * 客户端 hook：是否运行在原生壳里。
 *
 * SSR / 首屏 hydration 时固定返回 false，挂载后再根据 UA 或原生桥校正，
 * 避免服务端与客户端渲染结果不一致。也兼容只注入了 `window.ChugaoNative`
 * 而没有改 UA 的旧壳。
 */
export function useIsNativeApp(): boolean {
  const [isNativeApp, setIsNativeApp] = useState(false);

  useEffect(() => {
    const detected =
      typeof window !== "undefined" &&
      (APP_UA_RE.test(navigator.userAgent) || "ChugaoNative" in window);
    setIsNativeApp(detected);
  }, []);

  return isNativeApp;
}
