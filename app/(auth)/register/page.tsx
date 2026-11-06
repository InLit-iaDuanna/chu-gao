import { RegisterForm } from "@/components/auth/RegisterForm";
import { AuthShell } from "@/components/auth/AuthShell";
import { ActionableStatus } from "@/components/shared/ActionableStatus";
import { Logo } from "@/components/shared/Logo";
import { Button } from "@/components/ui";
import { checkSessionFromHeaders } from "@/lib/auth";
import { safeNextPath } from "@/lib/safe-next-path";
import {
  getPublicRuntimeConfig,
  SystemConfigUnavailableError,
} from "@/lib/system-config";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
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
    <AuthShell
      eyebrow="Chūgǎo Studio"
      headline={
        <>
          从一张草图
          <br />
          到完整方案
        </>
      }
      asideNote="把灵感、模型和生成记录留在同一个安静的工作空间里。"
    >
      <Logo className="mb-8 lg:hidden" />
      <h2 className="text-2xl font-semibold tracking-[-0.02em]">创建账户</h2>
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
    </AuthShell>
  );
}
