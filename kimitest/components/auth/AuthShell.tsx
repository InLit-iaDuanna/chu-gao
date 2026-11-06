import Link from "next/link";

import { Logo } from "@/components/shared/Logo";

interface AuthShellProps {
  /** 左侧编辑区大标题（衬线，支持换行与强调） */
  headline: React.ReactNode;
  subline: string;
  /** 右侧表单区标题 */
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

/**
 * 认证页外壳：左栏印务编辑区（栏线网格 + 巨型衬线 + 印章）
 * 右栏纸面表单。服务端组件，零客户端 JS 开销。
 */
export function AuthShell({
  headline,
  subline,
  title,
  subtitle,
  children,
  footer,
}: AuthShellProps): React.ReactElement {
  return (
    <div className="relative grid min-h-screen bg-background lg:grid-cols-[1.15fr_1fr]">
      {/* 左栏 · 编辑区 */}
      <aside className="press-columns relative hidden border-r border-border lg:flex lg:flex-col lg:justify-between lg:p-14">
        <Link href="/" className="w-fit transition-opacity hover:opacity-70">
          <Logo />
        </Link>
        <div className="reg-marks">
          <div className="mb-8 font-mono text-[10px] uppercase tracking-[0.24em] text-text-faint">
            First Draft Press — Members
          </div>
          <h1 className="font-serif text-[clamp(44px,4.8vw,68px)] leading-[1.04] tracking-[-0.025em] text-foreground">
            {headline}
          </h1>
          <p className="mt-6 max-w-[400px] text-[15px] leading-relaxed text-text-muted">
            {subline}
          </p>
          <span className="stamp mt-10">AI 图像工作台</span>
        </div>
        <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-text-faint">
          © Chūgǎo Studio · 2026
        </p>
      </aside>

      {/* 右栏 · 纸面表单 */}
      <main className="relative flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-[420px]">
          <Link
            href="/"
            className="mb-8 inline-block transition-opacity hover:opacity-70 lg:hidden"
          >
            <Logo />
          </Link>
          <div className="reg-marks border border-border-strong bg-surface p-8 sm:p-9">
            <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.24em] text-text-faint">
              Chūgǎo — Account
            </div>
            <h2 className="font-serif text-[30px] leading-tight tracking-[-0.02em] text-foreground">
              {title}
            </h2>
            <p className="mt-2 text-sm leading-6 text-text-muted">{subtitle}</p>
            <div className="mt-7">{children}</div>
          </div>
          {footer ? (
            <div className="mt-6 text-center text-sm text-text-muted">
              {footer}
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
