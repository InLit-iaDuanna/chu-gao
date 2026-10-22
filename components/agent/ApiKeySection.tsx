"use client";

import { Copy, Eye, EyeOff, Key, Plus, Trash2, RotateCcw } from "lucide-react";
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
import { Input } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatDate } from "@/lib/utils";

import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  type ApiKey,
} from "./apiKeyApi";

const MAX_KEYS = 10;

export function ApiKeySection() {
  const sectionRef = useRef<HTMLElement>(null);
  const [items, setItems] = useState<ApiKey[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [newKey, setNewKey] = useState<string | null>(null);

  useEffect(() => {
    if (state === "ready" && window.location.hash === "#apikeys") {
      sectionRef.current?.scrollIntoView({ block: "start" });
    }
  }, [state]);

  useEffect(() => {
    const controller = new AbortController();
    setState("loading");
    listApiKeys(controller.signal)
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

  const handleRevoke = async (id: string) => {
    try {
      await revokeApiKey(id);
      setItems((prev) => prev.filter((k) => k.id !== id));
      setNotice("API key 已撤销");
      setTimeout(() => setNotice(""), 3000);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "撤销失败");
      setTimeout(() => setNotice(""), 4000);
    }
  };

  const handleCreated = (key: string, record: ApiKey) => {
    setItems((prev) => [record, ...prev]);
    setNewKey(key);
  };

  return (
    <section ref={sectionRef} id="apikeys" className="surface-panel p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow">开发者</p>
          <h2 className="mt-2 text-xl font-semibold">API 密钥</h2>
          <p className="mt-1 text-sm text-text-muted">
            用于直接调用图像生成 API，支持高并发接入。
          </p>
        </div>
        {state === "ready" && items.length < MAX_KEYS && (
          <CreateKeyDialog onCreated={handleCreated} />
        )}
      </div>

      {notice && (
        <p className="mt-4 rounded-lg bg-[oklch(var(--accent)/_0.1)] px-4 py-2 text-sm text-accent">
          {notice}
        </p>
      )}

      {newKey && (
        <NewKeyBanner
          value={newKey}
          onDismiss={() => setNewKey(null)}
        />
      )}

      <div className="mt-6">
        {state === "loading" && (
          <div className="space-y-3">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        )}

        {state === "error" && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-sm text-text-muted">{error}</p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setAttempt((n) => n + 1)}
            >
              <RotateCcw className="mr-2 h-3.5 w-3.5" />
              重试
            </Button>
          </div>
        )}

        {state === "ready" && items.length === 0 && (
          <EmptyState
            icon={Key}
            title="暂无 API 密钥"
            description="创建一个密钥，在你的应用中直接调用生图 API。"
            action={<CreateKeyDialog onCreated={handleCreated} />}
          />
        )}

        {state === "ready" && items.length > 0 && (
          <ul className="divide-y divide-border">
            {items.map((item) => (
              <ApiKeyRow
                key={item.id}
                item={item}
                onRevoke={handleRevoke}
              />
            ))}
          </ul>
        )}

        {state === "ready" && items.length >= MAX_KEYS && (
          <p className="mt-4 text-center text-xs text-text-muted">
            已达上限（{MAX_KEYS} 个），撤销旧密钥后可继续创建。
          </p>
        )}
      </div>
    </section>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function NewKeyBanner({
  value,
  onDismiss,
}: {
  value: string;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [visible, setVisible] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
      <p className="mb-2 text-sm font-medium text-amber-600 dark:text-amber-400">
        请立即复制密钥，离开页面后将无法再次查看。
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 rounded-lg bg-surface px-3 py-2 font-mono text-xs tracking-wide break-all">
          {visible ? value : `${value.slice(0, 12)}${"•".repeat(24)}`}
        </code>
        <button
          type="button"
          aria-label={visible ? "隐藏密钥" : "显示密钥"}
          onClick={() => setVisible((v) => !v)}
          className="tool-button h-8 w-8 shrink-0"
        >
          {visible ? (
            <EyeOff className="h-3.5 w-3.5" />
          ) : (
            <Eye className="h-3.5 w-3.5" />
          )}
        </button>
        <button
          type="button"
          aria-label="复制密钥"
          onClick={copy}
          className="tool-button h-8 w-8 shrink-0"
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mt-3 flex items-center justify-between">
        {copied && (
          <span className="text-xs text-green-600 dark:text-green-400">
            已复制
          </span>
        )}
        <button
          type="button"
          onClick={onDismiss}
          className="ml-auto text-xs text-text-muted underline-offset-2 hover:underline"
        >
          我已保存，关闭提示
        </button>
      </div>
    </div>
  );
}

function ApiKeyRow({
  item,
  onRevoke,
}: {
  item: ApiKey;
  onRevoke: (id: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);

  const isExpired = item.expiresAt && new Date(item.expiresAt) < new Date();

  return (
    <li className="flex items-center gap-4 py-4">
      <Key className="h-4 w-4 shrink-0 text-text-muted" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{item.name}</span>
          {isExpired && (
            <Badge variant="outline" className="text-xs text-text-muted">
              已过期
            </Badge>
          )}
        </div>
        <p className="mt-0.5 font-mono text-xs text-text-muted">
          {item.keyPrefix}••••••••
        </p>
        <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-text-muted">
          <span>创建于 {formatDate(item.createdAt)}</span>
          {item.lastUsedAt && (
            <span>最近使用 {formatDate(item.lastUsedAt)}</span>
          )}
          {item.usedCredits > 0 && (
            <span>消耗 {item.usedCredits.toFixed(2)} 点</span>
          )}
        </div>
      </div>

      {confirming ? (
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs text-text-muted">确认撤销？</span>
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              onRevoke(item.id);
              setConfirming(false);
            }}
          >
            撤销
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setConfirming(false)}
          >
            取消
          </Button>
        </div>
      ) : (
        <button
          type="button"
          aria-label={`撤销 ${item.name}`}
          onClick={() => setConfirming(true)}
          className="tool-button h-8 w-8 shrink-0 text-text-muted hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </li>
  );
}

function CreateKeyDialog({
  onCreated,
}: {
  onCreated: (key: string, record: ApiKey) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError("");
    try {
      const { key, ...record } = await createApiKey({ name: name.trim() });
      onCreated(key, record);
      setName("");
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "创建失败，请重试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger>
        <Button size="sm">
          <Plus className="mr-2 h-3.5 w-3.5" />
          新建密钥
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>新建 API 密钥</DialogTitle>
            <DialogDescription>
              密钥只在创建时显示一次，请立即保存到安全位置。
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4">
            <label
              htmlFor="key-name"
              className="mb-1.5 block text-sm font-medium"
            >
              名称
            </label>
            <Input
              id="key-name"
              placeholder="例如：生产环境、测试脚本"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={64}
              required
              autoFocus
            />
            {error && (
              <p className="mt-2 text-xs text-destructive" role="alert">
                {error}
              </p>
            )}
          </div>

          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(false)}
            >
              取消
            </Button>
            <Button type="submit" disabled={submitting || !name.trim()}>
              {submitting ? "创建中…" : "创建"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
