"use client";

import {
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  EyeOff,
  Key,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
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
import { cn, formatDate } from "@/lib/utils";

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
      setNotice("API 密钥已撤销");
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
    <section
      ref={sectionRef}
      id="apikeys"
      aria-labelledby="apikeys-heading"
      className="min-w-0 scroll-mt-6 border-t border-border pt-6"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="apikeys-heading" className="text-lg font-semibold">
            API 密钥
          </h2>
          <p className="mt-0.5 text-sm text-text-muted">
            用于服务端直接调用图像生成 API，支持高并发接入。
          </p>
        </div>
        {state === "ready" && items.length < MAX_KEYS && (
          <CreateKeyDialog onCreated={handleCreated} />
        )}
      </header>

      {notice && (
        <p role="status" className="mt-4 break-words text-sm text-success">
          {notice}
        </p>
      )}

      {newKey && (
        <NewKeyBanner value={newKey} onDismiss={() => setNewKey(null)} />
      )}

      <div className="mt-5">
        {state === "loading" && (
          <div role="status" aria-label="正在加载密钥列表" className="space-y-3">
            <span className="sr-only">正在加载密钥列表</span>
            <Skeleton className="h-14 w-full rounded-md" />
            <Skeleton className="h-14 w-full rounded-md" />
          </div>
        )}

        {state === "error" && (
          <div className="py-5">
            <p role="alert" className="break-words text-sm text-danger">
              密钥列表加载失败：{error}
            </p>
            <Button
              className="mt-3"
              onClick={() => setAttempt((n) => n + 1)}
            >
              <RotateCcw size={15} aria-hidden="true" />
              重试
            </Button>
          </div>
        )}

        {state === "ready" && items.length === 0 && (
          <EmptyState
            icon={Key}
            title="暂无 API 密钥"
            description="创建一个密钥，在应用中直接调用生图 API。"
            action={<CreateKeyDialog onCreated={handleCreated} />}
          />
        )}

        {state === "ready" && items.length > 0 && (
          <>
            <ul
              aria-label="API 密钥列表"
              className="divide-y divide-border"
            >
              {items.map((item) => (
                <ApiKeyRow key={item.id} item={item} onRevoke={handleRevoke} />
              ))}
            </ul>

            {items.length >= MAX_KEYS && (
              <p className="mt-3 text-center text-xs text-text-muted">
                已达上限（{MAX_KEYS} 个），撤销旧密钥后可继续创建。
              </p>
            )}
          </>
        )}
      </div>

      <ApiDocsSection />
    </section>
  );
}

// ─── New key banner ───────────────────────────────────────────────────────────

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
    <div
      role="alert"
      className="mt-4 rounded-lg border border-warning/30 bg-warning/[0.06] px-4 py-3"
    >
      <p className="text-sm font-medium text-warning">
        请立即复制密钥，关闭后将无法再次查看。
      </p>
      <div className="mt-2 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md bg-foreground/[0.05] px-3 py-1.5 font-mono text-xs">
          {visible ? value : `${value.slice(0, 14)}${"•".repeat(20)}`}
        </code>
        <button
          type="button"
          aria-label={visible ? "隐藏密钥" : "显示密钥"}
          onClick={() => setVisible((v) => !v)}
          className="shrink-0 rounded p-1.5 text-text-muted hover:bg-foreground/[0.06] hover:text-foreground"
        >
          {visible ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
        <button
          type="button"
          aria-label="复制密钥"
          onClick={copy}
          className={cn(
            "shrink-0 rounded p-1.5 hover:bg-foreground/[0.06]",
            copied ? "text-success" : "text-text-muted hover:text-foreground",
          )}
        >
          <Copy size={14} />
        </button>
      </div>
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={onDismiss}
          className="text-xs text-text-muted underline-offset-2 hover:text-foreground hover:underline"
        >
          已保存，关闭提示
        </button>
      </div>
    </div>
  );
}

// ─── Key row ─────────────────────────────────────────────────────────────────

