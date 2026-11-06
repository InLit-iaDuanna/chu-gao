import Link from "next/link";

export interface AdminGenerationRecord {
  id: string;
  userId: string;
  user: {
    email: string;
    name?: string | null;
  };
  modelId: string;
  prompt: string;
  status: string;
  progress: number;
  provider?: { name: string } | null;
  providerId?: string | null;
  providerAccount?: { name: string | null; baseUrl: string } | null;
  providerAccountId?: string | null;
  costCredits: number;
  attempts: number;
  errorCode?: string | null;
  errorMessage?: string | null;
  createdAt: Date;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  images: Array<{
    id: string;
    width: number;
    height: number;
    sizeBytes: number;
    mimeType: string;
    createdAt: Date;
  }>;
}

const STATUS_DETAILS: Record<
  string,
  { label: string; description: string; className: string }
> = {
  PENDING: {
    label: "排队中",
    description: "任务已提交，正在等待生成服务接单",
    className: "admin-status-degraded",
  },
  RUNNING: {
    label: "生成中",
    description: "上游正在处理图片",
    className:
      "border-[rgb(var(--brand-primary)_/_0.35)] bg-[rgb(var(--brand-primary)_/_0.08)] text-[rgb(var(--brand-primary))]",
  },
  SUCCEEDED: {
    label: "生成成功",
    description: "图片已生成并保存",
    className: "admin-status-healthy",
  },
  FAILED: {
    label: "生成失败",
    description: "任务未产出图片，点数应已自动退回",
    className: "admin-status-down",
  },
  CANCELED: {
    label: "已取消",
    description: "任务已由用户或系统取消",
    className: "border-border bg-surface-2 text-text-muted",
  },
};

