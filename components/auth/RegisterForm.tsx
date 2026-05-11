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

export function RegisterForm({
  inviteOnly,
  nextPath,
}: {
  inviteOnly: boolean;
  nextPath?: string;
}) {
  const router = useRouter();
  const safeNext = safeNextPath(nextPath);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const canSubmit =
    email.trim().length > 0 &&
    password.length >= 8 &&
    (!inviteOnly || inviteCode.trim().length > 0) &&
    !isSubmitting;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          name: name.trim() || undefined,
          password,
          inviteCode: inviteCode.trim() || undefined,
        }),
      });
      const payload = (await response.json()) as ApiResponse<unknown>;

      if (!payload.ok) {
        throw new Error(
          friendlyErrorMessage(payload.error, "注册失败，请检查输入后重试。"),
        );
      }

      router.push(safeNext);
      router.refresh();
    } catch (registerError) {
      setError(
        friendlyErrorMessage(
          registerError instanceof Error ? registerError.message : null,
          "注册失败，请检查输入后重试。",
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
        <span className="field-label">姓名</span>
        <input
          className="surface-panel-soft h-12 w-full px-4 outline-none transition-colors focus:border-foreground"
          placeholder="可选"
          value={name}
          autoComplete="name"
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label className="block space-y-2">
        <span className="field-label">密码</span>
        <input
          className="surface-panel-soft h-12 w-full px-4 outline-none transition-colors focus:border-foreground"
          placeholder="至少 8 位"
          type="password"
          autoComplete="new-password"
          minLength={8}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </label>
      {inviteOnly ? (
        <label className="block space-y-2">
          <span className="field-label">邀请码</span>
          <input
            className="surface-panel-soft h-12 w-full px-4 outline-none transition-colors focus:border-foreground"
            placeholder="输入管理员发放的邀请码"
            value={inviteCode}
            onChange={(event) => setInviteCode(event.target.value)}
            required
          />
        </label>
      ) : null}
      {error ? (
        <ActionableStatus
          tone="danger"
          title="无法创建账户"
          description={error}
          className="py-3"
        />
      ) : null}
      <button className="button-primary h-12 w-full" disabled={!canSubmit}>
        {isSubmitting ? "创建中" : "创建账户"}
      </button>
      <p className="text-sm text-text-muted">
        已有账号？{" "}
        <Link href={`/login?next=${encodeURIComponent(safeNext)}`}>
          返回登录
        </Link>
      </p>
    </form>
  );
}
