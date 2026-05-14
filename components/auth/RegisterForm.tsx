"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { motion } from "framer-motion";

import { ActionableStatus } from "@/components/shared/ActionableStatus";
import { friendlyErrorMessage } from "@/components/shared/error-copy";
import { Button, Checkbox, FormField, Input } from "@/components/ui";
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
    <motion.form
      animate={{ opacity: 1, y: 0 }}
      className="mt-8 space-y-4"
      initial={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      onSubmit={submit}
    >
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
        <Input
          id="register-password"
          inputSize="lg"
          placeholder="至少 8 位"
          type="password"
          autoComplete="new-password"
          minLength={8}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        <div className="mt-2 grid grid-cols-4 gap-1">
          {Array.from({ length: 4 }).map((_, index) => (
            <span
              key={index}
              className={cn(
                "h-1 rounded-full bg-surface-2",
                index < passwordStrength && "bg-foreground",
              )}
            />
          ))}
        </div>
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
        <Input
          id="register-confirm"
          inputSize="lg"
          placeholder="再次输入密码"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          required
        />
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
    </motion.form>
  );
}
