import Link from "next/link";

export function DashboardGenerationFilters({
  q,
  status,
  from,
  to,
}: {
  q?: string;
  status?: string;
  from?: string;
  to?: string;
}) {
  return (
    <form className="grid w-full gap-3 lg:grid-cols-[minmax(220px,1fr)_150px_150px_150px_auto_auto]">
      <label className="min-w-0">
        <span className="sr-only">搜索生成记录</span>
        <input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="用户邮箱、任务 ID 或提示词"
          className="h-10 w-full rounded-[6px] border border-border bg-surface px-3 text-sm outline-none focus:border-[rgb(var(--brand-primary))]"
        />
      </label>
      <label>
        <span className="sr-only">筛选状态</span>
        <select
          name="status"
          defaultValue={status ?? ""}
          className="h-10 w-full rounded-[6px] border border-border bg-surface px-3 text-sm outline-none focus:border-[rgb(var(--brand-primary))]"
        >
          <option value="">全部状态</option>
          <option value="PENDING">排队中</option>
          <option value="RUNNING">生成中</option>
          <option value="SUCCEEDED">生成成功</option>
          <option value="FAILED">生成失败</option>
          <option value="CANCELED">已取消</option>
        </select>
      </label>
      <label>
        <span className="sr-only">开始日期</span>
        <input
          type="date"
          name="from"
          defaultValue={from ?? ""}
          aria-label="开始日期"
          className="h-10 w-full rounded-[6px] border border-border bg-surface px-3 text-sm outline-none focus:border-[rgb(var(--brand-primary))]"
        />
      </label>
      <label>
        <span className="sr-only">结束日期</span>
        <input
          type="date"
          name="to"
          defaultValue={to ?? ""}
          aria-label="结束日期"
          className="h-10 w-full rounded-[6px] border border-border bg-surface px-3 text-sm outline-none focus:border-[rgb(var(--brand-primary))]"
        />
      </label>
      <button
        type="submit"
        className="h-10 rounded-[6px] bg-foreground px-4 text-sm font-medium text-background"
      >
        查询
      </button>
      <Link
        href="/admin"
        className="tool-button h-10 justify-center text-sm text-text-muted"
      >
        重置
      </Link>
    </form>
  );
}
