export function CostPreview({
  estimate,
  credits,
  unavailable,
}: {
  estimate: number;
  credits: number;
  unavailable?: boolean;
}) {
  const insufficient = estimate > credits;

  if (unavailable) {
    return (
      <div className="shrink-0 rounded-[6px] border border-border bg-surface px-3 py-2 font-mono text-xs text-text-muted">
        余额暂时无法读取
      </div>
    );
  }

  return (
    <div className="shrink-0 rounded-[6px] border border-border bg-surface px-3 py-2 font-mono text-xs text-text-muted">
      消耗{" "}
      <span className={insufficient ? "text-danger" : "text-foreground"}>
        {estimate} 点
      </span>
      {" · "}
      余额 <span className="text-foreground">{credits} 点</span>
    </div>
  );
}
