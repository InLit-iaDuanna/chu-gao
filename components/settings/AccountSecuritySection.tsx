"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ShieldAlert, Trash2 } from "lucide-react";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
} from "@/components/ui";

const CONSEQUENCES = [
  "剩余积分立即作废，且不予退回（法律法规另有规定除外）",
  "历史对话、生成记录与灵感社区作品会被删除或匿名化",
  "已绑定的 API Key、Agent 授权与所有登录设备立即失效",
  "注销后无法恢复；如需继续使用，只能用新邮箱重新注册",
];

/**
 * 设置 · 账号与安全：展示邮箱，并提供不可逆的注销入口。
 * 注销成功后清掉会话并回到登录页。
 */
export function AccountSecuritySection({
  email,
}: {
  email: string;
}): React.ReactElement {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    password.length > 0 && confirmText.trim() === "注销" && !busy;

  function reset() {
    setPassword("");
    setConfirmText("");
    setError(null);
    setBusy(false);
  }

  async function handleDelete(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/me/delete-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, confirmText: confirmText.trim() }),
      });
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        error?: { message?: string };
      } | null;

      if (!response.ok || !payload?.ok) {
        setError(payload?.error?.message ?? "注销失败，请稍后再试");
        setBusy(false);
        return;
      }

      setOpen(false);
      reset();
      router.replace("/login");
      router.refresh();
    } catch {
      setError("网络错误，请稍后再试");
      setBusy(false);
    }
  }

  return (
    <section className="surface-panel p-6">
      <p className="eyebrow">账号与安全</p>
      <h2 className="mt-2 text-xl font-semibold">账号信息</h2>

      <dl className="mt-6 space-y-4 text-sm">
        <div>
          <dt className="text-text-muted">登录邮箱</dt>
          <dd className="mt-1 break-all">{email}</dd>
        </div>
        <div>
          <dt className="text-text-muted">密码</dt>
          <dd className="mt-1 text-text-faint">••••••••</dd>
        </div>
      </dl>

      <div className="mt-6 border-t border-border pt-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-danger">
            <ShieldAlert aria-hidden="true" size={16} strokeWidth={1.7} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">注销账号</p>
            <p className="mt-1 text-sm leading-6 text-text-muted">
              注销不可恢复：积分作废，对话、作品与接入凭据会被删除或匿名化。
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="danger"
          className="mt-4 h-10"
          onClick={() => {
            reset();
            setOpen(true);
          }}
        >
          <Trash2 className="h-4 w-4 stroke-[1.5]" />
          注销账号
        </Button>
      </div>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && busy) return;
          setOpen(next);
          if (!next) reset();
        }}
      >
        <DialogContent aria-describedby={undefined} className="max-w-[460px]">
          <form onSubmit={(event) => void handleDelete(event)}>
            <DialogHeader>
              <DialogTitle>确定要注销账号吗？</DialogTitle>
              <DialogDescription>
                此操作立即生效且不可恢复，请确认你已经下载了需要保留的作品。
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 px-5 pb-5">
              <ul className="space-y-1.5 rounded-md border border-danger/30 bg-danger/5 p-3 text-sm leading-6 text-text-muted">
                {CONSEQUENCES.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span aria-hidden="true" className="text-danger">
                      ·
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>

              <FormField
                label="当前密码"
                htmlFor="delete-account-password"
                required
              >
                <Input
                  id="delete-account-password"
                  type="password"
                  controlSize="lg"
                  autoComplete="current-password"
                  className="h-11 text-sm"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="输入登录密码"
                  required
                />
              </FormField>

              <FormField
                label="输入“注销”确认"
                htmlFor="delete-account-confirm"
                required
              >
                <Input
                  id="delete-account-confirm"
                  controlSize="lg"
                  className="h-11 text-sm"
                  value={confirmText}
                  onChange={(event) => setConfirmText(event.target.value)}
                  placeholder="注销"
                  autoComplete="off"
                  required
                />
              </FormField>

              {error ? (
                <p role="alert" className="text-sm text-danger">
                  {error}
                </p>
              ) : null}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setOpen(false);
                  reset();
                }}
              >
                取消
              </Button>
              <Button
                type="submit"
                variant="danger"
                disabled={!canSubmit}
                loading={busy}
              >
                {busy ? "注销中…" : "确认注销"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
