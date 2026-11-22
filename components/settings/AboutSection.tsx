"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Download, RefreshCw, Smartphone } from "lucide-react";

import { LegalLinks } from "@/components/legal/LegalLinks";
import { Button } from "@/components/ui";
import { useIsNativeApp } from "@/lib/app-client";
import { callNative } from "@/lib/native-bridge-lite";

type UpdateState = "idle" | "checking" | "latest" | "available" | "error";

const UPDATE_TEXT: Record<Exclude<UpdateState, "idle" | "checking">, string> = {
  latest: "已是最新版本",
  available: "发现新版本，请按系统弹窗提示安装",
  error: "检查失败，请稍后再试",
};

function readVersionName(result: unknown): string | null {
  if (typeof result === "string") return result.trim() || null;
  if (!result || typeof result !== "object") return null;

  const record = result as {
    versionName?: unknown;
    version?: unknown;
    name?: unknown;
  };

  for (const value of [record.versionName, record.version, record.name]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  return null;
}

function readUpdateStatus(result: unknown): UpdateState {
  if (!result || typeof result !== "object") return "error";
  const status = (result as { status?: unknown }).status;

  if (status === "latest") return "latest";
  if (status === "available") return "available";
  return "error";
}

/**
 * 设置 · 关于：协议入口；APP 里额外显示版本号与“检查更新”。
 * 原生桥只在壳内存在，网页端不渲染这部分，也不发起调用。
 */
export function AboutSection(): React.ReactElement {
  const isNativeApp = useIsNativeApp();
  const [version, setVersion] = useState<string | null>(null);
  const [updateState, setUpdateState] = useState<UpdateState>("idle");

  useEffect(() => {
    if (!isNativeApp) return;

    let cancelled = false;

    void callNative("app.info", {}, 5_000).then((outcome) => {
      if (cancelled) return;
      const name = outcome.ok ? readVersionName(outcome.result) : null;
      setVersion(name ?? "未知");
    });

    return () => {
      cancelled = true;
    };
  }, [isNativeApp]);

  async function checkUpdate() {
    if (updateState === "checking") return;
    setUpdateState("checking");

    const outcome = await callNative("app.checkUpdate", { manual: true });
    if (!outcome.ok) {
      setUpdateState("error");
      return;
    }

    setUpdateState(readUpdateStatus(outcome.result));
  }

  return (
    <section className="surface-panel p-6">
      <p className="eyebrow">关于</p>
      <h2 className="mt-2 text-xl font-semibold">关于初稿</h2>
      <p className="mt-3 text-sm leading-6 text-text-muted">
        初稿 Chūgǎo Studio 是为设计学生打造的 AI 图像工作台。
      </p>

      <div className="mt-5 space-y-2 text-sm">
        <p className="flex flex-wrap items-center gap-1.5">
          <span className="text-text-muted">条款：</span>
          <LegalLinks separator=" · " />
        </p>
        {isNativeApp ? (
          <p className="flex flex-wrap items-center gap-1.5">
            <span className="text-text-muted">APP 版本：</span>
            <span className="font-mono">{version ?? "读取中…"}</span>
          </p>
        ) : null}
      </div>

      {isNativeApp ? (
        <div className="mt-5 border-t border-border pt-5">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="secondary"
              className="h-10"
              loading={updateState === "checking"}
              onClick={() => void checkUpdate()}
            >
              {updateState === "checking" ? (
                <RefreshCw className="h-4 w-4 animate-spin stroke-[1.5]" />
              ) : (
                <Download className="h-4 w-4 stroke-[1.5]" />
              )}
              检查更新
            </Button>
            <span
              role="status"
              className={`text-sm ${
                updateState === "error" ? "text-danger" : "text-text-muted"
              }`}
            >
              {updateState === "idle" || updateState === "checking"
                ? ""
                : UPDATE_TEXT[updateState]}
            </span>
          </div>
        </div>
      ) : (
        <p className="mt-5 flex items-center gap-1.5 border-t border-border pt-5 text-xs text-text-faint">
          <Smartphone aria-hidden="true" size={14} strokeWidth={1.6} />
          安卓客户端可在
          <Link
            href="/download"
            className="text-text-muted underline-offset-4 hover:text-foreground hover:underline"
          >
            下载页
          </Link>
          安装，版本更新由 APP 内提示。
        </p>
      )}
    </section>
  );
}
