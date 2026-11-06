"use client";

import { Input, Select } from "@/components/ui";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Search } from "lucide-react";

import { formatDate } from "@/lib/utils";

import { listAdminUsers } from "./lib/api";
import type { AdminUserSummary } from "./lib/types";
import { AdminPageHeader, AdminTable, EmptyPanel } from "./ui";

export function UsersView() {
  const router = useRouter();
  const [users, setUsers] = useState<AdminUserSummary[] | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);

    const timer = window.setTimeout(() => {
      listAdminUsers({
        q: q.trim() || undefined,
        status: status || undefined,
      })
        .then((data) => {
          if (!cancelled) setUsers(data);
        })
        .catch(() => {
          if (!cancelled) setFailed(true);
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [q, status]);

  return (
    <div>
      <AdminPageHeader eyebrow="Users" title="用户" />

      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
          <Input
            className="pl-8"
            placeholder="搜索邮箱 / 昵称"
            value={q}
            onChange={(event) => setQ(event.target.value)}
          />
        </div>
        <Select
          aria-label="用户状态"
          className="w-36"
          value={status || "all"}
          onValueChange={(value) => setStatus(value === "all" ? "" : value)}
          options={[
            { value: "all", label: "全部状态" },
            { value: "ACTIVE", label: "正常" },
            { value: "BANNED", label: "封禁" },
          ]}
        />
      </div>

      {failed ? (
        <EmptyPanel text="用户列表暂时不可用，请稍后刷新" />
      ) : !users ? (
        <div className="surface-panel h-64 animate-pulse" />
      ) : users.length === 0 ? (
        <EmptyPanel text="没有匹配的用户" />
      ) : (
        <AdminTable
          head={["邮箱", "昵称", "角色", "状态", "点数", "日限", "注册时间"]}
        >
          {users.map((user) => (
            <tr
              key={user.id}
              className="cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-surface-2"
              onClick={() => router.push(`/admin/users/${user.id}`)}
            >
              <td className="px-4 py-2.5">{user.email}</td>
              <td className="px-4 py-2.5 text-text-muted">
                {user.name ?? "—"}
              </td>
              <td className="px-4 py-2.5">
                {user.role === "ADMIN" ? (
                  <span className="text-xs font-medium text-accent">
                    管理员
                  </span>
                ) : (
                  <span className="text-xs text-text-muted">用户</span>
                )}
                {user.role === "ADMIN" || user.materialInboxBeta ? (
                  <span className="ml-2 text-xs text-text-muted">
                    素材收件箱
                  </span>
                ) : null}
              </td>
              <td className="px-4 py-2.5">
                {user.status === "ACTIVE" ? (
                  <span className="text-xs text-success">正常</span>
                ) : (
                  <span className="text-xs text-danger">封禁</span>
                )}
              </td>
              <td className="px-4 py-2.5 font-mono">{user.credits}</td>
              <td className="px-4 py-2.5 font-mono text-text-muted">
                {user.dailyGenLimit ?? "不限"}
              </td>
              <td className="px-4 py-2.5 text-xs text-text-muted">
                {formatDate(user.createdAt)}
              </td>
            </tr>
          ))}
        </AdminTable>
      )}
    </div>
  );
}
