import { RegisterForm } from "@/components/auth/RegisterForm";
import { ActionableStatus } from "@/components/shared/ActionableStatus";
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
    <main className="page-shell flex min-h-screen items-center justify-center py-16">
      <div className="surface-panel w-full max-w-md p-6">
        <p className="eyebrow">注册</p>
        <h1 className="mt-2 text-2xl">创建 Chūgǎo Studio 账户</h1>
        <p className="mt-3 text-sm leading-6 text-text-muted">
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
              <Link href="/login" className="button-ghost h-11">
                返回登录
              </Link>
              <Link href="/register" className="button-primary h-11">
                刷新重试
              </Link>
            </div>
          </div>
        ) : (
          <RegisterForm inviteOnly={inviteOnly} nextPath={safeNext} />
        )}
      </div>
    </main>
  );
}
