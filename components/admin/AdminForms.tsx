"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

async function requestJson(url: string, method: string, body: unknown) {
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;

  if (!response.ok) {
    throw new Error(payload?.error?.message ?? "操作失败");
  }

  return payload;
}

async function postJson(url: string, body: unknown) {
  return requestJson(url, "POST", body);
}

async function patchJson(url: string, body: unknown) {
  return requestJson(url, "PATCH", body);
}

function toDatetimeLocalValue(value: string | null | undefined) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

type ProviderAccountRecord = {
  id: string;
  name: string | null;
  baseUrl: string;
  apiKeyFingerprintMasked: string;
  priority: number;
  weight: number;
  maxConcurrency: number;
  inFlight: number;
  health: "HEALTHY" | "DEGRADED" | "DOWN";
  isActive: boolean;
  consecutiveErrors: number;
  cooldownUntil: string | null;
  dailyLimit: number | null;
  dailyUsed: number;
  note: string | null;
  lastErrorMsg: string | null;
  hasApiKey: boolean;
  isDefault: boolean;
};

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
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const canSubmit = email.trim().length > 0 && !isSubmitting;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    setIsSubmitting(true);
    setMessage("保存中...");

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
      setMessage("账号资料已更新");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="surface-panel p-4">
      <p className="text-sm font-medium">账号资料与额度</p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          placeholder="昵称"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <select
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          value={role}
          onChange={(event) => setRole(event.target.value as "USER" | "ADMIN")}
        >
          <option value="USER">USER</option>
          <option value="ADMIN">ADMIN</option>
        </select>
        <select
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          value={status}
          onChange={(event) =>
            setStatus(event.target.value as "ACTIVE" | "BANNED")
          }
        >
          <option value="ACTIVE">ACTIVE</option>
          <option value="BANNED">BANNED</option>
        </select>
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          type="number"
          min={1}
          max={1000}
          value={dailyGenLimit}
          onChange={(event) => setDailyGenLimit(Number(event.target.value))}
        />
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          type="number"
          min={1}
          max={20}
          value={concurrentLimit}
          onChange={(event) => setConcurrentLimit(Number(event.target.value))}
        />
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm md:col-span-2"
          placeholder="封禁/调整原因"
          value={bannedReason}
          onChange={(event) => setBannedReason(event.target.value)}
        />
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button className="tool-button h-10" type="submit" disabled={!canSubmit}>
          保存资料
        </button>
        {message ? <span className="text-sm text-text-muted">{message}</span> : null}
      </div>
    </form>
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
        <button className="tool-button h-10" type="submit" disabled={!canSubmit}>
          重置
        </button>
      </div>
      {message ? <p className="mt-3 text-sm text-text-muted">{message}</p> : null}
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
            run("归档全部会话", `/api/admin/users/${userId}/conversations/archive`, {
              mode: "all",
            })
          }
        >
          归档会话
        </button>
        <button
          className="tool-button h-10 text-danger"
          type="button"
          onClick={() =>
            run("软删除失败任务", `/api/admin/users/${userId}/generations/delete`, {
              mode: "failed",
            })
          }
        >
          删除失败任务
        </button>
        <button
          className="tool-button h-10 text-danger"
          type="button"
          onClick={() =>
            run("软删除全部任务", `/api/admin/users/${userId}/generations/delete`, {
              mode: "all",
            })
          }
        >
          删除全部任务
        </button>
      </div>
      {message ? <p className="mt-3 text-sm text-text-muted">{message}</p> : null}
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
        <button className="tool-button h-10" type="submit" disabled={!canSubmit}>
          保存
        </button>
      </div>
      {message ? <p className="mt-3 text-sm text-text-muted">{message}</p> : null}
    </form>
  );
}

