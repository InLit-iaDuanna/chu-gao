import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Download, ShieldCheck, Wifi } from "lucide-react";

import { CopyHash } from "@/components/download/CopyHash";
import { DownloadQr } from "@/components/download/DownloadQr";
import {
  InAppBrowserOverlay,
  IosNotice,
} from "@/components/download/DeviceHints";
import { Logo } from "@/components/shared/Logo";
import { Button } from "@/components/ui";
import { readAndroidAppVersion } from "@/lib/app-version";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "下载安卓版 · Chūgǎo Studio",
  description:
    "下载初稿 Chūgǎo Studio 安卓客户端：手机上和网页端同步的 AI 图像工作台。",
};

const STEPS = [
  {
    title: "下载 APK",
    desc: "点击本页的下载按钮，把安装包保存到手机。",
  },
  {
    title: "允许安装未知来源应用",
    desc: "首次安装时系统会提示来源未知，按提示允许浏览器安装应用即可。",
  },
  {
    title: "打开并登录",
    desc: "安装完成后打开初稿，用已有的邮箱登录，历史对话与积分和网页端一致。",
  },
] as const;

function formatPublishedAt(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export default function DownloadPage() {
  const version = readAndroidAppVersion();
  const published = Boolean(version.apkUrl);
  const versionLabel = version.latestVersionName
    ? ` v${version.latestVersionName}`
    : "";
  const publishedAt = formatPublishedAt(version.publishedAt);

  return (
    <main className="min-h-dvh overflow-x-clip bg-background text-foreground">
      <InAppBrowserOverlay />

      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-[1120px] items-center justify-between px-5 sm:px-8">
          <Link href="/" aria-label="返回首页" className="w-fit">
            <Logo />
          </Link>
          <div className="flex items-center gap-1">
            <Link
              href="/legal/privacy"
              className="hidden h-9 items-center rounded-lg px-3 text-sm text-text-muted transition-colors hover:text-foreground sm:flex"
            >
              隐私政策
            </Link>
            <Link
              href="/login"
              className="flex h-9 items-center rounded-lg px-3 text-sm text-text-muted transition-colors hover:text-foreground"
            >
              登录
            </Link>
          </div>
        </div>
      </header>

      <section className="mx-auto grid w-full max-w-[1120px] gap-12 px-5 pb-12 pt-10 sm:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-16 lg:pb-20 lg:pt-16">
        <div className="min-w-0">
          <p className="w-fit rounded-full border border-border px-3 py-1 text-xs text-text-muted">
            安卓客户端
            {published ? `${versionLabel} · 已上线` : " · 即将上线"}
          </p>

          <h1 className="mt-6 text-[clamp(2.1rem,7vw,3.5rem)] font-semibold leading-[1.06] tracking-[-0.045em]">
            把工作台
            <br />
            <span className="text-text-faint">装进口袋</span>
          </h1>

          <p className="mt-5 max-w-[32rem] text-[15px] leading-7 text-text-muted">
            初稿 Chūgǎo Studio 是为设计学生打造的 AI
            图像工作台：一句话描述需求，边聊边改；历史记录、积分与网页端同步。
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            {published && version.apkUrl ? (
              <Button
                asChild
                variant="primary"
                size="lg"
                className="w-full sm:w-auto"
              >
                <a href={version.apkUrl} download rel="noreferrer">
                  <Download aria-hidden="true" size={16} strokeWidth={1.8} />
                  下载安卓版{versionLabel}
                </a>
              </Button>
            ) : (
              <Button
                variant="primary"
                size="lg"
                className="w-full sm:w-auto"
                disabled
              >
                <Download aria-hidden="true" size={16} strokeWidth={1.8} />
                即将上线
              </Button>
            )}
            <Button
              asChild
              variant="secondary"
              size="lg"
              className="w-full sm:w-auto"
            >
              <Link href="/register">先在网页版试试</Link>
            </Button>
          </div>

          <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-faint">
            <span className="inline-flex items-center gap-1">
              <ShieldCheck aria-hidden="true" size={13} strokeWidth={1.7} />
              仅从 chugao.art 下载
            </span>
            <span className="inline-flex items-center gap-1">
              <Wifi aria-hidden="true" size={13} strokeWidth={1.7} />
              安装时需允许「未知来源应用」
            </span>
          </p>

          <div className="mt-6 max-w-[430px] space-y-4">
            <IosNotice />
            {published && version.sha256 ? (
              <CopyHash value={version.sha256} />
            ) : null}
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-[280px] sm:max-w-[300px] lg:max-w-[330px]">
          <div aria-hidden className="marketing-halo absolute -inset-10" />
          <div className="relative rounded-[38px] border border-border bg-surface p-2.5 shadow-[var(--shadow-lg)]">
            <div className="relative aspect-[9/19] overflow-hidden rounded-[30px] bg-surface-2">
              <Image
                src="/studio/landscape.jpg"
                alt="初稿安卓版界面预览"
                fill
                priority
                sizes="330px"
                className="object-cover"
              />
              <div className="absolute inset-x-0 top-0 flex items-center justify-between px-4 pt-3 text-[10px] font-medium text-white/85">
                <span>9:41</span>
                <span>5G</span>
              </div>
              <div className="absolute inset-x-3 bottom-3 rounded-2xl border border-white/15 bg-black/45 p-3 backdrop-blur">
                <p className="text-[11px] leading-5 text-white/75">
                  描述你想要的画面…
                </p>
                <div className="mt-2 flex items-center justify-between text-[10px] text-white/60">
                  <span>Chūgǎo Studio</span>
                  <span className="rounded-full bg-white/15 px-2 py-0.5 text-white/85">
                    发送
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-[1120px] gap-5 px-5 pb-16 sm:px-8 lg:grid-cols-[0.85fr_1.15fr] lg:gap-6">
        <div className="surface-panel p-6">
          <p className="eyebrow">扫码安装</p>
          <h2 className="mt-2 text-lg font-semibold">用手机打开这一页</h2>
          <p className="mt-2 text-sm leading-6 text-text-muted">
            电脑上不方便传文件时，直接扫码在手机上继续。
          </p>
          <div className="mt-6">
            <DownloadQr />
          </div>
        </div>

        <div className="surface-panel p-6">
          <p className="eyebrow">安装步骤</p>
          <h2 className="mt-2 text-lg font-semibold">三步装好初稿</h2>
          <ol className="mt-5 space-y-4">
            {STEPS.map((step, index) => (
              <li key={step.title} className="flex gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-2 font-mono text-[11px] text-text-muted">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{step.title}</p>
                  <p className="mt-1 text-sm leading-6 text-text-muted">
                    {step.desc}
                  </p>
                </div>
              </li>
            ))}
          </ol>

          {version.notes ? (
            <div className="mt-6 border-t border-border pt-5">
              <p className="text-xs text-text-muted">
                更新说明
                {publishedAt ? ` · ${publishedAt}` : ""}
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-text-muted">
                {version.notes}
              </p>
            </div>
          ) : null}
        </div>
      </section>

      <footer className="border-t border-border px-5 py-6 text-center text-xs text-text-muted">
        © 2026 Chūgǎo Studio ·{" "}
        <Link href="/legal/terms" className="hover:text-foreground">
          用户协议
        </Link>{" "}
        ·{" "}
        <Link href="/legal/privacy" className="hover:text-foreground">
          隐私政策
        </Link>
      </footer>
    </main>
  );
}
