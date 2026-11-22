import Image from "next/image";
import Link from "next/link";

import { Logo } from "@/components/shared/Logo";

interface AuthShellProps {
  eyebrow: string;
  headline: React.ReactNode;
  asideNote: string;
  /** Finished image shown on the right panel. */
  art?: string;
  /** 服务端根据 UA 判定：运行在安卓原生壳里，改用移动端全屏布局。 */
  nativeApp?: boolean;
  /** APP 模式顶部的一句话说明。 */
  appTagline?: string;
  children: React.ReactNode;
}

/**
 * 认证页共享骨架（仿 claude.ai）：左侧安静的表单列；右侧是一张完成的作品
 * 铺满面板，标语压在画面下沿。窄屏只保留表单。
 *
 * APP 模式（安卓壳）不显示营销侧栏，改成全屏移动端布局：顶部 Logo + 初稿，
 * 一句话说明，表单，底部留给页面自己的切换链接；上下留出安全区。
 */
export function AuthShell({
  eyebrow,
  headline,
  asideNote,
  art = "/studio/landscape.jpg",
  nativeApp = false,
  appTagline,
  children,
}: AuthShellProps): React.ReactElement {
  if (nativeApp) {
    return (
      <div
        data-native-app="true"
        className="flex min-h-dvh flex-col bg-background text-foreground"
      >
        <header className="flex items-center gap-2.5 px-6 pt-[calc(env(safe-area-inset-top)+20px)]">
          <Logo size="sm" />
          <span className="text-[15px] font-semibold tracking-[-0.01em]">
            初稿
          </span>
          <span className="text-xs text-text-faint">Chūgǎo Studio</span>
        </header>

        <main className="flex flex-1 flex-col justify-center px-6 pb-[calc(env(safe-area-inset-bottom)+28px)] pt-10">
          <div className="mx-auto w-full max-w-[400px]">
            {appTagline ? (
              <p className="mb-7 text-[15px] leading-7 text-text-muted">
                {appTagline}
              </p>
            ) : null}
            {children}
          </div>
        </main>

        <p className="px-6 pb-[calc(env(safe-area-inset-bottom)+16px)] text-center text-xs text-text-faint">
          © 2026 Chūgǎo Studio
        </p>
      </div>
    );
  }

  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-[1fr_1.1fr]">
      <main className="flex min-h-screen flex-col px-6 py-6 sm:px-10">
        <Link href="/" aria-label="返回首页" className="w-fit">
          <Logo />
        </Link>
        <div className="flex flex-1 items-center justify-center py-12">
          <div className="w-full max-w-[380px]">{children}</div>
        </div>
        <p className="text-center text-xs text-text-faint lg:text-left">
          © 2026 Chūgǎo Studio
        </p>
      </main>

      <aside className="sticky top-0 hidden h-screen p-3 lg:block">
        <div className="auth-art relative h-full overflow-hidden rounded-[24px] bg-surface-3">
          <Image
            src={art}
            alt=""
            fill
            priority
            sizes="55vw"
            className="object-cover object-[65%_50%]"
          />
          <div className="absolute inset-x-0 bottom-0 z-10 p-10 text-white xl:p-14">
            <p className="text-[13px] text-white/60">{eyebrow}</p>
            <h1 className="mt-4 max-w-[30rem] text-white text-[clamp(2.4rem,3.6vw,3.5rem)] font-semibold leading-[1.06] tracking-[-0.045em]">
              {headline}
            </h1>
            <p className="mt-5 max-w-[26rem] text-[15px] leading-7 text-white/70">
              {asideNote}
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}
