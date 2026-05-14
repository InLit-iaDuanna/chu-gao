import { LoginForm } from "@/components/auth/LoginForm";
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
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background">
      {/* Ambient glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
      >
        <div className="h-[480px] w-[480px] rounded-full bg-foreground/[0.04] blur-[120px]" />
      </div>

      <div className="relative z-10 w-full max-w-md px-4">
        {/* Logo mark */}
        <div className="mb-8 flex justify-center">
          <div className="relative flex h-10 w-10 items-center justify-center">
            <div className="absolute h-7 w-7 rounded-[4px] border border-border-strong bg-surface" />
            <div className="absolute h-4 w-4 translate-x-[5px] translate-y-[5px] rounded-[3px] bg-foreground" />
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-8 shadow-sm">
          <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.14em] text-text-faint">
            欢迎回来
          </p>
          <h1 className="mb-6 text-2xl font-semibold tracking-tight text-foreground">
            进入工作台
          </h1>
          <LoginForm nextPath={safeNext} />
        </div>
      </div>
    </main>
  );
}
