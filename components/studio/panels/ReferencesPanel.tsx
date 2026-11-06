"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui";

import { Input } from "@/components/ui";

import { Bookmark, ImagePlus, Images, LoaderCircle, Plus, X } from "lucide-react";

import { cn } from "@/lib/utils";

import type { ReferenceItem } from "../CommandDock";
import { listBookmarkedReferences } from "../lib/api";
import type { BookmarkedReferenceItem, ModelInfo } from "../lib/types";

interface ReferencesPanelProps {
  model: ModelInfo | null;
  references: ReferenceItem[];
  onUploadFile: (file: File) => void;
  onRemove: (key: string) => void;
  onUseBookmarked: (mediaId: string) => void;
}

/** 参考图面板：管理当前随提示词一起提交的参考图。 */
export function ReferencesPanel({
  model,
  references,
  onUploadFile,
  onRemove,
  onUseBookmarked,
}: ReferencesPanelProps) {
  const [bookmarked, setBookmarked] = useState<BookmarkedReferenceItem[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const supportsReference = model?.capabilities.supportsReferenceImage ?? false;
  const maxReferences = model?.capabilities.maxReferenceImages ?? 0;
  const full = references.length >= maxReferences;

  useEffect(() => {
    listBookmarkedReferences()
      .then((data) => setBookmarked(data.items))
      .catch(() => setBookmarked([]))
      .finally(() => setLibraryLoading(false));
  }, []);

  if (!supportsReference) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <Images size={18} className="text-text-faint" />
        <p className="text-xs text-text-muted">当前模型不支持参考图</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-2.5">
      <div className="flex flex-wrap gap-2">
        {references.map((item) => (
          <span
            key={item.key}
            className="group relative block h-16 w-16 overflow-hidden rounded-md border border-border"
          >
            <img
              src={item.previewUrl}
              alt="参考图"
              className="h-full w-full object-cover"
            />
            <span className="absolute left-0 top-0 rounded-br-md bg-background/80 px-1 py-px text-[9px] text-text-muted">
              {item.kind === "upload" ? "上传" : "生成"}
            </span>
            <Button
              variant="ghost"
              type="button"
              aria-label="移除参考图"
              onClick={() => onRemove(item.key)}
              className="absolute inset-0 flex items-center justify-center bg-background/70 p-0 text-foreground opacity-0 transition-opacity group-hover:opacity-100"
            >
              <X size={14} />
            </Button>
          </span>
        ))}

        <label
          className={cn(
            "flex h-16 w-16 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border text-text-faint transition-colors",
            full
              ? "cursor-not-allowed opacity-40"
              : "cursor-pointer hover:border-border-strong hover:text-foreground",
          )}
          title={full ? `最多 ${maxReferences} 张` : "上传参考图"}
        >
          <ImagePlus size={16} />
          <span className="text-[9px]">
            {references.length}/{maxReferences}
          </span>
          <Input
            type="file"
            className="sr-only"
            accept="image/png,image/jpeg,image/webp"
            disabled={full}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onUploadFile(file);
              event.target.value = "";
            }}
          />
        </label>
      </div>

      {references.length === 0 ? (
        <p className="mt-2.5 text-[11px] leading-4 text-text-faint">
          参考图会随下一次生成一起提交；也可以在历史生成上点「用作参考图」添加。
        </p>
      ) : null}

      <div className="mt-4 border-t border-border pt-3">
        <div className="flex items-center justify-between gap-2"><p className="flex items-center gap-1.5 text-[11px] font-medium text-text-muted"><Bookmark size={12} /> 收藏参考图库</p><span className="font-mono text-[9px] text-text-faint">{bookmarked.length} 张</span></div>
        {libraryLoading ? <div className="flex min-h-20 items-center justify-center gap-1.5 text-[10px] text-text-faint"><LoaderCircle size={12} className="animate-spin" /> 正在读取收藏</div> : bookmarked.length ? <div className="mt-2 grid grid-cols-3 gap-1.5">{bookmarked.slice(0, 30).map((item) => <button key={item.id} type="button" disabled={full} onClick={() => onUseBookmarked(item.id)} title={`加入参考图：${item.postTitle}`} className="group relative overflow-hidden rounded-md border border-border bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"><img src={item.previewUrl} alt={item.postTitle} className="aspect-square w-full object-cover" /><span className="absolute inset-0 flex items-center justify-center bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"><Plus size={14} /></span></button>)}</div> : <p className="mt-2 text-[10px] leading-4 text-text-faint">在灵感圈收藏带图内容后，会出现在这里。</p>}
      </div>
    </div>
  );
}