function ApiKeyRow({
  item,
  onRevoke,
}: {
  item: ApiKey;
  onRevoke: (id: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const isExpired =
    item.expiresAt != null && new Date(item.expiresAt) < new Date();

  return (
    <li className="flex items-center gap-3 py-3.5">
      <Key
        size={15}
        className="shrink-0 text-text-muted"
        aria-hidden="true"
      />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{item.name}</span>
          {isExpired && (
            <Badge variant="warning" className="text-xs">
              已过期
            </Badge>
          )}
        </div>

        <div className="mt-0.5 flex flex-wrap gap-x-4 text-xs text-text-muted">
          <span className="font-mono">{item.keyPrefix}••••••••</span>
          <span>创建 {formatDate(item.createdAt)}</span>
          {item.lastUsedAt && (
            <span>最近使用 {formatDate(item.lastUsedAt)}</span>
          )}
          {item.usedCredits > 0 && (
            <span>已用 {item.usedCredits.toFixed(2)} 点</span>
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
          aria-label={`撤销密钥 ${item.name}`}
          onClick={() => setConfirming(true)}
          className="shrink-0 rounded p-1.5 text-text-muted hover:bg-danger/10 hover:text-danger"
        >
          <Trash2 size={14} aria-hidden="true" />
        </button>
      )}
    </li>
  );
}

// ─── Create dialog ────────────────────────────────────────────────────────────

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
        <Button variant="secondary">
          <Plus size={15} aria-hidden="true" />
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
              <p className="mt-2 text-xs text-danger" role="alert">
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

// ─── API docs section ─────────────────────────────────────────────────────────

function ApiDocsSection() {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-6 rounded-lg border border-border">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="api-docs-body"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium hover:bg-foreground/[0.03]"
      >
        <span>调用说明 &amp; 示例</span>
        {open ? (
          <ChevronUp size={15} className="text-text-muted" />
        ) : (
          <ChevronDown size={15} className="text-text-muted" />
        )}
      </button>

      {open && (
        <div
          id="api-docs-body"
          className="space-y-6 border-t border-border px-4 pb-5 pt-4 text-sm"
        >
          {/* Auth */}
          <div>
            <h3 className="font-medium">鉴权方式</h3>
            <p className="mt-1 text-text-muted">
              将密钥放在请求头 <code className="text-foreground">Authorization</code> 中，格式为 Bearer：
            </p>
            <CodeBlock
              code={`Authorization: Bearer cgapi_xxxxxxxxxxxxxxxx`}
            />
          </div>

          {/* Base URL */}
          <div>
            <h3 className="font-medium">接口地址</h3>
            <CodeBlock code={`https://chugao.art/api/v1`} />
          </div>

          {/* Endpoints table */}
          <div>
            <h3 className="font-medium">可用端点</h3>
            <div className="mt-2 overflow-x-auto rounded-md border border-border text-xs">
              <table className="w-full">
                <thead className="bg-foreground/[0.04]">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">方法</th>
                    <th className="px-3 py-2 text-left font-medium">路径</th>
                    <th className="px-3 py-2 text-left font-medium">说明</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {[
                    ["GET", "/me", "查询账户余额"],
                    ["POST", "/generations", "提交生图任务"],
                    ["GET", "/generations/:id", "查询任务状态"],
                    ["GET", "/generations/:id/images/:imageId", "获取图片（base64）"],
                    ["POST", "/uploads", "上传参考图"],
                  ].map(([method, path, desc]) => (
                    <tr key={path}>
                      <td className="px-3 py-2 font-mono text-accent">
                        {method}
                      </td>
                      <td className="px-3 py-2 font-mono text-text-muted">
                        {path}
                      </td>
                      <td className="px-3 py-2 text-text-muted">{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Submit generation */}
          <div>
            <h3 className="font-medium">提交生图任务</h3>
            <p className="mt-1 text-text-muted">
              <code className="text-foreground">POST /api/v1/generations</code>
            </p>
            <CodeBlock
              language="json"
              code={`{
  "modelId": "nano-banana-2",
  "prompt": "a futuristic cityscape at sunset",
  "size": "1024x1024",
  "n": 1
}`}
            />
            <p className="mt-2 text-text-muted">响应（202）：</p>
            <CodeBlock
              language="json"
              code={`{
  "ok": true,
  "data": {
    "id": "gen_xxxxxxxx",
    "status": "PENDING"
  }
}`}
            />
          </div>

          {/* Poll */}
          <div>
            <h3 className="font-medium">查询任务状态</h3>
            <p className="mt-1 text-text-muted">
              轮询 <code className="text-foreground">GET /api/v1/generations/:id</code>，直到{" "}
              <code className="text-foreground">status</code> 变为{" "}
              <code className="text-foreground">DONE</code> 或{" "}
              <code className="text-foreground">FAILED</code>。
            </p>
            <CodeBlock
              language="json"
              code={`{
  "ok": true,
  "data": {
    "id": "gen_xxxxxxxx",
    "status": "DONE",
    "images": [{ "id": "img_yyyyyyyy" }]
  }
}`}
            />
          </div>

          {/* Download */}
          <div>
            <h3 className="font-medium">获取图片</h3>
            <p className="mt-1 text-text-muted">
              <code className="text-foreground">
                GET /api/v1/generations/:id/images/:imageId
              </code>
            </p>
            <CodeBlock
              language="json"
              code={`{
  "ok": true,
  "data": {
    "b64_json": "<base64>",
    "mimeType": "image/png",
    "width": 1024,
    "height": 1024
  }
}`}
            />
          </div>

          {/* Complete example */}
          <div>
            <h3 className="font-medium">完整 Python 示例</h3>
            <CodeBlock
              language="python"
              code={`import time, base64, requests

API_KEY  = "cgapi_your_key_here"
BASE_URL = "https://chugao.art/api/v1"
HEADERS  = {"Authorization": f"Bearer {API_KEY}"}

# 1. 提交任务
resp = requests.post(f"{BASE_URL}/generations", json={
    "modelId": "nano-banana-2",
    "prompt":  "a cat wearing sunglasses",
    "size":    "1024x1024",
}, headers=HEADERS)
gen_id = resp.json()["data"]["id"]

# 2. 轮询直到完成
while True:
    status = requests.get(f"{BASE_URL}/generations/{gen_id}", headers=HEADERS).json()
    if status["data"]["status"] == "DONE":
        break
    time.sleep(2)

# 3. 下载图片
image_id = status["data"]["images"][0]["id"]
img_resp  = requests.get(f"{BASE_URL}/generations/{gen_id}/images/{image_id}", headers=HEADERS)
img_bytes = base64.b64decode(img_resp.json()["data"]["b64_json"])
open("output.png", "wb").write(img_bytes)`}
            />
          </div>

          {/* Error codes */}
          <div>
            <h3 className="font-medium">常见错误码</h3>
            <div className="mt-2 overflow-x-auto rounded-md border border-border text-xs">
              <table className="w-full">
                <thead className="bg-foreground/[0.04]">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">code</th>
                    <th className="px-3 py-2 text-left font-medium">HTTP</th>
                    <th className="px-3 py-2 text-left font-medium">含义</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {[
                    ["UNAUTHORIZED", "401", "密钥无效或缺失"],
                    ["KEY_REVOKED", "401", "密钥已撤销"],
                    ["KEY_EXPIRED", "401", "密钥已过期"],
                    ["INSUFFICIENT_CREDITS", "402", "余额不足"],
                    ["CONTENT_REJECTED", "422", "内容被安全策略拦截"],
                    ["PROVIDER_UNAVAILABLE", "503", "上游服务暂时不可用，稍后重试"],
                  ].map(([code, http, desc]) => (
                    <tr key={code}>
                      <td className="px-3 py-2 font-mono text-danger">{code}</td>
                      <td className="px-3 py-2 font-mono text-text-muted">{http}</td>
                      <td className="px-3 py-2 text-text-muted">{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-xs text-text-muted">
            并发上限默认 10，限速时响应头会包含{" "}
            <code className="text-foreground">Retry-After</code>，按此值退避重试即可。
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Code block ───────────────────────────────────────────────────────────────

function CodeBlock({
  code,
  language,
}: {
  code: string;
  language?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative mt-2 rounded-md border border-border bg-foreground/[0.03]">
      <pre className="overflow-x-auto px-3 py-3 font-mono text-xs leading-relaxed text-foreground">
        {code}
      </pre>
      <button
        type="button"
        aria-label="复制代码"
        onClick={copy}
        className={cn(
          "absolute right-2 top-2 rounded p-1 text-text-muted hover:bg-foreground/[0.08] hover:text-foreground",
          copied && "text-success",
        )}
      >
        <Copy size={12} />
      </button>
    </div>
  );
}
