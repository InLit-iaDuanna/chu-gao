"use client";

import { Button, Input } from "@/components/ui";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { formatDate } from "@/lib/utils";

import {
  createAdminRedemptionCodes,
  isAdminApiError,
  listAdminRedemptionCodes,
  revokeAdminRedemptionCode,
} from "./lib/api";
import type { AdminRedemptionCode } from "./lib/types";
import {
  AdminField,
  AdminPageHeader,
  AdminTable,
  EmptyPanel,
  ErrorText,
} from "./ui";

export function RedemptionCodesView() {
  const [codes, setCodes] = useState<AdminRedemptionCode[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(() => {
    listAdminRedemptionCodes()
      .then(setCodes)
      .catch(() => setCodes([]));
  }, []);

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
      <AdminPageHeader eyebrow="Redemption" title="兑换码" />

      <CreateCodeForm
        onCreate={(input) =>
          run(() => createAdminRedemptionCodes(input), "兑换码已生成")
        }
      />

      <ErrorText message={error} />
      {notice ? <p className="mb-3 text-sm text-success">{notice}</p> : null}

      {!codes ? (
        <div className="surface-panel h-64 animate-pulse" />
      ) : codes.length === 0 ? (
        <EmptyPanel text="暂无兑换码" />
      ) : (
        <AdminTable
          head={[
            "兑换码",
            "点数",
            "用量",
            "过期时间",
            "状态",
            "创建时间",
            "操作",
          ]}
        >
          {codes.map((code) => {
            const expired =
              code.expiresAt !== null &&
              new Date(code.expiresAt).getTime() <= Date.now();
            const usedUp = code.usedCount >= code.maxUses;

            return (
              <tr
                key={code.id}
                className="border-b border-border/60 last:border-0"
              >
                <td className="px-4 py-2.5 font-mono text-xs">{code.code}</td>
                <td className="px-4 py-2.5 font-mono text-xs">
                  {code.credits}
                </td>
                <td className="px-4 py-2.5 font-mono text-xs">
                  {code.usedCount}/{code.maxUses}
                </td>
                <td className="px-4 py-2.5 text-xs text-text-muted">
                  {code.expiresAt ? formatDate(code.expiresAt) : "永不"}
                </td>
                <td className="px-4 py-2.5 text-xs">
                  {code.revokedAt ? (
                    <span className="text-danger">已撤销</span>
                  ) : expired ? (
                    <span className="text-text-faint">已过期</span>
                  ) : usedUp ? (
                    <span className="text-text-faint">已用完</span>
                  ) : (
                    <span className="text-success">有效</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-xs text-text-muted">
                  {formatDate(code.createdAt)}
                </td>
                <td className="px-4 py-2.5">
                  {!code.revokedAt && !usedUp ? (
                    <Button
                      type="button"
                      className="h-7 px-2 text-[11px] text-danger"
                      onClick={() =>
                        void run(
                          () => revokeAdminRedemptionCode(code.id),
                          "已撤销",
                        )
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

function CreateCodeForm({
  onCreate,
}: {
  onCreate: (input: {
    count: number;
    credits: number;
    maxUses?: number;
    note?: string;
    expiresAt?: string;
  }) => Promise<void>;
}) {
  const [form, setForm] = useState({
    count: 10,
    credits: 100,
    maxUses: 1,
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
            max={500}
            className="w-24"
            value={form.count}
            onChange={(event) =>
              setForm({ ...form, count: Number(event.target.value) })
            }
          />
        </AdminField>
        <AdminField label="每码点数">
          <Input
            type="number"
            min={1}
            className="w-28"
            value={form.credits}
            onChange={(event) =>
              setForm({ ...form, credits: Number(event.target.value) })
            }
          />
        </AdminField>
        <AdminField label="可用次数">
          <Input
            type="number"
            min={1}
            max={9999}
            className="w-24"
            value={form.maxUses}
            onChange={(event) =>
              setForm({ ...form, maxUses: Number(event.target.value) })
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
          disabled={busy || form.count < 1 || form.credits < 1}
          onClick={() => {
            setBusy(true);
            void onCreate({
              count: form.count,
              credits: form.credits,
              maxUses: form.maxUses,
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