export function DashboardRecentControls({ limit }: { limit: number }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [isClearing, setIsClearing] = useState(false);

  async function clearRecent() {
    if (isClearing) {
      return;
    }

    if (!window.confirm(`确认清空最近 ${limit} 条生成记录展示？`)) {
      return;
    }

    setIsClearing(true);
    setMessage("清空中...");

    try {
      await postJson("/api/admin/generations/clear-recent", { limit });
      setMessage("已清空");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "清空失败");
    } finally {
      setIsClearing(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <a
        className={`tool-button h-9 text-xs ${limit === 20 ? "text-foreground" : "text-text-muted"}`}
        href="/admin?recent=20"
      >
        最近 20
      </a>
      <a
        className={`tool-button h-9 text-xs ${limit === 100 ? "text-foreground" : "text-text-muted"}`}
        href="/admin?recent=100"
      >
        最近 100
      </a>
      <button
        className="tool-button h-9 text-xs text-danger"
        type="button"
        disabled={isClearing}
        onClick={clearRecent}
      >
        清空
      </button>
      {message ? <span className="text-xs text-text-muted">{message}</span> : null}
    </div>
  );
}

export function ProviderCreateForm({
  models,
}: {
  models: Array<{ id: string; protocol: string }>;
}) {
  const router = useRouter();
  const [name, setName] = useState("image2");
  const [protocol, setProtocol] = useState("OPENAI_IMAGES");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [priority, setPriority] = useState(100);
  const [costMultiplier, setCostMultiplier] = useState(1);
  const [modelsText, setModelsText] = useState("gpt-image-2");
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const normalizedModels = modelsText
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const canSubmit =
    name.trim().length > 0 &&
    protocol.trim().length > 0 &&
    baseUrl.trim().length > 0 &&
    apiKey.trim().length > 0 &&
    normalizedModels.length > 0 &&
    !isSubmitting;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    setIsSubmitting(true);
    setMessage("创建中...");

    try {
      await postJson("/api/admin/providers", {
        name: name.trim(),
        protocol,
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        priority,
        costMultiplier,
        modelsSupported: normalizedModels,
      });
      setMessage("渠道已创建，可继续添加下一个");
      setApiKey("");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "创建失败");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="surface-panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">新增渠道池</p>
          <p className="mt-1 text-xs text-text-muted">
            每个渠道会自动创建一个默认账号，后续可继续批量导入更多 API。
          </p>
        </div>
        <button className="tool-button h-10" type="submit" disabled={!canSubmit}>
          添加渠道
        </button>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          placeholder="渠道名称"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <select
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          value={protocol}
          onChange={(event) => setProtocol(event.target.value)}
        >
          <option value="OPENAI_IMAGES">OPENAI_IMAGES</option>
          <option value="OPENAI_RESPONSES_IMAGE">OPENAI_RESPONSES_IMAGE</option>
          <option value="GEMINI_IMAGE">GEMINI_IMAGE</option>
        </select>
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          placeholder="模型 ID，多个用逗号分隔"
          required
          value={modelsText}
          onChange={(event) => setModelsText(event.target.value)}
          list="provider-models"
        />
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm lg:col-span-2"
          placeholder="Base URL"
          required
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
        />
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          placeholder="API Key"
          required
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
        />
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          type="number"
          min={0}
          value={priority}
          onChange={(event) => setPriority(Number(event.target.value))}
        />
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          type="number"
          min={0.01}
          step={0.01}
          value={costMultiplier}
          onChange={(event) => setCostMultiplier(Number(event.target.value))}
        />
      </div>
      <datalist id="provider-models">
        {models.map((model) => (
          <option key={model.id} value={model.id} />
        ))}
      </datalist>
      {message ? <p className="mt-3 text-sm text-text-muted">{message}</p> : null}
    </form>
  );
}

export function RedemptionCodeCreateForm() {
  const router = useRouter();
  const [count, setCount] = useState(10);
  const [credits, setCredits] = useState(100);
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const canSubmit = count >= 1 && credits >= 1 && !isSubmitting;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    setIsSubmitting(true);
    setMessage("生成中...");

    try {
      await postJson("/api/admin/redemption-codes", { count, credits });
      setMessage("兑换码已生成");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "生成失败");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="surface-panel p-4">
      <p className="text-sm font-medium">批量生成点数兑换码</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-[120px_120px_auto]">
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          type="number"
          min={1}
          max={500}
          value={count}
          onChange={(event) => setCount(Number(event.target.value))}
        />
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          type="number"
          min={1}
          value={credits}
          onChange={(event) => setCredits(Number(event.target.value))}
        />
        <button className="tool-button h-10" type="submit" disabled={!canSubmit}>
          生成
        </button>
      </div>
      {message ? <p className="mt-3 text-sm text-text-muted">{message}</p> : null}
    </form>
  );
}

