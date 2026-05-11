"use client";

import Link from "next/link";
import { LogOut, Shield, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { clearWorkbenchPreferences } from "@/lib/workbench-preferences";

type ApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: { message: string } };

interface MeView {
  email: string;
  role: "USER" | "ADMIN";
  authenticated?: boolean;
}

export function AccountMenu() {
  const router = useRouter();
  const [me, setMe] = useState<MeView | null>(null);
  const [status, setStatus] = useState<
    "loading" | "ready" | "unauthenticated" | "error"
  >("loading");

  useEffect(() => {
    let canceled = false;

    async function loadMe() {
      try {
        const response = await fetch("/api/me", { cache: "no-store" });
        const payload = (await response.json()) as ApiResponse<MeView>;

        if (canceled) {
          return;
        }

        if (payload.ok && payload.data.authenticated) {
          setMe(payload.data);
          setStatus("ready");
          return;
        }

        setMe(null);
        setStatus(response.status === 401 ? "unauthenticated" : "error");
      } catch {
        if (!canceled) {
          setMe(null);
          setStatus("error");
        }
      }
    }

    void loadMe();

    return () => {
      canceled = true;
    };
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    clearWorkbenchPreferences();
    setMe(null);
    setStatus("unauthenticated");
    router.push("/login");
    router.refresh();
  }

  if (status === "loading") {
    return (
      <div
        className="hidden h-9 w-40 rounded-[6px] border border-border bg-surface-2 md:block"
        aria-label="账户状态读取中"
      />
    );
  }

  if (status === "error") {
    return (
      <div className="rounded-[6px] border border-border px-3 py-2 font-mono text-xs text-text-muted">
        账户暂不可读
      </div>
    );
  }

  if (status === "unauthenticated" || !me?.authenticated) {
    return (
      <Link
        href="/login"
        className="tool-button h-9 font-mono text-xs uppercase tracking-[0.12em]"
      >
        登录
      </Link>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      {me.role === "ADMIN" ? (
        <Link
          href="/admin"
          className="tool-button h-9 w-9 px-0 text-text-muted"
          title="管理后台"
        >
          <Shield className="h-4 w-4 stroke-[1.5]" />
        </Link>
      ) : null}
      <div className="hidden h-9 min-w-0 max-w-[72px] items-center gap-2 rounded-[6px] border border-border px-2 font-mono text-xs text-text-muted md:flex">
        <UserRound className="h-4 w-4 shrink-0 stroke-[1.5]" />
        <span className="min-w-0 truncate">{me.email}</span>
      </div>
      <button
        type="button"
        className="tool-button h-9 w-9 px-0 text-text-muted"
        title="退出"
        onClick={logout}
      >
        <LogOut className="h-4 w-4 stroke-[1.5]" />
      </button>
    </div>
  );
}
