"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, ArrowRight, Loader2 } from "lucide-react";

export function LoginForm({ nextPath = "/app" }: { nextPath?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
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
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="email"
          className="text-[13px] font-medium text-foreground"
        >
          邮箱
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="h-10 rounded-lg border border-border bg-background px-3 text-[14px] text-foreground placeholder:text-text-faint outline-none ring-offset-0 transition-colors focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="password"
          className="text-[13px] font-medium text-foreground"
        >
          密码
        </label>
        <div className="relative">
          <input
            id="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="h-10 w-full rounded-lg border border-border bg-background px-3 pr-10 text-[14px] text-foreground placeholder:text-text-faint outline-none transition-colors focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-text-faint hover:text-foreground transition-colors"
            tabIndex={-1}
          >
            {showPassword ? (
              <EyeOff size={15} strokeWidth={1.5} />
            ) : (
              <Eye size={15} strokeWidth={1.5} />
            )}
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-[13px] text-red-500">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="mt-1 flex h-10 items-center justify-center gap-2 rounded-lg bg-foreground px-4 text-[14px] font-medium text-background transition-opacity hover:opacity-85 disabled:opacity-50"
      >
        {loading ? (
          <Loader2 size={15} className="animate-spin" />
        ) : (
          <>
            登录
            <ArrowRight size={15} strokeWidth={1.5} />
          </>
        )}
      </button>
    </form>
  );
}