export function InviteCodeCreateForm() {
  const router = useRouter();
  const [count, setCount] = useState(10);
  const [maxUses, setMaxUses] = useState(1);
  const [initialCredits, setInitialCredits] = useState(100);
  const [expiresAt, setExpiresAt] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const canSubmit =
    count >= 1 &&
    count <= 200 &&
    maxUses >= 1 &&
    initialCredits >= 0 &&
    !isSubmitting;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    setIsSubmitting(true);
    setMessage("生成中...");

    try {
      await postJson("/api/admin/invites", {
        count,
        maxUses,
        initialCredits,
        note: note.trim() || undefined,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
      });
      setMessage("邀请码已生成");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "生成失败");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="surface-panel p-4">
      <p className="text-sm font-medium">批量生成邀请码</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[120px_120px_140px_210px_minmax(180px,1fr)_auto]">
        <label className="grid gap-1">
          <span className="field-label">数量</span>
          <input
            className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
            type="number"
            min={1}
            max={200}
            value={count}
            onChange={(event) => setCount(Number(event.target.value))}
          />
        </label>
        <label className="grid gap-1">
          <span className="field-label">可用次数</span>
          <input
            className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
            type="number"
            min={1}
            max={999}
            value={maxUses}
            onChange={(event) => setMaxUses(Number(event.target.value))}
          />
        </label>
        <label className="grid gap-1">
          <span className="field-label">初始点数</span>
          <input
            className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
            type="number"
            min={0}
            value={initialCredits}
            onChange={(event) => setInitialCredits(Number(event.target.value))}
          />
        </label>
        <label className="grid gap-1">
          <span className="field-label">过期时间</span>
          <input
            className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
            type="datetime-local"
            value={expiresAt}
            onChange={(event) => setExpiresAt(event.target.value)}
          />
        </label>
        <label className="grid gap-1">
          <span className="field-label">备注</span>
          <input
            className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
            placeholder="可选"
            maxLength={200}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        <button className="tool-button h-10" type="submit" disabled={!canSubmit}>
          生成
        </button>
      </div>
      {message ? <p className="mt-3 text-sm text-text-muted">{message}</p> : null}
    </form>
  );
}

