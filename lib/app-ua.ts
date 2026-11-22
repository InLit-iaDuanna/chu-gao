/**
 * 原生壳 UA 的纯函数识别逻辑。
 *
 * 单独成文件：middleware（Edge Runtime）与 RSC 布局都会用到它，这里刻意不引入
 * React，避免把前端运行时打进中间件包。对外统一从 `@/lib/app-client` 引用。
 *
 * ⚠️ 安全边界：User-Agent 只用于 **界面分支**（隐藏电脑端功能、显示 APP 文案、
 * 调用原生桥），**绝不用于鉴权或授权判断**。任何人都可以伪造 UA，所有权限、
 * 计费与内容访问都必须继续依赖服务端会话（cookie + device session）。
 */
export const APP_UA_RE = /\bChugaoApp\/(\d+\.\d+\.\d+)\b/;

/** APP 里需要隐藏、并在直接访问时显示占位页的电脑端专用路由。 */
export const DESKTOP_ONLY_PATHS = [
  "/app/canvas",
  "/app/nodes",
  "/app/ppt",
] as const;

export function isAppUserAgent(ua?: string | null): boolean {
  if (!ua) return false;
  return APP_UA_RE.test(ua);
}

export function appVersionFromUserAgent(ua?: string | null): string | null {
  if (!ua) return null;
  return APP_UA_RE.exec(ua)?.[1] ?? null;
}

type HeaderReader = { get(name: string): string | null | undefined };

/** 服务端（layout / middleware / route）用：只读请求头，不落库、不鉴权。 */
export function isAppRequestHeaders(
  headers: HeaderReader | null | undefined,
): boolean {
  if (!headers) return false;
  return isAppUserAgent(headers.get("user-agent"));
}

export function isDesktopOnlyPath(pathname: string): boolean {
  return DESKTOP_ONLY_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}
