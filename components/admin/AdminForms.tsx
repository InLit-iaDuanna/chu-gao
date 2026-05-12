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

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("保存中...");

    try {
      await patchJson(`/api/admin/users/${user.id}`, {
        email,
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
    }
  }

  return (
    <form onSubmit={submit} className="surface-panel p-4">
      <p className="text-sm font-medium">账号资料与额度</p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
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
        <button className="tool-button h-10" type="submit">
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

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!window.confirm("确认重置该账号密码并强制旧登录失效？")) {
      return;
    }

    setMessage("重置中...");

    try {
      await postJson(`/api/admin/users/${userId}/password`, { password });
      setPassword("");
      setMessage("密码已重置");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "重置失败");
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
          placeholder="输入新密码"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <button className="tool-button h-10" type="submit">
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

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("处理中...");

    try {
      await postJson(`/api/admin/users/${userId}/credits`, { amount, note });
      setMessage("点数已更新");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作失败");
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
        <button className="tool-button h-10" type="submit">
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

  async function clearRecent() {
    if (!window.confirm(`确认清空最近 ${limit} 条生成记录展示？`)) {
      return;
    }

    setMessage("清空中...");

    try {
      await postJson("/api/admin/generations/clear-recent", { limit });
      setMessage("已清空");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "清空失败");
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

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("创建中...");

    try {
      await postJson("/api/admin/providers", {
        name,
        protocol,
        baseUrl,
        apiKey,
        priority,
        costMultiplier,
        modelsSupported: modelsText
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      });
      setMessage("渠道已创建，可继续添加下一个");
      setApiKey("");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "创建失败");
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
        <button className="tool-button h-10" type="submit">
          添加渠道
        </button>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          placeholder="渠道名称"
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
          value={modelsText}
          onChange={(event) => setModelsText(event.target.value)}
          list="provider-models"
        />
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm lg:col-span-2"
          placeholder="Base URL"
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
        />
        <input
          className="rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
          placeholder="API Key"
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

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("生成中...");

    try {
      await postJson("/api/admin/redemption-codes", { count, credits });
      setMessage("兑换码已生成");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "生成失败");
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
        <button className="tool-button h-10" type="submit">
          生成
        </button>
      </div>
      {message ? <p className="mt-3 text-sm text-text-muted">{message}</p> : null}
    </form>
  );
}

export function ProviderAccountImportForm({ providerId }: { providerId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [defaultMaxConcurrency, setDefaultMaxConcurrency] = useState(1);
  const [defaultWeight, setDefaultWeight] = useState(1);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("导入中...");

    try {
      await postJson(`/api/admin/providers/${providerId}/accounts/import`, {
        text,
        defaultMaxConcurrency,
        defaultWeight,
      });
      setText("");
      setMessage("账号已导入");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "导入失败");
    }
  }

  return (
    <form onSubmit={submit} className="surface-panel p-4">
      <p className="text-sm font-medium">批量导入账号</p>
      <p className="mt-1 text-xs leading-5 text-text-muted">
        每行格式：baseUrl apiKey maxConcurrency weight name。多个账号会按空闲并发槽和权重自动分配任务，429/5xx/超时会自动切换下一个账号。
      </p>
      <textarea
        className="mt-3 min-h-28 w-full rounded-[6px] border border-border bg-surface px-3 py-2 text-sm"
        placeholder="每行：baseUrl apiKey maxConcurrency weight name"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
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
        <button className="tool-button h-10" type="submit">
          导入
        </button>
      </div>
      <div className="mt-3 flex items-center gap-3">
        {message ? <span className="text-sm text-text-muted">{message}</span> : null}
      </div>
    </form>
  );
}

export function PricingRuleForm({ models }: { models: Array<{ id: string }> }) {
  const router = useRouter();
  const [modelId, setModelId] = useState(models[0]?.id ?? "");
  const [resolution, setResolution] = useState("1K");
  const [credits, setCredits] = useState(2);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
        <button className="tool-button h-10" type="submit">
          保存
        </button>
      </div>
      {message ? <p className="mt-3 text-sm text-text-muted">{message}</p> : null}
    </form>
  );
}
