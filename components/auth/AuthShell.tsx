import { Logo } from "@/components/shared/Logo";

interface AuthShellProps {
  eyebrow: string;
  headline: React.ReactNode;
  asideNote: string;
  children: React.ReactNode;
}

/** 认证页共享骨架：左侧品牌面板（细线网格 + 生成墙缩影），右侧表单。 */
export function AuthShell({
  eyebrow,
  headline,
  asideNote,
  children,
}: AuthShellProps): React.ReactElement {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden overflow-hidden border-r border-border bg-background lg:block">
        {/* 细线网格背景：1px 线条，零性能开销 */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(rgb(var(--border) / 0.45) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--border) / 0.45) 1px, transparent 1px)",
            backgroundSize: "56px 56px",
          }}
        />
        <div className="relative z-10 flex h-full flex-col justify-between p-12">
          <Logo />
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-text-faint">
              {eyebrow}
            </p>
            <h1 className="mt-4 text-[clamp(2.4rem,4vw,3.6rem)] font-semibold leading-[1.06] tracking-[-0.03em]">
              {headline}
            </h1>
            <p className="mt-5 max-w-[400px] text-sm leading-relaxed text-text-muted">
              {asideNote}
            </p>
          </div>
          <div className="flex items-end justify-between gap-6">
            {/* 生成墙缩影 */}
            <div aria-hidden className="flex items-end gap-2">
              {[56, 80, 64, 96, 48].map((h, i) => (
                <div
                  key={i}
                  className="w-10 rounded-[4px] border border-border"
                  style={{
                    height: `${h}px`,
                    background:
                      i === 3
                        ? "rgb(var(--brand-primary) / 0.18)"
                        : "rgb(var(--surface-2))",
                  }}
                />
              ))}
            </div>
            <p className="font-mono text-[11px] text-text-faint">
              © 2026 Chūgǎo Studio
            </p>
          </div>
        </div>
      </aside>

      <main className="flex items-center justify-center bg-surface/30 p-6 lg:p-12">
        <div className="w-full max-w-[360px]">{children}</div>
      </main>
    </div>
  );
}
