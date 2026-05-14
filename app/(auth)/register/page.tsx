import { RegisterForm } from "@/components/auth/RegisterForm";
import { ActionableStatus } from "@/components/shared/ActionableStatus";
import { Logo } from "@/components/shared/Logo";
import { Button } from "@/components/ui";
import { checkSessionFromHeaders } from "@/lib/auth";
import {
  getPublicRuntimeConfig,
  SystemConfigUnavailableError,
} from "@/lib/system-config";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

function safeNextPath(value: string | undefined): string {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/app";
}

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const session = await checkSessionFromHeaders(await headers());
  const safeNext = safeNextPath(next);
  let inviteOnly = true;
  let configUnavailable = false;

  if (session.status === "authenticated") {
    redirect(safeNext);
  }

  try {
    const publicConfig = await getPublicRuntimeConfig();
    inviteOnly = publicConfig.inviteOnly;
  } catch (error) {
    if (error instanceof SystemConfigUnavailableError) {
      configUnavailable = true;
    } else {
      throw error;
    }
  }

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
              从一张草图
              <br />
              到完整方案
            </h1>
            <p className="mt-6 max-w-[420px] text-sm leading-relaxed text-text-muted">
              把灵感、模型和生成记录留在同一个安静的工作空间里。
            </p>
          </div>
          <p className="text-xs text-text-faint">© 2026 Chūgǎo Studio</p>
        </div>
      </aside>

      <main className="flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-[400px]">
          <Logo className="mb-8 lg:hidden" />
          <h2 className="text-2xl font-semibold tracking-[-0.02em]">
            创建账户
          </h2>
          <p className="mt-2 text-sm leading-6 text-text-muted">
            {configUnavailable
              ? "注册服务暂不可用，请稍后刷新再试。"
              : inviteOnly
                ? "当前需要邀请码才能注册。"
                : "创建后会直接进入图像生成工作台。"}
          </p>
          {configUnavailable ? (
            <div className="mt-6 space-y-4">
              <ActionableStatus
                tone="warning"
                title="注册暂时不可用"
                description="请稍后刷新页面。已有账户可以先返回登录。"
              />
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button asChild className="flex-1" variant="secondary">
                  <Link href="/login">返回登录</Link>
                </Button>
                <Button asChild className="flex-1" variant="primary">
                  <Link href="/register">刷新重试</Link>
                </Button>
              </div>
            </div>
          ) : (
            <RegisterForm inviteOnly={inviteOnly} nextPath={safeNext} />
          )}
        </div>
      </main>
    </div>
  );
}
