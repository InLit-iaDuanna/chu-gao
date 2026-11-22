"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Globe2 } from "lucide-react";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui";
import { getMe } from "@/components/studio/lib/api";

/**
 * 关闭后本次会话不再打扰，下次进入工作台会再提示一次。
 * （v1 只做提示，不阻断浏览，也不在生成前强制拦截。）
 */
const DISMISS_KEY = "chugao.cross-border-consent.dismissed";

/**
 * 境外模型服务商处理提示词/图片的补签弹窗。
 *
 * 历史用户没有 `crossBorderConsentAt`，登录后在工作台补一次同意；
 * 同一会话内点“暂不同意”后不再弹出，下次进入（或刷新会话）再提示。
 */
export function CrossBorderConsentDialog(): React.ReactElement | null {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    try {
      if (sessionStorage.getItem(DISMISS_KEY) === "1") return;
    } catch {
      // sessionStorage 不可用时每次都提示，属于可接受降级。
    }

    getMe()
      .then((me) => {
        if (!cancelled && me.crossBorderConsentAt === null) setOpen(true);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  function dismiss() {
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // 忽略存储失败。
    }
    setOpen(false);
  }

  async function accept() {
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/me/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ crossBorder: true }),
      });
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        error?: { message?: string };
      } | null;

      if (!response.ok || !payload?.ok) {
        setError(payload?.error?.message ?? "记录同意失败，请稍后再试");
        return;
      }

      try {
        sessionStorage.setItem(DISMISS_KEY, "1");
      } catch {
        // 忽略存储失败。
      }
      setOpen(false);
    } catch {
      setError("网络错误，请稍后再试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) dismiss();
      }}
    >
      <DialogContent aria-describedby={undefined} className="max-w-[440px]">
        <div className="p-5 pb-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-2 text-text-muted">
            <Globe2 aria-hidden="true" size={18} strokeWidth={1.7} />
          </span>
          <DialogTitle className="mt-4 text-base font-semibold">
            关于境外模型处理
          </DialogTitle>
          <DialogDescription className="mt-2 text-sm leading-6 text-text-muted">
            为了保证出图效果，你需要允许我们把提示词、对话上下文和上传的参考图片
            发送给境外 AI 模型服务商（例如 Google Gemini、Anthropic、OpenAI）
            处理。我们不会发送邮箱、密码等账号信息。
          </DialogDescription>

          <ul className="mt-4 space-y-1.5 text-sm leading-6 text-text-muted">
            <li>· 仅用于生成你请求的内容</li>
            <li>· 你可以随时停止使用境外模型</li>
            <li>
              · 详情见{" "}
              <Link
                href="/legal/privacy"
                target="_blank"
                rel="noreferrer"
                className="text-foreground underline underline-offset-4"
              >
                《隐私政策》
              </Link>{" "}
              第三节
            </li>
          </ul>

          {error ? (
            <p role="alert" className="mt-3 text-sm text-danger">
              {error}
            </p>
          ) : null}

          <div className="mt-5 flex flex-col gap-2">
            <Button
              type="button"
              variant="primary"
              className="w-full"
              loading={busy}
              onClick={() => void accept()}
            >
              {busy ? "记录中…" : "同意并继续"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              disabled={busy}
              onClick={dismiss}
            >
              暂不同意
            </Button>
          </div>

          <p className="mt-3 text-center text-xs leading-5 text-text-faint">
            不同意也可以继续浏览，下次进入工作台会再次提示。
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
