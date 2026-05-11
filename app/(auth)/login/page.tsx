import { LoginForm } from "@/components/auth/LoginForm";
import { ActionableStatus } from "@/components/shared/ActionableStatus";
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

  if (session.status === "authenticated") {
    redirect(safeNext);
  }

  return (
    <main className="page-shell flex min-h-screen items-center justify-center py-16">
      <div className="surface-panel w-full max-w-md p-6">
        <p className="eyebrow">登录</p>
        <h1 className="mt-2 text-2xl">进入工作台</h1>
        <p className="mt-3 text-sm leading-6 text-text-muted">
          {session.status === "unavailable"
            ? "当前无法确认已有登录状态，可以稍后重试登录。"
            : "登录后会回到你刚才访问的页面。"}
        </p>
        {session.status === "unavailable" ? (
          <ActionableStatus
            tone="warning"
            title="登录状态暂时无法读取"
            description="你可以提交登录信息；如果服务尚未恢复，页面会给出可重试的提示。"
            className="mt-6"
          />
        ) : null}
        <LoginForm nextPath={safeNext} />
      </div>
    </main>
  );
}
