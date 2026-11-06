"use client";

import { Download, Monitor, RotateCcw, Unplug } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatDate } from "@/lib/utils";

import {
  listAgentAuthorizations,
  revokeAgentAuthorization,
  type AgentAuthorization,
} from "./api";

const authorizationStatusLabels = {
  active: "有效",
  expired: "已到期",
  revoked: "已撤销",
  invalidated: "已失效",
};

export function AgentAccessSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const [items, setItems] = useState<AgentAuthorization[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (state === "ready" && window.location.hash === "#agent") {
      sectionRef.current?.scrollIntoView({ block: "start" });
    }
  }, [state]);

  useEffect(() => {
    const controller = new AbortController();
    setState("loading");
    listAgentAuthorizations(controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setItems(data);
        setState("ready");
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "请稍后重试");
        setState("error");
      });
    return () => controller.abort();
  }, [attempt]);

  return (
    <section
      ref={sectionRef}
      id="agent"
      aria-labelledby="agent-heading"
      className="min-w-0 scroll-mt-6 border-t border-border pt-6"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="agent-heading" className="text-lg font-semibold">
          Agent 接入
        </h2>
        <Button asChild variant="secondary">
          <a href="/api/agent/skill" download>
            <Download size={16} aria-hidden="true" />
            下载 Skill
          </a>
        </Button>
      </header>

      {notice ? (
        <p role="status" className="mt-4 break-words text-sm text-success">
          {notice}
        </p>
      ) : null}

      {state === "loading" ? (
        <div
          role="status"
          aria-label="正在加载授权列表"
          className="mt-5 space-y-3"
        >
          <span className="sr-only">正在加载授权列表</span>
          <Skeleton className="h-16 w-full rounded-md" />
          <Skeleton className="h-16 w-full rounded-md" />
        </div>
      ) : state === "error" ? (
        <div className="py-5">
          <p role="alert" className="break-words text-sm text-danger">
            授权列表加载失败：{error}
          </p>
          <Button
            className="mt-3"
            onClick={() => setAttempt((value) => value + 1)}
          >
            <RotateCcw size={15} aria-hidden="true" />
            重试
          </Button>
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={Monitor} title="暂无授权客户端" />
      ) : (
        <ul aria-label="已授权客户端" className="mt-3 divide-y divide-border">
          {items.map((item) => {
            const status =
              item.status ??
              (item.revokedAt
                ? "revoked"
                : new Date(item.expiresAt).getTime() <= Date.now()
                  ? "expired"
                  : "active");
            const active = status === "active";
            return (
              <li
                key={item.id}
                className="grid min-w-0 gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-5"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <h3 className="min-w-0 break-words text-sm font-medium [overflow-wrap:anywhere]">
                      {item.clientName}
                    </h3>
                    <Badge
                      variant={active ? "success" : "outline"}
                      className="shrink-0"
                    >
                      {authorizationStatusLabels[status]}
                    </Badge>
                    <span className="text-xs text-text-muted">
                      {item.mode === "single" ? "单次任务" : "限时授权"}
                    </span>
                  </div>
                  <dl className="mt-3 grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
                    <div className="flex flex-wrap gap-x-2 gap-y-1">
                      <dt className="text-text-muted">到期时间</dt>
                      <dd>
                        <time dateTime={item.expiresAt}>
                          {formatDate(item.expiresAt)}
                        </time>
                      </dd>
                    </div>
                    <div className="flex flex-wrap gap-x-2 gap-y-1">
                      <dt className="text-text-muted">最近使用</dt>
                      <dd>
                        {item.lastUsedAt ? (
                          <time dateTime={item.lastUsedAt}>
                            {formatDate(item.lastUsedAt)}
                          </time>
                        ) : (
                          "尚未使用"
                        )}
                      </dd>
                    </div>
                  </dl>
                </div>
                {active ? (
                  <RevokeAuthorization
                    authorization={item}
                    onRevoked={() => {
                      setItems((current) =>
                        current.map((entry) =>
                          entry.id === item.id
                            ? {
                                ...entry,
                                status: "revoked" as const,
                                revokedAt: new Date().toISOString(),
                              }
                            : entry,
                        ),
                      );
                      setNotice(`${item.clientName} 的授权已撤销。`);
                    }}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function RevokeAuthorization({
  authorization,
  onRevoked,
}: {
  authorization: AgentAuthorization;
  onRevoked: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function revoke() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await revokeAgentAuthorization(authorization.id);
      setOpen(false);
      onRevoked();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "撤销失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (busy) return;
        setError("");
        setOpen(value);
      }}
    >
      <DialogTrigger>
        <Button
          variant="ghost"
          size="sm"
          className="justify-self-start sm:justify-self-end"
          aria-label={`撤销 ${authorization.clientName} 的授权`}
        >
          <Unplug size={15} aria-hidden="true" />
          撤销
        </Button>
      </DialogTrigger>
      <DialogContent hideClose={busy}>
        <DialogHeader>
          <DialogTitle className="tracking-normal">撤销授权</DialogTitle>
          <DialogDescription className="break-words [overflow-wrap:anywhere]">
            撤销后，{authorization.clientName} 将无法继续使用此授权。
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="break-words px-5 pb-4 text-sm text-danger">
            {error}
          </p>
        ) : null}
        <DialogFooter className="flex-wrap">
          <Button disabled={busy} onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button
            variant="danger"
            className="w-36"
            loading={busy}
            onClick={() => void revoke()}
          >
            <Unplug size={15} aria-hidden="true" />
            确认撤销
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
