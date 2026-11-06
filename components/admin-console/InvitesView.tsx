"use client";

import { Button, Input, Select } from "@/components/ui";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Loader2 } from "lucide-react";

import { formatDate } from "@/lib/utils";

import {
  createAdminInvites,
  isAdminApiError,
  listAdminInvites,
  revokeAdminInvite,
} from "./lib/api";
import type { AdminInvite } from "./lib/types";
import {
  AdminField,
  AdminPageHeader,
  AdminTable,
  EmptyPanel,
  ErrorText,
} from "./ui";

type StatusFilter = "" | "active" | "revoked" | "expired";

export function InvitesView() {
  const [invites, setInvites] = useState<AdminInvite[] | null>(null);
  const [status, setStatus] = useState<StatusFilter>("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [createdCodes, setCreatedCodes] = useState<string[]>([]);

  const reload = useCallback(() => {
    listAdminInvites(status || undefined)
      .then(setInvites)
      .catch(() => setInvites([]));
  }, [status]);

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

  return (
    <div>
      <AdminPageHeader eyebrow="Invites" title="邀请码" />

      <CreateInviteForm
        onCreate={(input) =>
          run(async () => {
            const created = await createAdminInvites(input);
            setCreatedCodes(created.map((invite) => invite.code));
          }, "邀请码已生成")
        }
      />

      {createdCodes.length > 0 ? (
        <div className="surface-panel mb-4 p-4">
          <p className="mb-2 text-sm font-medium">
            新生成（{createdCodes.length} 个）
          </p>
          <div className="flex flex-wrap gap-2">
            {createdCodes.map((code) => (
              <CopyableCode key={code} code={code} />
            ))}
          </div>
        </div>
      ) : null}

      <div className="mb-4 flex items-center gap-2">
        <Select
          aria-label="邀请状态"
          className="w-36"
          value={status || "all"}
          onValueChange={(value) =>
            setStatus(value === "all" ? "" : (value as StatusFilter))
          }
          options={[
            { value: "all", label: "全部" },
            { value: "active", label: "有效" },
            { value: "revoked", label: "已撤销" },
            { value: "expired", label: "已过期" },
          ]}
        />
      </div>

      <ErrorText message={error} />
      {notice ? <p className="mb-3 text-sm text-success">{notice}</p> : null}

      {!invites ? (
        <div className="surface-panel h-64 animate-pulse" />
      ) : invites.length === 0 ? (
        <EmptyPanel text="暂无邀请码" />
      ) : (
        <AdminTable
          head={[
            "邀请码",
            "用量",
            "初始点数",
            "过期时间",
            "状态",
            "创建时间",
            "操作",
          ]}
        >
          {invites.map((invite) => {
            const expired =
              invite.expiresAt !== null &&
              new Date(invite.expiresAt).getTime() <= Date.now();

            return (
              <tr
                key={invite.id}
                className="border-b border-border/60 last:border-0"
              >
                <td className="px-4 py-2.5">
                  <CopyableCode code={invite.code} />
                </td>
                <td className="px-4 py-2.5 font-mono text-xs">
                  {invite.usedCount}/{invite.maxUses}
                </td>
                <td className="px-4 py-2.5 font-mono text-xs">
                  {invite.initialCredits}
                </td>
                <td className="px-4 py-2.5 text-xs text-text-muted">
                  {invite.expiresAt ? formatDate(invite.expiresAt) : "永不"}
                </td>
                <td className="px-4 py-2.5 text-xs">
                  {invite.revokedAt ? (
                    <span className="text-danger">已撤销</span>
                  ) : expired ? (
                    <span className="text-text-faint">已过期</span>
                  ) : (
                    <span className="text-success">有效</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-xs text-text-muted">
                  {formatDate(invite.createdAt)}
                </td>
                <td className="px-4 py-2.5">
                  {!invite.revokedAt ? (
                    <Button
                      type="button"
                      className="h-7 px-2 text-[11px] text-danger"
                      onClick={() =>
                        void run(() => revokeAdminInvite(invite.id), "已撤销")
                      }
                    >
                      撤销
                    </Button>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </AdminTable>
      )}
    </div>
  );
}

function CopyableCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      type="button"
      className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 font-mono text-xs transition-colors hover:border-border-strong"
      onClick={() => {
        void navigator.clipboard.writeText(code).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      {copied ? (
        <Check className="h-3 w-3 text-success" />
      ) : (
        <Copy className="h-3 w-3 text-text-faint" />
      )}
      {code}
    </Button>
  );
}

function CreateInviteForm({
  onCreate,
}: {
  onCreate: (input: {
    count: number;
    maxUses?: number;
    initialCredits?: number;
    note?: string;
    expiresAt?: string;
  }) => Promise<void>;
}) {
  const [form, setForm] = useState({
    count: 5,
    maxUses: 1,
    initialCredits: 100,
    note: "",
    expiresAt: "",
  });
  const [busy, setBusy] = useState(false);

  return (
    <div className="surface-panel mb-6 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <AdminField label="数量">
          <Input
            type="number"
            min={1}
            max={200}
            className="w-24"
            value={form.count}
            onChange={(event) =>
              setForm({ ...form, count: Number(event.target.value) })
            }
          />
        </AdminField>
        <AdminField label="可用次数">
          <Input
            type="number"
            min={1}
            max={999}
            className="w-24"
            value={form.maxUses}
            onChange={(event) =>
              setForm({ ...form, maxUses: Number(event.target.value) })
            }
          />
        </AdminField>
        <AdminField label="初始点数">
          <Input
            type="number"
            min={0}
            className="w-28"
            value={form.initialCredits}
            onChange={(event) =>
              setForm({ ...form, initialCredits: Number(event.target.value) })
            }
          />
        </AdminField>
        <AdminField label="过期时间（可选）">
          <Input
            type="datetime-local"
            className="w-52"
            value={form.expiresAt}
            onChange={(event) =>
              setForm({ ...form, expiresAt: event.target.value })
            }
          />
        </AdminField>
        <AdminField label="备注（可选）">
          <Input
            className="w-44"
            value={form.note}
            onChange={(event) => setForm({ ...form, note: event.target.value })}
          />
        </AdminField>
        <Button
          type="button"
          className="h-9 px-4 text-text-muted disabled:opacity-45"
          disabled={busy || form.count < 1}
          onClick={() => {
            setBusy(true);
            void onCreate({
              count: form.count,
              maxUses: form.maxUses,
              initialCredits: form.initialCredits,
              note: form.note.trim() || undefined,
              expiresAt: form.expiresAt
                ? new Date(form.expiresAt).toISOString()
                : undefined,
            }).finally(() => setBusy(false));
          }}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          批量生成
        </Button>
      </div>
    </div>
  );
}
