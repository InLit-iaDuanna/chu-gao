"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Eye, EyeOff } from "lucide-react";

import { ActionableStatus } from "@/components/shared/ActionableStatus";
import { friendlyErrorMessage } from "@/components/shared/error-copy";
import { Button, Checkbox, FormField, IconButton, Input } from "@/components/ui";
import { cn } from "@/lib/utils";

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
}): React.ReactElement {
  const router = useRouter();
  const safeNext = safeNextPath(nextPath);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const passwordStrength = Math.min(
    4,
    [
      password.length >= 8,
      /[A-Z]/.test(password),
      /\d/.test(password),
      /[^A-Za-z0-9]/.test(password),
    ].filter(Boolean).length,
  );
  const strengthTone: "danger" | "warning" | "success" =
    passwordStrength >= 4 ? "success" : passwordStrength >= 3 ? "warning" : "danger";
  const strengthBarClass: Record<typeof strengthTone, string> = {
    danger: "bg-danger",
    warning: "bg-warning",
    success: "bg-success",
  };
  const strengthTextClass: Record<typeof strengthTone, string> = {
    danger: "text-danger",
    warning: "text-warning",
    success: "text-success",
  };
  const strengthLabel: Record<typeof strengthTone, string> = {
    danger: "弱",
    warning: "中",
    success: "强",
  };
  const canSubmit =
    email.trim().length > 0 &&
    password.length >= 8 &&
    confirmPassword === password &&
    accepted &&
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
    <form className="anim-rise mt-8 space-y-4" onSubmit={submit}>
      <Button
        asChild
        variant="link"
        leftIcon={<ArrowLeft className="h-4 w-4" />}
      >
        <Link href={`/login?next=${encodeURIComponent(safeNext)}`}>
          返回登录
        </Link>
      </Button>

      <FormField label="邮箱" htmlFor="register-email" required>
        <Input
          id="register-email"
          inputSize="lg"
          placeholder="you@example.com"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </FormField>

      <FormField label="用户名" htmlFor="register-name">
        <Input
          id="register-name"
          inputSize="lg"
          placeholder="可选"
          value={name}
          autoComplete="name"
          onChange={(event) => setName(event.target.value)}
        />
      </FormField>

      <FormField label="密码" htmlFor="register-password" required>
        <div className="relative">
          <Input
            id="register-password"
            inputSize="lg"
            placeholder="至少 8 位"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="pr-10"
            required
          />
          <IconButton
            type="button"
            onClick={() => setShowPassword((value) => !value)}
            className="absolute right-1 top-1/2 -translate-y-1/2"
            aria-pressed={showPassword}
            aria-label={showPassword ? "隐藏密码" : "显示密码"}
          >
            {showPassword ? <EyeOff /> : <Eye />}
          </IconButton>
        </div>
        <div className="mt-2 grid grid-cols-4 gap-1">
          {Array.from({ length: 4 }).map((_, index) => (
            <span
              key={index}
              className={cn(
                "h-1 rounded-full bg-surface-2 transition-colors",
                index < passwordStrength && strengthBarClass[strengthTone],
              )}
            />
          ))}
        </div>
        {password.length > 0 ? (
          <p
            className={cn(
              "mt-1 text-xs transition-colors",
              strengthTextClass[strengthTone],
            )}
          >
            {strengthLabel[strengthTone]}
          </p>
        ) : null}
      </FormField>

      <FormField
        label="确认密码"
        htmlFor="register-confirm"
        error={
          confirmPassword.length > 0 && confirmPassword !== password
            ? "两次输入的密码不一致"
            : undefined
        }
        required
      >
        <div className="relative">
          <Input
            id="register-confirm"
            inputSize="lg"
            placeholder="再次输入密码"
            type={showConfirmPassword ? "text" : "password"}
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            className="pr-10"
            required
          />
          <IconButton
            type="button"
            onClick={() => setShowConfirmPassword((value) => !value)}
            className="absolute right-1 top-1/2 -translate-y-1/2"
            aria-pressed={showConfirmPassword}
            aria-label={showConfirmPassword ? "隐藏密码" : "显示密码"}
          >
            {showConfirmPassword ? <EyeOff /> : <Eye />}
          </IconButton>
        </div>
      </FormField>

      {inviteOnly ? (
        <FormField label="邀请码" htmlFor="invite-code" required>
          <Input
            id="invite-code"
            inputSize="lg"
            placeholder="输入管理员发放的邀请码"
            value={inviteCode}
            onChange={(event) => setInviteCode(event.target.value)}
            required
          />
        </FormField>
      ) : null}

      <label className="flex items-start gap-2 text-sm leading-6 text-text-muted">
        <Checkbox
          checked={accepted}
          className="mt-1"
          required
          onChange={(event) => setAccepted(event.target.checked)}
        />
        <span>我已了解并同意仅将本工作台用于合规创作。</span>
      </label>

      {error ? (
        <ActionableStatus
          tone="danger"
          title="无法创建账户"
          description={error}
          className="py-3"
        />
      ) : null}

      <Button
        className="w-full"
        disabled={!canSubmit}
        loading={isSubmitting}
        size="lg"
        type="submit"
        variant="primary"
      >
        {isSubmitting ? "创建中" : "创建账户"}
      </Button>
    </form>
  );
}
