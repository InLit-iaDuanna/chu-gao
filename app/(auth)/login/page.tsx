import { LoginForm } from "@/components/auth/LoginForm";
import { Logo } from "@/components/shared/Logo";
import { checkSessionFromHeaders } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

function safeNextPath(value: string | undefined): string {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/app";
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const session = await checkSessionFromHeaders(await headers());
  const safeNext = safeNextPath(next);

  if (session.status === "authenticated") redirect(safeNext);

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.2fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-surface lg:block">
        <div aria-hidden="true" className="absolute inset-0">
          <div className="absolute inset-0 bg-[linear-gradient(to_right,rgb(var(--border)/0.4)_1px,transparent_1px),linear-gradient(to_bottom,rgb(var(--border)/0.4)_1px,transparent_1px)] bg-[size:48px_48px]" />
          <div className="absolute -left-32 top-1/3 h-[480px] w-[480px] rounded-full bg-foreground/[0.04] blur-[120px]" />
        </div>
        <div className="relative z-10 flex h-full flex-col justify-between p-12">
          <Logo />
          <div>
            <h1 className="font-serif text-[clamp(40px,5vw,60px)] leading-[1.05] tracking-[-0.02em]">
              为设计学生
              <br />
              而生的工作台
            </h1>
            <p className="mt-6 max-w-[420px] text-sm leading-relaxed text-text-muted">
              统一接入海外主流图像生成模型，专注创作，无需切换工具。
            </p>
          </div>
          <p className="text-xs text-text-faint">© 2026 Chūgǎo Studio</p>
        </div>
      </aside>

      <main className="flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-[400px]">
          <Logo className="mb-8 lg:hidden" />
          <h2 className="text-2xl font-semibold tracking-[-0.02em]">登录</h2>
          <p className="mt-2 text-sm text-text-muted">
            欢迎回来，继续你的创作。
          </p>
          <LoginForm className="mt-8" nextPath={safeNext} />
        </div>
      </main>
    </div>
  );
}