export function ProviderAccountImportForm({ providerId }: { providerId: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"csv" | "lines">("csv");
  const [text, setText] = useState("");
  const [csvText, setCsvText] = useState("");
  const [defaultMaxConcurrency, setDefaultMaxConcurrency] = useState(1);
  const [defaultWeight, setDefaultWeight] = useState(1);
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const sourceText = mode === "csv" ? csvText : text;
  const canSubmit = sourceText.trim().length > 0 && !isSubmitting;

  async function loadFile(file: File | null) {
    if (!file) {
      return;
    }

    const content = await file.text();
    setMode("csv");
    setCsvText(content);
    setMessage(`已载入 ${file.name}`);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    setIsSubmitting(true);
    setMessage("导入中...");

    try {
      const payload = (await postJson(
        `/api/admin/providers/${providerId}/accounts/import`,
        {
          mode,
          text: mode === "lines" ? text.trim() : undefined,
          csvText: mode === "csv" ? csvText.trim() : undefined,
          defaultMaxConcurrency,
          defaultWeight,
        },
      )) as {
        data?: { created: number; skipped: number; failed: number };
      };
      setText("");
      setCsvText("");
      setMessage(
        payload.data
          ? `已导入 ${payload.data.created}，跳过 ${payload.data.skipped}，失败 ${payload.data.failed}`
          : "账号已导入",
      );
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "导入失败");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="surface-panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">批量导入账号</p>
          <p className="mt-1 text-xs leading-5 text-text-muted">
            CSV 直接支持 `name,status,api_key,id,error`；高级模式保留逐行导入。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className={`tool-button h-9 ${mode === "csv" ? "" : "text-text-muted"}`}
            type="button"
            onClick={() => setMode("csv")}
          >
            CSV
          </button>
          <button
            className={`tool-button h-9 ${mode === "lines" ? "" : "text-text-muted"}`}
            type="button"
            onClick={() => setMode("lines")}
          >
            逐行
          </button>
        </div>
      </div>
      {mode === "csv" ? (
        <div className="mt-3 space-y-3">
          <input
            className="block w-full text-sm text-text-muted file:mr-4 file:rounded-[6px] file:border-0 file:bg-surface-2 file:px-3 file:py-2 file:text-sm"
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => {
              void loadFile(event.target.files?.[0] ?? null);
              event.currentTarget.value = "";
            }}
          />
          <textarea
            className="min-h-32 w-full rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
            placeholder="粘贴 CSV 内容，列头包含 name,status,api_key,id,error"
            required
            value={csvText}
            onChange={(event) => setCsvText(event.target.value)}
          />
        </div>
      ) : (
        <textarea
          className="mt-3 min-h-28 w-full rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          placeholder="每行：baseUrl apiKey maxConcurrency weight name"
          required
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      )}
      <div className="mt-3 grid gap-3 sm:grid-cols-[160px_160px_auto]">
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          type="number"
          min={1}
          max={100}
          value={defaultMaxConcurrency}
          onChange={(event) =>
            setDefaultMaxConcurrency(Number(event.target.value))
          }
          aria-label="默认并发"
        />
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          type="number"
          min={1}
          max={100}
          value={defaultWeight}
          onChange={(event) => setDefaultWeight(Number(event.target.value))}
          aria-label="默认权重"
        />
        <button className="tool-button h-10" type="submit" disabled={!canSubmit}>
          导入
        </button>
      </div>
      <div className="mt-3 flex items-center gap-3">
        {message ? <span className="text-sm text-text-muted">{message}</span> : null}
        {!message && sourceText ? (
          <span className="text-xs text-text-muted">
            待处理 {sourceText.split(/\r?\n/).filter(Boolean).length} 行
          </span>
        ) : null}
      </div>
    </form>
  );
}

export function ProviderAccountCreateForm({
  providerId,
  defaultBaseUrl,
}: {
  providerId: string;
  defaultBaseUrl: string;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState(defaultBaseUrl);
  const [apiKey, setApiKey] = useState("");
  const [priority, setPriority] = useState(0);
  const [weight, setWeight] = useState(1);
  const [maxConcurrency, setMaxConcurrency] = useState(1);
  const [dailyLimit, setDailyLimit] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const canSubmit =
    baseUrl.trim().length > 0 && apiKey.trim().length > 0 && !isSubmitting;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    setIsSubmitting(true);
    setMessage("添加中...");

    try {
      await postJson(`/api/admin/providers/${providerId}/accounts`, {
        name: name.trim() || undefined,
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        priority,
        weight,
        maxConcurrency,
        dailyLimit: dailyLimit.trim() ? Number(dailyLimit) : undefined,
        note: note.trim() || undefined,
      });
      setName("");
      setApiKey("");
      setDailyLimit("");
      setNote("");
      setMessage("账号已添加");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "添加失败");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="surface-panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">新增池内账号</p>
          <p className="mt-1 text-xs text-text-muted">
            账号名称用于后台识别，前台会自动显示为动物通道代称。
          </p>
        </div>
        <button className="tool-button h-10" type="submit" disabled={!canSubmit}>
          添加账号
        </button>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          placeholder="账号名称（如 imagegen-021）"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm lg:col-span-2"
          placeholder="Base URL"
          required
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
        />
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm lg:col-span-3"
          placeholder="API Key"
          required
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
        />
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          type="number"
          min={0}
          value={priority}
          onChange={(event) => setPriority(Number(event.target.value))}
        />
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          type="number"
          min={1}
          max={100}
          value={weight}
          onChange={(event) => setWeight(Number(event.target.value))}
        />
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          type="number"
          min={1}
          max={100}
          value={maxConcurrency}
          onChange={(event) => setMaxConcurrency(Number(event.target.value))}
        />
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          type="number"
          min={1}
          placeholder="每日限额（可空）"
          value={dailyLimit}
          onChange={(event) => setDailyLimit(event.target.value)}
        />
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm lg:col-span-2"
          placeholder="备注"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>
      {message ? <p className="mt-3 text-sm text-text-muted">{message}</p> : null}
    </form>
  );
}

