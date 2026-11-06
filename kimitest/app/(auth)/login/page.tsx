import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth/AuthShell";
import { LoginForm } from "@/components/auth/LoginForm";
import { checkSessionFromHeaders } from "@/lib/auth";

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
    <AuthShell
      headline={
        <>
          为设计学生
          <br />
          而生的<span className="text-aurora">工作台</span>
        </>
      }
      subline="统一接入海外主流图像生成模型，专注创作，无需切换工具。"
      title="登录"
      subtitle="欢迎回来，继续你的创作。"
      footer={
        <>
          还没有账户？{" "}
          <Link
            href={`/register?next=${encodeURIComponent(safeNext)}`}
            className="font-medium text-foreground underline-offset-4 transition-colors hover:text-brand-soft hover:underline"
          >
            创建账户
          </Link>
        </>
      }
    >
      <LoginForm nextPath={safeNext} />
    </AuthShell>
  );
}
