"use client";

import { Button, Input, Select } from "@/components/ui";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { formatDate } from "@/lib/utils";

import {
  adjustAdminUserCredits,
  archiveAdminUserConversations,
  banAdminUser,
  deleteAdminUserGenerations,
  getAdminUser,
  isAdminApiError,
  patchAdminUser,
  resetAdminUserPassword,
  revokeAdminUserSessions,
} from "./lib/api";
import type { AdminUserDetail } from "./lib/types";
import { AdminField, AdminPageHeader, EmptyPanel, ErrorText } from "./ui";

export function UserDetailView({ userId }: { userId: string }) {
  const router = useRouter();
  const [user, setUser] = useState<AdminUserDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    getAdminUser(userId)
      .then(setUser)
      .catch(() => setFailed(true));
  }, [userId]);

  useEffect(reload, [reload]);

  async function run(action: () => Promise<unknown>, okMessage: string) {
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(okMessage);
      reload();
    } catch (actionError) {
      setError(isAdminApiError(actionError) ? actionError.message : "操作失败");
    }
  }

  if (failed) return <EmptyPanel text="用户详情暂时不可用" />;
  if (!user) return <div className="surface-panel h-64 animate-pulse" />;

  return (
    <div>
      <AdminPageHeader
        eyebrow="User"
        title={user.email}
        description={`ID ${user.id} · 注册于 ${formatDate(user.createdAt)} · 共 ${user._count.generations} 个任务`}
        actions={
          <Button
            type="button"
            className="h-9 px-3 text-xs text-text-muted"
            onClick={() => router.push("/admin/users")}
          >
            返回列表
          </Button>
        }
      />

      <ErrorText message={error} />
      {notice ? <p className="mb-4 text-sm text-success">{notice}</p> : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <ProfileSection
          user={user}
          onSave={(patch) =>
            run(() => patchAdminUser(userId, patch), "资料已保存")
          }
        />
        <CreditsSection
          key={user.id}
          user={user}
          onAdjust={(amount, note) =>
            run(
              () => adjustAdminUserCredits(userId, { amount, note }),
              "点数已调整",
            )
          }
        />
        <SecuritySection
          userId={userId}
          onResetPassword={(password) =>
            run(() => resetAdminUserPassword(userId, password), "密码已重置")
          }
          onRevoke={() =>
            run(
              () => revokeAdminUserSessions(userId, "管理员强制下线"),
              "已强制下线",
            )
          }
        />
        <DangerSection
          user={user}
          onArchive={(mode) =>
            run(() => archiveAdminUserConversations(userId, mode), "对话已归档")
          }
          onDeleteGenerations={(mode) =>
            run(
              () => deleteAdminUserGenerations(userId, { mode }),
              "生成记录已删除",
            )
          }
          onBan={() =>
            run(async () => {
              await banAdminUser(userId);
            }, "已封禁").then(() => router.push("/admin/users"))
          }
        />
      </div>
    </div>
  );
}