export function ProviderAccountEditForm({
  providerId,
  account,
}: {
  providerId: string;
  account: ProviderAccountRecord;
}) {
  const router = useRouter();
  const [name, setName] = useState(account.name ?? "");
  const [baseUrl, setBaseUrl] = useState(account.baseUrl);
  const [apiKey, setApiKey] = useState("");
  const [priority, setPriority] = useState(account.priority);
  const [weight, setWeight] = useState(account.weight);
  const [maxConcurrency, setMaxConcurrency] = useState(account.maxConcurrency);
  const [dailyLimit, setDailyLimit] = useState(
    account.dailyLimit ? String(account.dailyLimit) : "",
  );
  const [note, setNote] = useState(account.note ?? "");
  const [isActive, setIsActive] = useState(account.isActive);
  const [health, setHealth] = useState(account.health);
  const [cooldownUntil, setCooldownUntil] = useState(
    toDatetimeLocalValue(account.cooldownUntil),
  );
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function save() {
    setIsSubmitting(true);
    setMessage("保存中...");

    try {
      await patchJson(`/api/admin/providers/${providerId}/accounts/${account.id}`, {
        name: name.trim() || null,
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim() || undefined,
        priority,
        weight,
        maxConcurrency,
        dailyLimit: dailyLimit.trim() ? Number(dailyLimit) : null,
        note: note.trim() || null,
        isActive,
        health,
        cooldownUntil: cooldownUntil
          ? new Date(cooldownUntil).toISOString()
          : null,
      });
      setApiKey("");
      setMessage("账号已更新");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function testAccount() {
    setIsSubmitting(true);
    setMessage("测试中...");

    try {
      await postJson(`/api/admin/providers/${providerId}/accounts/${account.id}/test`, {});
      setMessage("测试通过");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "测试失败");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function quickPatch(body: unknown, successMessage: string) {
    setIsSubmitting(true);
    setMessage("处理中...");

    try {
      await patchJson(`/api/admin/providers/${providerId}/accounts/${account.id}`, body);
      setMessage(successMessage);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作失败");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <details className="surface-panel p-4" open={account.health !== "HEALTHY"}>
      <summary className="cursor-pointer list-none">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium">
                {account.name || account.baseUrl}
              </p>
              {account.isDefault ? (
                <span className="rounded-full bg-surface-2 px-2 py-1 text-[11px] text-text-muted">
                  默认账号
                </span>
              ) : null}
              <span className="rounded-full bg-surface-2 px-2 py-1 text-[11px] text-text-muted">
                指纹 {account.apiKeyFingerprintMasked}
              </span>
            </div>
            <p className="mt-1 break-all text-xs text-text-muted">{account.baseUrl}</p>
          </div>
          <div className="grid gap-1 text-right text-xs text-text-muted">
            <span>
              {account.isActive ? "启用" : "停用"} · {account.health}
            </span>
            <span>
              并发 {account.inFlight}/{account.maxConcurrency}
            </span>
            <span>今日 {account.dailyUsed}/{account.dailyLimit ?? "∞"}</span>
          </div>
        </div>
      </summary>
      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          placeholder="账号名称（如 imagegen-021）"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm lg:col-span-2"
          placeholder="Base URL"
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
        />
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm lg:col-span-3"
          placeholder="留空则不改 API Key"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
        />
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          type="number"
          min={0}
          value={priority}
          onChange={(event) => setPriority(Number(event.target.value))}
        />
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          type="number"
          min={1}
          max={100}
          value={weight}
          onChange={(event) => setWeight(Number(event.target.value))}
        />
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          type="number"
          min={1}
          max={100}
          value={maxConcurrency}
          onChange={(event) => setMaxConcurrency(Number(event.target.value))}
        />
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          type="number"
          min={1}
          placeholder="每日限额"
          value={dailyLimit}
          onChange={(event) => setDailyLimit(event.target.value)}
        />
        <select
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          value={health}
          onChange={(event) =>
            setHealth(event.target.value as ProviderAccountRecord["health"])
          }
        >
          <option value="HEALTHY">HEALTHY</option>
          <option value="DEGRADED">DEGRADED</option>
          <option value="DOWN">DOWN</option>
        </select>
        <label className="flex items-center gap-2 rounded-[6px] border border-border bg-surface px-3 py-2 text-sm">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(event) => setIsActive(event.target.checked)}
          />
          启用账号
        </label>
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm lg:col-span-2"
          type="datetime-local"
          value={cooldownUntil}
          onChange={(event) => setCooldownUntil(event.target.value)}
        />
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm lg:col-span-3"
          placeholder="备注"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>
      <div className="mt-3 grid gap-2 text-xs text-text-muted sm:grid-cols-2 lg:grid-cols-4">
        <span>错误次数 {account.consecutiveErrors}</span>
        <span>有无密钥 {account.hasApiKey ? "有" : "无"}</span>
        <span>最近错误 {account.lastErrorMsg ?? "-"}</span>
        <span>冷却至 {account.cooldownUntil ?? "-"}</span>
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          className="tool-button h-10"
          type="button"
          disabled={isSubmitting}
          onClick={() => void save()}
        >
          保存账号
        </button>
        <button
          className="tool-button h-10 text-text-muted"
          type="button"
          disabled={isSubmitting}
          onClick={() => void testAccount()}
        >
          测试
        </button>
        <button
          className="tool-button h-10 text-text-muted"
          type="button"
          disabled={isSubmitting}
          onClick={() =>
            void quickPatch(
              {
                health: "HEALTHY",
                isActive: true,
                cooldownUntil: null,
                consecutiveErrors: 0,
              },
              "已清冷却并恢复健康",
            )
          }
        >
          清冷却
        </button>
        <button
          className="tool-button h-10 text-danger"
          type="button"
          disabled={isSubmitting}
          onClick={() =>
            void quickPatch(
              account.isActive
                ? { isActive: false, health: "DOWN" }
                : {
                    isActive: true,
                    health: "HEALTHY",
                    cooldownUntil: null,
                    consecutiveErrors: 0,
                  },
              account.isActive ? "账号已停用" : "账号已恢复",
            )
          }
        >
          {account.isActive ? "停用" : "恢复"}
        </button>
      </div>
      {message ? <p className="mt-3 text-sm text-text-muted">{message}</p> : null}
    </details>
  );
}

export function PricingRuleForm({ models }: { models: Array<{ id: string }> }) {
  const router = useRouter();
  const [modelId, setModelId] = useState(models[0]?.id ?? "");
  const [resolution, setResolution] = useState("1K");
  const [credits, setCredits] = useState(2);
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const canSubmit =
    models.length > 0 && modelId.trim().length > 0 && Number.isFinite(credits) && !isSubmitting;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    setIsSubmitting(true);
    setMessage("保存中...");

    try {
      await postJson("/api/admin/pricing", {
        modelId,
        resolution: resolution || null,
        credits,
        priority: 10,
      });
      setMessage("定价已保存");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="surface-panel p-4">
      <p className="text-sm font-medium">新增定价规则</p>
      <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_120px_120px_auto]">
        <select
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          value={modelId}
          onChange={(event) => setModelId(event.target.value)}
        >
          {models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.id}
            </option>
          ))}
        </select>
        <select
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          value={resolution}
          onChange={(event) => setResolution(event.target.value)}
        >
          <option value="">全部</option>
          <option value="1K">1K</option>
          <option value="2K">2K</option>
          <option value="4K">4K</option>
        </select>
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          type="number"
          min={0}
          value={credits}
          onChange={(event) => setCredits(Number(event.target.value))}
        />
        <button className="tool-button h-10" type="submit" disabled={!canSubmit}>
          保存
        </button>
      </div>
      {message ? <p className="mt-3 text-sm text-text-muted">{message}</p> : null}
    </form>
  );
}