function formatDate(date: Date | null | undefined) {
  if (!date) return "-";

  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function formatDuration(
  start: Date | null | undefined,
  end: Date | null | undefined,
) {
  if (!start) return "-";

  const milliseconds = Math.max(
    0,
    (end ?? new Date()).getTime() - start.getTime(),
  );
  const seconds = Math.max(1, Math.round(milliseconds / 1000));
  if (seconds < 60) return `${seconds} 秒`;

  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes} 分 ${rest} 秒`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function statusDetails(generation: AdminGenerationRecord) {
  const details = STATUS_DETAILS[generation.status] ?? {
    label: generation.status,
    description: "状态由生成服务返回",
    className: "border-border bg-surface-2 text-text-muted",
  };

  if (generation.status === "RUNNING") {
    return {
      ...details,
      label: `生成中 ${Math.max(0, Math.min(100, generation.progress))}%`,
    };
  }

  if (generation.status === "SUCCEEDED") {
    return {
      ...details,
      description: `已保存 ${generation.images.length} 张图片`,
    };
  }

  return details;
}

export function GenerationRecordList({
  generations,
  compact = false,
}: {
  generations: AdminGenerationRecord[];
  compact?: boolean;
}) {
  if (generations.length === 0) {
    return (
      <div className="border border-dashed border-border px-4 py-10 text-center text-sm text-text-muted">
        没有符合条件的生成记录
      </div>
    );
  }

  return (
    <div
      className={`grid items-start gap-3 ${
        compact
          ? "md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
          : "sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
      }`}
    >
      {generations.map((generation) => {
        const status = statusDetails(generation);
        const queueDuration = formatDuration(
          generation.createdAt,
          generation.startedAt,
        );
        const runDuration = formatDuration(
          generation.startedAt,
          generation.finishedAt,
        );
        const totalDuration = formatDuration(
          generation.createdAt,
          generation.finishedAt,
        );

        return (
          <article
            key={generation.id}
            className="surface-panel-soft min-w-0 overflow-hidden border border-border"
          >
            <div className="flex min-w-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
              <span
                className={`admin-status ${status.className}`}
                title={status.description}
              >
                {status.label}
              </span>
              <time
                className="shrink-0 font-mono text-[10px] tabular-nums text-text-faint"
                dateTime={generation.createdAt.toISOString()}
                title={`生成时间：${formatDate(generation.createdAt)}`}
              >
                生成时间 {formatDate(generation.createdAt)}
              </time>
            </div>

            <div className="min-w-0 p-3 pb-0">
              <div
                className={`grid h-32 content-stretch gap-1 overflow-hidden rounded-[6px] bg-surface-2 ${
                  generation.images.length > 1 ? "grid-cols-2" : "grid-cols-1"
                }`}
              >
                {generation.images.length > 0 ? (
                  generation.images.map((image) => (
                    <a
                      key={image.id}
                      href={`/api/generations/${generation.id}/images/${image.id}`}
                      className="group block min-h-0 min-w-0 overflow-hidden border border-border bg-surface-2"
                      title={`打开原图 · ${image.width}×${image.height} · ${formatBytes(image.sizeBytes)}`}
                    >
                      {/* Admin thumbnails must be requested by the signed-in browser. */}
                      <img
                        src={`/api/generations/${generation.id}/images/${image.id}?variant=thumb`}
                        alt={generation.prompt.slice(0, 80)}
                        className="h-full w-full object-cover transition-opacity group-hover:opacity-90"
                        loading="lazy"
                      />
                    </a>
                  ))
                ) : (
                  <div className="flex h-32 items-center justify-center rounded-[6px] border border-dashed border-border bg-surface-2 px-3 text-center text-xs leading-5 text-text-faint">
                    {generation.status === "FAILED"
                      ? "本次任务没有产出图片"
                      : generation.status === "CANCELED"
                        ? "任务已取消"
                        : "图片生成中"}
                  </div>
                )}
              </div>

              <div className="min-w-0 space-y-2.5 py-3">
                <div className="flex min-w-0 items-center justify-between gap-2 text-xs text-text-muted">
                  <Link
                    href={`/admin/users/${generation.userId}`}
                    className="min-w-0 truncate font-medium text-foreground underline underline-offset-2"
                    title={generation.user.email}
                  >
                    {generation.user.email}
                  </Link>
                  <span className="shrink-0">{generation.costCredits} 点</span>
                </div>

                <p
                  className="line-clamp-2 min-h-10 break-words text-sm leading-5 text-foreground"
                  title={generation.prompt}
                >
                  {generation.prompt}
                </p>

                {generation.status === "FAILED" ? (
                  <div className="rounded-[6px] border border-[rgb(var(--danger)_/_0.35)] bg-[rgb(var(--danger)_/_0.08)] px-2.5 py-2">
                    <p className="truncate text-[11px] font-semibold text-[rgb(var(--danger))]">
                      {generation.errorCode || "失败原因"}
                    </p>
                    <p
                      className="mt-0.5 line-clamp-2 break-all text-xs leading-4 text-foreground"
                      title={generation.errorMessage ?? undefined}
                    >
                      {generation.errorMessage ||
                        "生成服务没有返回具体错误信息"}
                    </p>
                  </div>
                ) : null}

                <div className="flex min-w-0 items-center justify-between gap-2 text-[11px] text-text-faint">
                  <span className="truncate">{generation.modelId}</span>
                  <span className="shrink-0">总耗时 {totalDuration}</span>
                </div>
              </div>
            </div>

            <details className="admin-collapsible border-t border-border px-3 py-2">
              <summary className="text-xs font-medium text-text-muted">
                详细信息
              </summary>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <Metric
                  label="提交时间"
                  value={formatDate(generation.createdAt)}
                />
                <Metric
                  label="开始时间"
                  value={formatDate(generation.startedAt)}
                />
                <Metric
                  label="完成时间"
                  value={formatDate(generation.finishedAt)}
                />
                <Metric label="排队耗时" value={queueDuration} />
                <Metric
                  label={
                    generation.status === "RUNNING" ? "已运行" : "生成耗时"
                  }
                  value={runDuration}
                />
              </div>
              {generation.status === "FAILED" ? (
                <div className="mt-2 whitespace-pre-wrap break-all rounded-[6px] bg-[rgb(var(--danger)_/_0.08)] p-2 text-xs leading-5">
                  <strong>{generation.errorCode || "生成失败"}</strong>
                  <br />
                  {generation.errorMessage || "生成服务没有返回具体错误信息"}
                </div>
              ) : null}
              <div className="mt-2 space-y-1 break-all font-mono text-[10px] leading-4 text-text-faint">
                <p>ID：{generation.id}</p>
                <p>
                  渠道：
                  {generation.provider?.name ??
                    generation.providerId ??
                    "未分配"}
                </p>
                <p>
                  账号：
                  {generation.providerAccount?.name ??
                    generation.providerAccount?.baseUrl ??
                    generation.providerAccountId ??
                    "未分配"}
                </p>
                <p>尝试次数：{generation.attempts}</p>
              </div>
            </details>
          </article>
        );
      })}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="admin-metric min-w-0">
      <span className="admin-metric-label">{label}</span>
      <span className="admin-metric-value break-words text-xs">{value}</span>
    </div>
  );
}
