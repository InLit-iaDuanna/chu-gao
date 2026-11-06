"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ROLE_LABELS, USER_STATUS_LABELS } from "@/lib/admin-labels";

import {
  AdminToast,
  type AdminToastState,
  patchJson,
  postJson,
} from "@/components/admin/admin-form-utils";

export function AdminUserProfileForm({
  user,
}: {
  user: {
    id: string;
    email: string;
    name: string | null;
    role: "USER" | "ADMIN";
    status: "ACTIVE" | "BANNED";
    dailyGenLimit: number;
    concurrentLimit: number;
    bannedReason: string | null;
  };
}) {
  const router = useRouter();
  const [email, setEmail] = useState(user.email);
  const [name, setName] = useState(user.name ?? "");
  const [role, setRole] = useState(user.role);
  const [status, setStatus] = useState(user.status);
  const [dailyGenLimit, setDailyGenLimit] = useState(user.dailyGenLimit);
  const [concurrentLimit, setConcurrentLimit] = useState(user.concurrentLimit);
  const [bannedReason, setBannedReason] = useState(user.bannedReason ?? "");
  const [toast, setToast] = useState<AdminToastState>({
    show: false,
    type: "success",
    message: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const canSubmit = email.trim().length > 0 && !isSubmitting;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    setIsSubmitting(true);

    try {
      await patchJson(`/api/admin/users/${user.id}`, {
        email: email.trim(),
        name: name.trim() || null,
        role,
        status,
        dailyGenLimit,
        concurrentLimit,
        bannedReason: bannedReason.trim() || null,
      });
      setToast({ show: true, type: "success", message: "账号资料已更新" });
      router.refresh();
    } catch (error) {
      setToast({
        show: true,
        type: "error",
        message: error instanceof Error ? error.message : "保存失败",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <AdminToast
        {...toast}
        onClose={() => setToast({ ...toast, show: false })}
      />
      <form onSubmit={submit} className="brutal-card">
        <div className="border-b-3 border-border px-6 py-4">
          <h3 className="text-lg font-semibold tracking-tight">账号资料与额度</h3>
        </div>
        <div className="p-6">
          <table className="w-full">
            <tbody className="divide-y divide-border/50">
              <tr className="group">
                <td className="py-3 pr-6 align-top">
                  <label className="block text-sm font-medium text-text-muted">
                    邮箱地址
                  </label>
                </td>
                <td className="py-3">
                  <input
                    className="brutal-input w-full"
                    required
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </td>
              </tr>
              <tr className="group">
                <td className="py-3 pr-6 align-top">
                  <label className="block text-sm font-medium text-text-muted">
                    昵称
                  </label>
                </td>
                <td className="py-3">
                  <input
                    className="brutal-input w-full"
                    placeholder="昵称（可选）"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </td>
              </tr>
              <tr className="group">
                <td className="py-3 pr-6 align-top">
                  <label className="block text-sm font-medium text-text-muted">
                    角色
                  </label>
                </td>
                <td className="py-3">
                  <select
                    className="brutal-select w-full max-w-xs"
                    value={role}
                    onChange={(event) =>
                      setRole(event.target.value as "USER" | "ADMIN")
                    }
                  >
                    <option value="USER">{ROLE_LABELS.USER}</option>
                    <option value="ADMIN">{ROLE_LABELS.ADMIN}</option>
                  </select>
                </td>
              </tr>
              <tr className="group">
                <td className="py-3 pr-6 align-top">
                  <label className="block text-sm font-medium text-text-muted">
                    状态
                  </label>
                </td>
                <td className="py-3">
                  <select
                    className="brutal-select w-full max-w-xs"
                    value={status}
                    onChange={(event) =>
                      setStatus(event.target.value as "ACTIVE" | "BANNED")
                    }
                  >
                    <option value="ACTIVE">{USER_STATUS_LABELS.ACTIVE}</option>
                    <option value="BANNED">{USER_STATUS_LABELS.BANNED}</option>
                  </select>
                </td>
              </tr>
              <tr className="group">
                <td className="py-3 pr-6 align-top">
                  <label className="block text-sm font-medium text-text-muted">
                    每日生成限额
                  </label>
                </td>
                <td className="py-3">
                  <input
                    className="brutal-number-input w-32"
                    type="number"
                    min={1}
                    max={1000}
                    value={dailyGenLimit}
                    onChange={(event) =>
                      setDailyGenLimit(Number(event.target.value))
                    }
                  />
                </td>
              </tr>
              <tr className="group">
                <td className="py-3 pr-6 align-top">
                  <label className="block text-sm font-medium text-text-muted">
                    并发限制
                  </label>
                </td>
                <td className="py-3">
                  <input
                    className="brutal-number-input w-32"
                    type="number"
                    min={1}
                    max={20}
                    value={concurrentLimit}
                    onChange={(event) =>
                      setConcurrentLimit(Number(event.target.value))
                    }
                  />
                </td>
              </tr>
              <tr className="group">
                <td className="py-3 pr-6 align-top">
                  <label className="block text-sm font-medium text-text-muted">
                    备注原因
                  </label>
                </td>
                <td className="py-3">
                  <input
                    className="brutal-input w-full"
                    placeholder="封禁/调整原因"
                    value={bannedReason}
                    onChange={(event) => setBannedReason(event.target.value)}
                  />
                  <p className="mt-2 text-xs text-text-muted">
                    用于记录管理操作的原因说明
                  </p>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="border-t-3 border-border px-6 py-4">
          <button
            className="brutal-button-primary"
            type="submit"
            disabled={!canSubmit}
          >
            保存资料
          </button>
        </div>
      </form>
    </>
  );
}

export function AdminPasswordResetForm({ userId }: { userId: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const canSubmit = password.trim().length >= 8 && !isSubmitting;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canSubmit) {
      return;
    }

    if (!window.confirm("确认重置该账号密码并强制旧登录失效？")) {
      return;
    }

    setIsSubmitting(true);
    setMessage("重置中...");

    try {
      await postJson(`/api/admin/users/${userId}/password`, {
        password: password.trim(),
      });
      setPassword("");
      setMessage("密码已重置");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "重置失败");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="surface-panel p-4">
      <p className="text-sm font-medium">重置密码</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          type="password"
          minLength={8}
          required
          placeholder="输入新密码"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <button
          className="tool-button h-10"
          type="submit"
          disabled={!canSubmit}
        >
          重置
        </button>
      </div>
      {message ? (
        <p className="mt-3 text-sm text-text-muted">{message}</p>
      ) : null}
    </form>
  );
}

export function AdminDangerActions({ userId }: { userId: string }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);

  async function run(label: string, url: string, body: unknown) {
    if (!window.confirm(`确认执行：${label}？`)) {
      return;
    }

    setMessage("处理中...");

    try {
      await postJson(url, body);
      setMessage(`${label} 已完成`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作失败");
    }
  }

  return (
    <div className="surface-panel p-4">
      <p className="text-sm font-medium">安全与数据操作</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          className="tool-button h-10 text-text-muted"
          type="button"
          onClick={() =>
            run("强制下线", `/api/admin/users/${userId}/sessions/revoke`, {
              reason: "admin_action",
            })
          }
        >
          强制下线
        </button>
        <button
          className="tool-button h-10 text-text-muted"
          type="button"
          onClick={() =>
            run(
              "归档全部会话",
              `/api/admin/users/${userId}/conversations/archive`,
              {
                mode: "all",
              },
            )
          }
        >
          归档会话
        </button>
        <button
          className="tool-button h-10 text-danger"
          type="button"
          onClick={() =>
            run(
              "软删除失败任务",
              `/api/admin/users/${userId}/generations/delete`,
              {
                mode: "failed",
              },
            )
          }
        >
          删除失败任务
        </button>
        <button
          className="tool-button h-10 text-danger"
          type="button"
          onClick={() =>
            run(
              "软删除全部任务",
              `/api/admin/users/${userId}/generations/delete`,
              {
                mode: "all",
              },
            )
          }
        >
          删除全部任务
        </button>
      </div>
      {message ? (
        <p className="mt-3 text-sm text-text-muted">{message}</p>
      ) : null}
    </div>
  );
}

export function AdminCreditForm({ userId }: { userId: string }) {
  const router = useRouter();
  const [amount, setAmount] = useState(100);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const canSubmit = Number.isFinite(amount) && amount !== 0 && !isSubmitting;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    setIsSubmitting(true);
    setMessage("处理中...");

    try {
      await postJson(`/api/admin/users/${userId}/credits`, {
        amount,
        note: note.trim(),
      });
      setMessage("点数已更新");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作失败");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="surface-panel p-4">
      <p className="text-sm font-medium">充值 / 调整点数</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)_auto]">
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          type="number"
          value={amount}
          onChange={(event) => setAmount(Number(event.target.value))}
        />
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          placeholder="备注"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        <button
          className="tool-button h-10"
          type="submit"
          disabled={!canSubmit}
        >
          保存
        </button>
      </div>
      {message ? (
        <p className="mt-3 text-sm text-text-muted">{message}</p>
      ) : null}
    </form>
  );
}
