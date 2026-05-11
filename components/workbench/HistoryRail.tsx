import Link from "next/link";

import { generationStatusLabel } from "@/components/workbench/status";
import { formatDate } from "@/lib/utils";

export function HistoryRail({
  items,
}: {
  items: Array<{
    id: string;
    prompt: string;
    status: string;
    createdAt: string;
  }>;
}) {
  return (
    <div className="surface-panel h-full p-3">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="eyebrow">历史</p>
          <h3 className="mt-1 text-base font-medium">最近任务</h3>
        </div>
        <Link href="/app/history" className="text-sm text-text-muted">
          查看全部
        </Link>
      </div>
      <div className="space-y-2">
        {items.map((item) => (
          <Link
            key={item.id}
            href={`/app/g/${item.id}`}
            className="surface-panel-soft block p-3 transition-colors hover:bg-surface-2"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-text-muted">
                {formatDate(item.createdAt)}
              </span>
              <span className="text-xs text-text-muted">
                {generationStatusLabel(item.status)}
              </span>
            </div>
            <p className="mt-2 line-clamp-3 text-sm leading-6">{item.prompt}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
