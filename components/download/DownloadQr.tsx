"use client";

import { useEffect, useState } from "react";
import { toDataURL } from "qrcode";

/**
 * 当前页面地址的二维码：电脑上打开 /download 时，手机扫码直接进同一下载页。
 * 只在客户端生成（依赖 window.location），尺寸固定 240px，白底保证可扫。
 */
export function DownloadQr(): React.ReactElement {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    toDataURL(window.location.href, {
      width: 320,
      margin: 1,
      color: { dark: "#08080a", light: "#ffffff" },
    })
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex h-[152px] w-[152px] items-center justify-center overflow-hidden rounded-2xl bg-white p-2.5">
        {src ? (
          <img
            src={src}
            alt="扫码在手机上打开下载页"
            width={132}
            height={132}
            className="h-full w-full"
          />
        ) : (
          <span className="text-xs text-neutral-400">生成中…</span>
        )}
      </div>
      <p className="text-center text-xs leading-5 text-text-muted">
        在电脑上打开本页，
        <br />
        用手机扫码继续安装
      </p>
    </div>
  );
}
