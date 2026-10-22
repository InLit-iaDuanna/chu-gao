"use client";

import { ChevronDown, ChevronUp, Copy } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

const BASE_URL = "https://chugao.art/api/v1";

type PublicModel = {
  id: string;
  displayName: string;
  available: boolean;
  capabilities: {
    sizes: string[];
    qualities: string[];
    maxN: number;
    supportsReferenceImage: boolean;
    maxReferenceImages: number;
  };
  defaults: { size: string; quality: string };
};

const ENDPOINTS: [string, string, string][] = [
  ["GET", "/models", "可用模型及参数"],
  ["GET", "/me", "账户余额"],
  ["POST", "/generations", "提交生图任务"],
  ["GET", "/generations", "任务列表（分页，可按状态过滤）"],
  ["GET", "/generations/:id", "查询单个任务"],
  ["GET", "/generations/:id/images/:imageId", "下载图片（base64）"],
  ["POST", "/uploads", "上传参考图"],
];

const ERROR_CODES: [string, string, string][] = [
  ["UNAUTHORIZED", "401", "密钥无效、已撤销或已过期"],
  ["UNSUPPORTED_PARAM", "400", "参数不被该模型支持（如尺寸、数量）"],
  ["INSUFFICIENT_CREDITS", "402", "积分不足"],
  ["RATE_LIMITED", "429", "超出每分钟限速、并发上限或日上限，按 Retry-After 退避"],
  ["MODEL_NOT_AVAILABLE", "503", "模型暂无可用渠道，稍后重试"],
  ["IDEMPOTENCY_CONFLICT", "409", "同一 Idempotency-Key 提交了不同参数"],
];

const PYTHON_EXAMPLE = `import time, base64, requests

API_KEY  = "cgapi_your_key_here"
BASE_URL = "${BASE_URL}"
HEADERS  = {"Authorization": f"Bearer {API_KEY}"}

# 1. 提交任务（Idempotency-Key 可选：网络重试时不会重复扣费）
resp = requests.post(f"{BASE_URL}/generations", headers={
    **HEADERS, "Idempotency-Key": "job-0001",
}, json={
    "modelId": "gpt-image-2",
    "prompt":  "a cat wearing sunglasses",
    "size":    "1024x1024",
    "n": 1,
})
resp.raise_for_status()
gen_id = resp.json()["data"]["id"]

# 2. 轮询直到结束
while True:
    task = requests.get(f"{BASE_URL}/generations/{gen_id}", headers=HEADERS).json()["data"]
    if task["status"] in ("SUCCEEDED", "FAILED", "CANCELED"):
        break
    time.sleep(3)

# 3. 下载图片
if task["status"] == "SUCCEEDED":
    for i, image in enumerate(task["images"]):
        img = requests.get(
            f"{BASE_URL}/generations/{gen_id}/images/{image['id']}", headers=HEADERS
        ).json()["data"]
        open(f"output_{i}.png", "wb").write(base64.b64decode(img["b64_json"]))
else:
    print(task["errorCode"], task["errorMessage"])`;

