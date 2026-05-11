"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ActionableStatus } from "@/components/shared/ActionableStatus";
import { friendlyErrorMessage } from "@/components/shared/error-copy";

type ApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code?: string; message: string } };

function safeNextPath(value: string | undefined): string {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/app";
}

export function LoginForm({ nextPath }: { nextPath?: string }) {
  const router = useRouter();
  const safeNext = safeNextPath(nextPath);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const canSubmit =
    email.trim().length > 0 && password.length > 0 && !isSubmitting;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const payload = (await response.json()) as ApiResponse<unknown>;

      if (!payload.ok) {
        throw new Error(
          friendlyErrorMessage(
            payload.error,
            "登录失败，请检查邮箱和密码后重试。",
          ),
        );
      }

      router.push(safeNext);
      router.refresh();
    } catch (loginError) {
      setError(
        friendlyErrorMessage(
          loginError instanceof Error ? loginError.message : null,
          "登录失败，请检查邮箱和密码后重试。",
        ),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="mt-6 space-y-4" onSubmit={submit}>
      <label className="block space-y-2">
        <span className="field-label">邮箱</span>
        <input
          className="surface-panel-soft h-12 w-full px-4 outline-none transition-colors focus:border-foreground"
          placeholder="you@example.com"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </label>
      <label className="block space-y-2">
        <span className="field-label">密码</span>
        <input
          className="surface-panel-soft h-12 w-full px-4 outline-none transition-colors focus:border-foreground"
          placeholder="输入密码"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </label>
      {error ? (
        <ActionableStatus
          tone="danger"
          title="无法登录"
          description={error}
          className="py-3"
        />
      ) : null}
      <button className="button-primary h-12 w-full" disabled={!canSubmit}>
        {isSubmitting ? "登录中" : "登录"}
      </button>
      <p className="text-sm text-text-muted">
        还没有账号？{" "}
        <Link href={`/register?next=${encodeURIComponent(safeNext)}`}>
          创建账户
        </Link>
      </p>
    </form>
  );
}
