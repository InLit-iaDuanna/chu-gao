"use client";

import { useEffect, useState } from "react";

import { formatDate } from "@/lib/utils";

import { listAdminAudit } from "./lib/api";
import type { AuditEntry } from "./lib/types";
import { AdminPageHeader, AdminTable, EmptyPanel } from "./ui";

function diffPreview(diff: unknown): string {
  if (diff === null || diff === undefined) return "—";
  try {
    const text = JSON.stringify(diff);
    return text.length > 120 ? `${text.slice(0, 120)}…` : text;
  } catch {
    return "—";
  }
}

export function AuditView() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    listAdminAudit()
      .then(setEntries)
      .catch(() => setFailed(true));
  }, []);

  if (failed) return <EmptyPanel text="审计日志暂时不可用" />;
  if (!entries) return <div className="surface-panel h-64 animate-pulse" />;

  return (
    <div>
      <AdminPageHeader
        eyebrow="Audit"
        title="审计日志"
        description="最近 100 条管理操作"
      />

      {entries.length === 0 ? (
        <EmptyPanel text="暂无审计记录" />
      ) : (
        <AdminTable head={["时间", "操作者", "动作", "目标", "差异"]}>
          {entries.map((entry) => (
            <tr
              key={entry.id}
              className="border-b border-border/60 align-top last:border-0"
            >
              <td className="whitespace-nowrap px-4 py-2.5 text-xs text-text-muted">
                {formatDate(entry.createdAt)}
              </td>
              <td className="max-w-32 truncate px-4 py-2.5 font-mono text-xs">
                {entry.actorId}
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 text-xs">
                {entry.action}
              </td>
              <td className="max-w-40 truncate px-4 py-2.5 font-mono text-xs text-text-muted">
                {entry.target ?? "—"}
              </td>
              <td className="max-w-72 px-4 py-2.5">
                <p
                  className="line-clamp-2 font-mono text-[11px] leading-4 text-text-muted"
                  title={diffPreview(entry.diff)}
                >
                  {diffPreview(entry.diff)}
                </p>
              </td>
            </tr>
          ))}
        </AdminTable>
      )}
    </div>
  );
}