export function ApiDocsSection() {
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
          <DocBlock title="鉴权与地址">
            <p className="mt-1 text-text-muted">
              所有请求带上 <Code>Authorization: Bearer cgapi_…</Code>，接口地址：
            </p>
            <CodeBlock code={BASE_URL} />
          </DocBlock>

          <DocBlock title="可用模型">
            <p className="mt-1 text-text-muted">
              提交时 <Code>modelId</Code> 填下表中的 ID 即可。上游渠道和出图模式由平台自动调度，失败会自动换渠道重试，调用方无需关心。
            </p>
            <ModelTable />
          </DocBlock>

          <DocBlock title="可用端点">
            <SimpleTable
              head={["方法", "路径", "说明"]}
              rows={ENDPOINTS}
              cellClass={["font-mono text-accent", "font-mono", ""]}
            />
          </DocBlock>

          <DocBlock title="提交生图任务">
            <p className="mt-1 text-text-muted">
              <Code>POST /generations</Code>，参数只有 <Code>modelId</Code> 和{" "}
              <Code>prompt</Code> 必填；<Code>size</Code>、<Code>quality</Code>、
              <Code>n</Code> 必须在该模型支持范围内。
            </p>
            <CodeBlock
              code={`{
  "modelId": "gpt-image-2",
  "prompt": "a futuristic cityscape at sunset",
  "size": "1024x1024",
  "quality": "high",
  "n": 1,
  "referenceImageKeys": ["<POST /uploads 返回的 key，可选>"]
}`}
            />
            <p className="mt-2 text-text-muted">
              响应 202。<Code>estimatedCredits</Code> 是本次实际冻结的积分：
            </p>
            <CodeBlock
              code={`{
  "ok": true,
  "data": {
    "id": "cmh…",
    "status": "PENDING",
    "estimatedCredits": 7
  }
}`}
            />
          </DocBlock>

          <DocBlock title="查询任务">
            <p className="mt-1 text-text-muted">
              轮询 <Code>GET /generations/:id</Code>，<Code>status</Code> 依次为{" "}
              <Code>PENDING</Code> → <Code>RUNNING</Code> →{" "}
              <Code>SUCCEEDED</Code> / <Code>FAILED</Code> / <Code>CANCELED</Code>。
            </p>
            <CodeBlock
              code={`{
  "ok": true,
  "data": {
    "id": "cmh…",
    "modelId": "gpt-image-2",
    "status": "SUCCEEDED",
    "progress": 100,
    "costCredits": 7,
    "errorCode": null,
    "errorMessage": null,
    "images": [{ "id": "cmi…", "width": 1024, "height": 1024, "mimeType": "image/png" }]
  }
}`}
            />
            <p className="mt-2 text-text-muted">
              丢了任务 ID？用 <Code>GET /generations?limit=50&amp;status=RUNNING</Code>{" "}
              找回（按创建时间倒序，最多 100 条/页，用返回的 <Code>nextCursor</Code>{" "}
              作为 <Code>cursor</Code> 翻页）。用 API Key 调用时只返回该 Key 提交的任务。
            </p>
          </DocBlock>

          <DocBlock title="下载图片">
            <p className="mt-1 text-text-muted">
              <Code>GET /generations/:id/images/:imageId</Code>，返回{" "}
              <Code>b64_json</Code>、<Code>mimeType</Code>、<Code>width</Code>、
              <Code>height</Code>。
            </p>
          </DocBlock>

          <DocBlock title="完整 Python 示例">
            <CodeBlock code={PYTHON_EXAMPLE} />
          </DocBlock>

          <DocBlock title="常见错误码">
            <SimpleTable
              head={["code", "HTTP", "含义"]}
              rows={ERROR_CODES}
              cellClass={["font-mono text-danger", "font-mono", ""]}
            />
          </DocBlock>

          <p className="text-xs text-text-muted">
            并发上限按账户设置，提交频率有每分钟上限；被限流时响应头带{" "}
            <Code>Retry-After</Code>，按此秒数退避重试即可。
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Live model table ─────────────────────────────────────────────────────────

function ModelTable() {
  const [models, setModels] = useState<PublicModel[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/public/models", { signal: controller.signal })
      .then((res) => res.json())
      .then((body: { ok: boolean; data?: PublicModel[] }) => {
        if (!body.ok || !body.data) throw new Error("bad response");
        setModels(body.data);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, []);

  if (failed) {
    return (
      <p className="mt-2 text-xs text-danger">
        模型列表加载失败，可直接调用 <Code>GET /models</Code> 获取。
      </p>
    );
  }

  if (!models) {
    return <div className="mt-2 h-24 animate-pulse rounded-md bg-foreground/[0.04]" />;
  }

  return (
    <div className="mt-2 overflow-x-auto rounded-md border border-border text-xs">
      <table className="w-full">
        <thead className="bg-foreground/[0.04]">
          <tr>
            {["modelId", "名称", "size", "quality", "n 上限", "参考图", "状态"].map(
              (h) => (
                <th key={h} className="whitespace-nowrap px-3 py-2 text-left font-medium">
                  {h}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {models.map((model) => (
            <tr key={model.id} className={cn(!model.available && "opacity-50")}>
              <td className="whitespace-nowrap px-3 py-2 font-mono text-accent">
                {model.id}
              </td>
              <td className="whitespace-nowrap px-3 py-2">{model.displayName}</td>
              <td className="px-3 py-2 font-mono text-text-muted">
                {model.capabilities.sizes.join(" / ")}
              </td>
              <td className="px-3 py-2 font-mono text-text-muted">
                {model.capabilities.qualities.join(" / ")}
              </td>
              <td className="px-3 py-2 font-mono text-text-muted">
                {model.capabilities.maxN}
              </td>
              <td className="px-3 py-2 text-text-muted">
                {model.capabilities.supportsReferenceImage
                  ? `≤ ${model.capabilities.maxReferenceImages}`
                  : "—"}
              </td>
              <td className="whitespace-nowrap px-3 py-2">
                {model.available ? (
                  <span className="text-success">可用</span>
                ) : (
                  <span className="text-text-faint">暂不可用</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Small building blocks ────────────────────────────────────────────────────

function DocBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="font-medium">{title}</h3>
      {children}
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="text-foreground">{children}</code>;
}

function SimpleTable({
  head,
  rows,
  cellClass,
}: {
  head: string[];
  rows: string[][];
  cellClass: string[];
}) {
  return (
    <div className="mt-2 overflow-x-auto rounded-md border border-border text-xs">
      <table className="w-full">
        <thead className="bg-foreground/[0.04]">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-3 py-2 text-left font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={row.join("|")}>
              {row.map((cell, i) => (
                <td
                  key={i}
                  className={cn("px-3 py-2", cellClass[i] || "text-text-muted")}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CodeBlock({ code }: { code: string }) {
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