function ProfileSection({
  user,
  onSave,
}: {
  user: AdminUserDetail;
  onSave: (patch: {
    email?: string;
    name?: string | null;
    role?: "USER" | "ADMIN";
    status?: "ACTIVE" | "BANNED";
    dailyGenLimit?: number;
    concurrentLimit?: number;
    materialInboxBeta?: boolean;
    bannedReason?: string | null;
  }) => Promise<void>;
}) {
  const [form, setForm] = useState({
    email: user.email,
    name: user.name ?? "",
    role: user.role,
    status: user.status,
    dailyGenLimit: user.dailyGenLimit ?? 50,
    concurrentLimit: user.concurrentLimit ?? 2,
    materialInboxBeta: Boolean(user.materialInboxBeta),
    bannedReason: user.bannedReason ?? "",
  });
  const [busy, setBusy] = useState(false);

  return (
    <section className="surface-panel p-5">
      <p className="eyebrow">资料</p>
      <div className="mt-4 grid gap-3">
        <AdminField label="邮箱">
          <Input
            value={form.email}
            onChange={(event) =>
              setForm({ ...form, email: event.target.value })
            }
          />
        </AdminField>
        <AdminField label="昵称">
          <Input
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </AdminField>
        <div className="grid grid-cols-2 gap-3">
          <AdminField label="角色">
            <Select
              aria-label="角色"
              value={form.role}
              onValueChange={(value) =>
                setForm({
                  ...form,
                  role: value as "USER" | "ADMIN",
                })
              }
              options={[
                { value: "USER", label: "用户" },
                { value: "ADMIN", label: "管理员" },
              ]}
            />
          </AdminField>
          <AdminField label="状态">
            <Select
              aria-label="状态"
              value={form.status}
              onValueChange={(value) =>
                setForm({
                  ...form,
                  status: value as "ACTIVE" | "BANNED",
                })
              }
              options={[
                { value: "ACTIVE", label: "正常" },
                { value: "BANNED", label: "封禁" },
              ]}
            />
          </AdminField>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <AdminField label="日生成上限">
            <Input
              type="number"
              min={1}
              max={1000}
              value={form.dailyGenLimit}
              onChange={(event) =>
                setForm({ ...form, dailyGenLimit: Number(event.target.value) })
              }
            />
          </AdminField>
          <AdminField label="并发上限">
            <Input
              type="number"
              min={1}
              max={10000}
              value={form.concurrentLimit}
              onChange={(event) =>
                setForm({
                  ...form,
                  concurrentLimit: Number(event.target.value),
                })
              }
            />
          </AdminField>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[var(--accent)]"
            checked={form.materialInboxBeta}
            onChange={(event) =>
              setForm({ ...form, materialInboxBeta: event.target.checked })
            }
          />
          素材收件箱测试权限
        </label>
        {form.status === "BANNED" ? (
          <AdminField label="封禁原因">
            <Input
              value={form.bannedReason}
              onChange={(event) =>
                setForm({ ...form, bannedReason: event.target.value })
              }
            />
          </AdminField>
        ) : null}
        <div>
          <Button
            type="button"
            className="h-9 px-4 text-text-muted disabled:opacity-45"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void onSave({
                email: form.email,
                name: form.name.trim() || null,
                role: form.role,
                status: form.status,
                dailyGenLimit: form.dailyGenLimit,
                concurrentLimit: form.concurrentLimit,
                materialInboxBeta: form.materialInboxBeta,
                bannedReason:
                  form.status === "BANNED"
                    ? form.bannedReason.trim() || null
                    : null,
              }).finally(() => setBusy(false));
            }}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            保存资料
          </Button>
        </div>
      </div>
    </section>
  );
}

function pendingCreditAdjustment(userId: string) {
  try {
    const saved = JSON.parse(
      sessionStorage.getItem(`admin-credit-pending:${userId}`) ?? "null",
    );
    const payload = saved?.payload ? JSON.parse(saved.payload) : null;
    return payload &&
      Number.isFinite(payload.amount) &&
      typeof payload.note === "string"
      ? (payload as { amount: number; note: string })
      : null;
  } catch {
    return null;
  }
}

function CreditsSection({
  user,
  onAdjust,
}: {
  user: AdminUserDetail;
  onAdjust: (amount: number, note?: string) => Promise<void>;
}) {
  const [amount, setAmount] = useState(
    () => pendingCreditAdjustment(user.id)?.amount ?? 100,
  );
  const [note, setNote] = useState(
    () => pendingCreditAdjustment(user.id)?.note ?? "",
  );
  const [busy, setBusy] = useState(false);

  return (
    <section className="surface-panel p-5">
      <p className="eyebrow">点数</p>
      <p className="mt-2 font-mono text-2xl font-semibold">{user.credits}</p>
      <div className="mt-4 grid gap-3">
        <AdminField label="调整数量（正数充值 / 负数扣减）">
          <Input
            type="number"
            step="0.000001"
            value={amount}
            onChange={(event) => setAmount(Number(event.target.value))}
          />
        </AdminField>
        <AdminField label="备注（可选）">
          <Input
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </AdminField>
        <div className="flex gap-2">
          {[100, 500, -100].map((preset) => (
            <Button
              key={preset}
              type="button"
              className="h-8 px-3 text-xs text-text-muted"
              onClick={() => setAmount(preset)}
            >
              {preset > 0 ? `+${preset}` : preset}
            </Button>
          ))}
          <Button
            type="button"
            className="h-9 px-4 text-text-muted disabled:opacity-45"
            disabled={busy || amount === 0}
            onClick={() => {
              setBusy(true);
              void onAdjust(amount, note.trim() || undefined).finally(() =>
                setBusy(false),
              );
            }}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            确认调整
          </Button>
        </div>
      </div>
    </section>
  );
}

