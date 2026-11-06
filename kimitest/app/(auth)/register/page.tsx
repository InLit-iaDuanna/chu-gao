import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth/AuthShell";
import { RegisterForm } from "@/components/auth/RegisterForm";
import { ActionableStatus } from "@/components/shared/ActionableStatus";
import { Button } from "@/components/ui";
import { checkSessionFromHeaders } from "@/lib/auth";
import {
  getPublicRuntimeConfig,
  SystemConfigUnavailableError,
} from "@/lib/system-config";

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
    <AuthShell
      headline={
        <>
          从一张草图
          <br />
          到<span className="text-aurora">完整方案</span>
        </>
      }
      subline="把灵感、模型和生成记录留在同一个安静的工作空间里。"
      title="创建账户"
      subtitle={
        configUnavailable
          ? "注册服务暂不可用，请稍后刷新再试。"
          : inviteOnly
            ? "当前需要邀请码才能注册。"
            : "创建后会直接进入图像生成工作台。"
      }
    >
      {configUnavailable ? (
        <div className="space-y-4">
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
