"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Eye, EyeOff } from "lucide-react";
import { motion } from "framer-motion";

import { ActionableStatus } from "@/components/shared/ActionableStatus";
import { Button, FormField, IconButton, Input, Switch } from "@/components/ui";

interface LoginFormProps {
  nextPath?: string;
  className?: string;
}

export function LoginForm({
  nextPath = "/app",
  className,
}: LoginFormProps): React.ReactElement {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        router.push(nextPath);
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "邮箱或密码错误");
      }
    } catch {
      setError("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <motion.form
      animate={{ opacity: 1, y: 0 }}
      className={className}
      initial={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      onSubmit={handleSubmit}
    >
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
            inputSize="lg"
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
              inputSize="lg"
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
              tabIndex={-1}
              aria-label={showPassword ? "隐藏密码" : "显示密码"}
            >
              {showPassword ? <EyeOff /> : <Eye />}
            </IconButton>
          </div>
        </FormField>

        <div className="flex items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm text-text-muted">
            <Switch checked={remember} size="sm" onChange={setRemember} />
            记住我
          </label>
        </div>

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
    </motion.form>
  );
}
