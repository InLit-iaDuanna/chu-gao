export function ConfigEditor({
  entries,
}: {
  entries: ReadonlyArray<{ key: string; value: unknown }>;
}) {
  return (
    <div className="surface-panel grid gap-4 p-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="space-y-2">
        {entries.map((entry) => (
          <div
            key={entry.key}
            className="rounded-[6px] border border-border px-3 py-2 text-sm text-text-muted"
          >
            {entry.key}
          </div>
        ))}
      </aside>
      <div className="surface-panel-soft p-4">
        <p className="text-sm text-text-muted">系统配置编辑器</p>
        <p className="mt-2 text-lg font-semibold">运行配置</p>
        <p className="mt-3 text-sm leading-6 text-text-muted">
          这里展示注册、点数、并发和内容审核相关配置。修改配置会写入审计记录。
        </p>
      </div>
    </div>
  );
}
