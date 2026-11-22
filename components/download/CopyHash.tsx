"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/** 安装包 SHA-256：可复制的只读文本，方便校验下载是否完整。 */
export function CopyHash({ value }: { value: string }): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  async function copy() {
    setFailed(false);

    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setFailed(true);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface-2/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-text-muted">SHA-256</span>
        <button
          type="button"
          onClick={() => void copy()}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-text-muted transition-colors hover:bg-surface-3 hover:text-foreground"
        >
          {copied ? (
            <>
              <Check aria-hidden="true" size={13} /> 已复制
            </>
          ) : (
            <>
              <Copy aria-hidden="true" size={13} /> 复制
            </>
          )}
        </button>
      </div>
      <p className="mt-1.5 break-all font-mono text-[11px] leading-5 text-text-muted">
        {value}
      </p>
      {failed ? (
        <p className="mt-1 text-[11px] text-danger">
          复制失败，请长按上面的摘要手动复制
        </p>
      ) : null}
    </div>
  );
}