function SecuritySection({
  userId,
  onResetPassword,
  onRevoke,
}: {
  userId: string;
  onResetPassword: (password: string) => Promise<void>;
  onRevoke: () => Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  void userId;

  return (
    <section className="surface-panel p-5">
      <p className="eyebrow">安全</p>
      <div className="mt-4 grid gap-3">
        <AdminField label="重置密码（至少 8 位）">
          <Input
            type="text"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </AdminField>
        <div className="flex gap-2">
          <Button
            type="button"
            className="h-9 px-4 text-text-muted disabled:opacity-45"
            disabled={busy || password.length < 8}
            onClick={() => {
              setBusy(true);
              void onResetPassword(password)
                .then(() => setPassword(""))
                .finally(() => setBusy(false));
            }}
          >
            重置密码
          </Button>
          <Button
            type="button"
            className="h-9 px-4 text-text-muted disabled:opacity-45"
            disabled={busy}
            onClick={() => {
              if (!window.confirm("强制该用户所有会话下线？")) return;
              setBusy(true);
              void onRevoke().finally(() => setBusy(false));
            }}
          >
            强制下线
          </Button>
        </div>
      </div>
    </section>
  );
}

function DangerSection({
  user,
  onArchive,
  onDeleteGenerations,
  onBan,
}: {
  user: AdminUserDetail;
  onArchive: (mode: "all" | "inactive") => Promise<void>;
  onDeleteGenerations: (mode: "all" | "failed") => Promise<void>;
  onBan: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  const guarded = (action: () => Promise<void>, message: string) => () => {
    if (!window.confirm(message)) return;
    setBusy(true);
    void action().finally(() => setBusy(false));
  };

  return (
    <section className="surface-panel border-danger/30 p-5">
      <p className="eyebrow text-danger">危险操作</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          type="button"
          className="h-9 px-3 text-xs text-text-muted disabled:opacity-45"
          disabled={busy}
          onClick={guarded(
            () => onArchive("inactive"),
            "归档该用户 30 天未活跃的对话？",
          )}
        >
          归档不活跃对话
        </Button>
        <Button
          type="button"
          className="h-9 px-3 text-xs text-text-muted disabled:opacity-45"
          disabled={busy}
          onClick={guarded(() => onArchive("all"), "归档该用户全部对话？")}
        >
          归档全部对话
        </Button>
        <Button
          type="button"
          className="h-9 px-3 text-xs text-text-muted disabled:opacity-45"
          disabled={busy}
          onClick={guarded(
            () => onDeleteGenerations("failed"),
            "删除该用户全部失败任务记录？",
          )}
        >
          删除失败任务
        </Button>
        <Button
          type="button"
          className="h-9 px-3 text-xs text-text-muted disabled:opacity-45"
          disabled={busy}
          onClick={guarded(
            () => onDeleteGenerations("all"),
            "删除该用户全部任务记录？",
          )}
        >
          删除全部任务
        </Button>
        {user.status === "ACTIVE" ? (
          <Button
            type="button"
            className="h-9 px-3 text-xs text-danger disabled:opacity-45"
            disabled={busy}
            onClick={guarded(onBan, `封禁用户 ${user.email}？`)}
          >
            封禁用户
          </Button>
        ) : null}
      </div>
    </section>
  );
}
