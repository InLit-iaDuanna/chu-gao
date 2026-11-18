import { LoginForm } from "@/components/auth/LoginForm";
import { AuthShell } from "@/components/auth/AuthShell";
import { checkSessionFromHeaders } from "@/lib/auth";
import { safeNextPath } from "@/lib/safe-next-path";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;
  const session = await checkSessionFromHeaders(await headers());
  const safeNext = safeNextPath(next);

  if (session.status === "authenticated") redirect(safeNext);

  return (
    <AuthShell
      eyebrow="Chūgǎo Studio"
      headline={
        <>
          为设计学生
          <br />
          而生的工作台
        </>
      }
      asideNote="统一接入海外主流图像生成模型，专注创作，无需切换工具。"
    >
      <h2 className="text-[28px] font-semibold tracking-[-0.03em]">欢迎回来</h2>
      <p className="mt-2 text-[15px] text-text-muted">登录后继续你的创作。</p>
      <LoginForm className="mt-8" nextPath={safeNext} />
      <p className="mt-6 text-center text-sm text-text-muted">
        还没有账户？{" "}
        <Link
          href={`/register?next=${encodeURIComponent(safeNext)}`}
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          创建账户
        </Link>
      </p>
    </AuthShell>
  );
}
