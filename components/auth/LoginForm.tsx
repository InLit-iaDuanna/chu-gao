"use client";

import { useState } from "react";
import { ArrowRight, Eye, EyeOff } from "lucide-react";

import { ActionableStatus } from "@/components/shared/ActionableStatus";
import { Button, FormField, IconButton, Input } from "@/components/ui";
import {
  CLIENT_DEVICE_ID_HEADER,
  CLIENT_DEVICE_TOUCH_POINTS_HEADER,
  CLIENT_DEVICE_TYPE_HEADER,
  detectBrowserDeviceType,
  detectBrowserTouchPoints,
  getBrowserDeviceId,
  withBrowserAuthLock,
} from "@/lib/session-device";
import { safeNextPath } from "@/lib/safe-next-path";
import { cn } from "@/lib/utils";

interface LoginFormProps {
  nextPath?: string;
  className?: string;
}

function readApiErrorMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object" || !("error" in payload)) {
    return undefined;
  }

  const error = payload.error;
  if (typeof error === "string") {
    return error;
  }

  if (!error || typeof error !== "object") {
    return undefined;
  }

  return "message" in error && typeof error.message === "string"
    ? error.message
    : undefined;
}

export function LoginForm({
  nextPath = "/app",
  className,
}: LoginFormProps): React.ReactElement {
  const safeNext = safeNextPath(nextPath);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await withBrowserAuthLock(() => {
        const deviceId = getBrowserDeviceId();

        return fetch("/api/auth/login", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            [CLIENT_DEVICE_ID_HEADER]: deviceId,
            [CLIENT_DEVICE_TYPE_HEADER]: detectBrowserDeviceType(),
            [CLIENT_DEVICE_TOUCH_POINTS_HEADER]: detectBrowserTouchPoints(),
          },
          body: JSON.stringify({ email, password }),
        });
      });
      if (res.ok) {
        location.assign(safeNext);
      } else {
        const data: unknown = await res.json().catch(() => null);
        setError(readApiErrorMessage(data) ?? "邮箱或密码错误");
      }
    } catch {
      setError("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className={cn("anim-rise", className)} onSubmit={handleSubmit}>
      <div className="flex flex-col gap-4">
        {error ? (
          <ActionableStatus
            tone="danger"
            title="无法登录"
            description={error}
            className="py-3"
          />
        ) : null}

        <FormField label="邮箱" htmlFor="email">
          <Input
            id="email"
            type="email"
            controlSize="lg"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            aria-invalid={Boolean(error)}
          />
        </FormField>

        <FormField label="密码" htmlFor="password">
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              controlSize="lg"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="输入密码"
              className="pr-10"
              aria-invalid={Boolean(error)}
            />
            <IconButton
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-1 top-1/2 -translate-y-1/2"
              aria-pressed={showPassword}
              aria-label={showPassword ? "隐藏密码" : "显示密码"}
            >
              {showPassword ? <EyeOff /> : <Eye />}
            </IconButton>
          </div>
        </FormField>

        <Button
          type="submit"
          className="mt-1 w-full"
          disabled={loading}
          loading={loading}
          rightIcon={<ArrowRight className="h-4 w-4" strokeWidth={1.6} />}
          size="lg"
          variant="primary"
        >
          登录
        </Button>
      </div>
    </form>
  );
}
