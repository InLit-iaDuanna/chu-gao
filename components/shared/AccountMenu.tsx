"use client";

import Link from "next/link";
import { ChevronDown, LogOut, Settings, Shield, Ticket } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
  IconButton,
} from "@/components/ui";
import { clearWorkbenchPreferences } from "@/lib/workbench-preferences";

type ApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: { message: string } };

interface MeView {
  email: string;
  name?: string | null;
  role: "USER" | "ADMIN";
  credits?: number;
  authenticated?: boolean;
}

function initials(email: string): string {
  return email.slice(0, 1).toUpperCase();
}

interface AccountMenuProps {
  compact?: boolean;
  showAdminLink?: boolean;
}

export function AccountMenu({
  compact = false,
  showAdminLink = true,
}: AccountMenuProps): React.ReactElement {
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
      <Button asChild size="sm">
        <Link href="/login">登录</Link>
      </Button>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      {showAdminLink && me.role === "ADMIN" ? (
        <IconButton asChild aria-label="管理后台" title="管理后台">
          <Link href="/admin">
            <Shield className="h-3.5 w-3.5" strokeWidth={1.6} />
          </Link>
        </IconButton>
      ) : null}
      <DropdownMenu
        trigger={
          <button
            className="flex h-8 max-w-full items-center gap-2 rounded-md bg-surface-2 pl-1 pr-2 text-sm text-foreground shadow-[inset_0_0_0_1px_rgb(var(--border))] transition-colors hover:bg-surface-3"
            type="button"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-[11px] font-semibold text-background">
              {initials(me.email)}
            </span>
            {!compact ? (
              <span className="hidden max-w-[120px] truncate md:inline">
                {me.name ?? me.email}
              </span>
            ) : null}
            <ChevronDown
              className="h-3.5 w-3.5 text-text-faint"
              strokeWidth={1.6}
            />
          </button>
        }
      >
        <div className="px-2 py-2">
          <p className="truncate text-sm font-medium text-foreground">
            {me.name ?? "账户"}
          </p>
          <p className="truncate text-xs text-text-muted">{me.email}</p>
          <Badge className="mt-2" variant="outline">
            余额 {me.credits ?? 0}
          </Badge>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push("/app/settings")}>
          <Settings className="h-3.5 w-3.5" strokeWidth={1.6} />
          账户设置
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => router.push("/app/settings#redeem-code")}
        >
          <Ticket className="h-3.5 w-3.5" strokeWidth={1.6} />
          兑换码
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-danger" onClick={logout}>
          <LogOut className="h-3.5 w-3.5" strokeWidth={1.6} />
          登出
        </DropdownMenuItem>
      </DropdownMenu>
    </div>
  );
}
