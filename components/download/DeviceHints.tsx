"use client";

import { useEffect, useState } from "react";
import { Copy, EllipsisVertical, Smartphone } from "lucide-react";

import { Button } from "@/components/ui";

function readUserAgent(): string {
  return typeof navigator === "undefined" ? "" : navigator.userAgent;
}

/**
 * 微信 / QQ 内置浏览器无法直接下载 APK：显示全屏遮罩，引导用户
 * “点击右上角 ··· 选择在浏览器打开”。用户确认后可以暂时关闭。
 */
export function InAppBrowserOverlay(): React.ReactElement | null {
  const [inAppBrowser, setInAppBrowser] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const ua = readUserAgent();
    setInAppBrowser(/MicroMessenger/i.test(ua) || /QQ\//i.test(ua));
  }, []);

  if (!inAppBrowser || dismissed) return null;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="in-app-browser-title"
      className="fixed inset-0 z-[70] flex flex-col items-center bg-background px-6 pb-[calc(env(safe-area-inset-bottom)+24px)] pt-[calc(env(safe-area-inset-top)+24px)] text-foreground"
    >
      <div className="flex w-full items-start justify-end">
        <span className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-text-muted">
          点击右上角
          <EllipsisVertical aria-hidden="true" size={14} />
        </span>
      </div>

      <div className="mt-16 flex w-full max-w-[360px] flex-col items-center text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-2 text-text-muted">
          <Smartphone aria-hidden="true" size={24} strokeWidth={1.6} />
        </span>
        <h1
          id="in-app-browser-title"
          className="mt-6 text-[22px] font-semibold leading-8 tracking-[-0.02em]"
        >
          请在浏览器中打开
        </h1>
        <p className="mt-3 text-sm leading-7 text-text-muted">
          微信 / QQ 内置浏览器无法安装安卓安装包。
          <br />
          点击右上角 ··· 菜单，选择「在浏览器打开」，再下载 APK。
        </p>

        <Button
          type="button"
          variant="secondary"
          className="mt-8 w-full"
          onClick={() => void copyLink()}
        >
          <Copy aria-hidden="true" size={15} strokeWidth={1.7} />
          {copied ? "链接已复制" : "复制本页链接"}
        </Button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="mt-4 text-xs text-text-faint underline-offset-4 hover:text-text-muted hover:underline"
        >
          我知道了，继续浏览网页
        </button>
      </div>
    </div>
  );
}

/** iOS 暂未发布客户端：给出说明，避免用户反复找安装包。 */
export function IosNotice(): React.ReactElement | null {
  const [isIos, setIsIos] = useState(false);

  useEffect(() => {
    const ua = readUserAgent();
    const ios = /iPad|iPhone|iPod/i.test(ua);
    const iPadDesktopUa = /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
    setIsIos(ios || iPadDesktopUa);
  }, []);

  if (!isIos) return null;

  return (
    <p
      role="note"
      className="rounded-lg border border-warning/40 bg-warning/10 px-3.5 py-3 text-sm leading-6 text-text-muted"
    >
      当前暂仅支持安卓。你也可以继续用手机浏览器打开 chugao.art 使用网页版。
    </p>
  );
}
