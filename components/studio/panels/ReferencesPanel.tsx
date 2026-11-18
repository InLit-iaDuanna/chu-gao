"use client";

import { useEffect, useState } from "react";

import { IconButton } from "@/components/ui";

import { Input } from "@/components/ui";

import {
  Bookmark,
  ImagePlus,
  Images,
  LoaderCircle,
  Plus,
  X,
} from "lucide-react";

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
      <div className="flex h-full min-w-0 flex-col items-center justify-center gap-3 p-6 text-center tracking-normal">
        <Images size={18} className="text-text-faint" />
        <p className="text-sm leading-6 text-text-muted">
          当前模型不支持参考图
        </p>
      </div>
    );
  }

  return (
    <div className="h-full min-w-0 overflow-y-auto p-3 text-sm tracking-normal">
      <div className="flex flex-wrap gap-3">
        {references.map((item) => (
          <span
            key={item.key}
            className="group relative block h-24 w-24 overflow-hidden rounded-md border border-border bg-surface-2"
          >
            <img
              src={item.previewUrl}
              alt="参考图"
              className="h-full w-full object-contain"
            />
            <span className="absolute bottom-1 left-1 rounded-md border border-border bg-surface px-1.5 py-0.5 text-xs text-text-muted">
              {item.kind === "upload" ? "上传" : "生成"}
            </span>
            <IconButton
              variant="secondary"
              type="button"
              aria-label="移除参考图"
              title="移除参考图"
              onClick={() => onRemove(item.key)}
              className="absolute right-1 top-1 h-11 w-11 rounded-md sm:h-9 sm:w-9"
            >
              <X size={16} />
            </IconButton>
          </span>
        ))}

        <label
          className={cn(
            "flex h-24 w-24 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border text-text-muted transition-colors focus-within:ring-2 focus-within:ring-brand",
            full
              ? "cursor-not-allowed opacity-40"
              : "cursor-pointer hover:border-border-strong hover:text-foreground",
          )}
          title={full ? `最多 ${maxReferences} 张` : "上传参考图"}
        >
          <ImagePlus size={16} />
          <span className="text-xs">
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
        <p className="mt-3 text-xs leading-5 text-text-muted">
          参考图会随下一次生成一起提交；也可以在历史生成上点「用作参考图」添加。
        </p>
      ) : null}

      <div className="mt-4 border-t border-border pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm font-medium text-text-muted">
            <Bookmark size={16} /> 收藏参考图库
          </p>
          <span className="text-xs tabular-nums text-text-muted">
            {bookmarked.length} 张
          </span>
        </div>
        {libraryLoading ? (
          <div className="flex min-h-20 items-center justify-center gap-2 text-xs text-text-muted">
            <LoaderCircle size={16} className="animate-spin" /> 正在读取收藏
          </div>
        ) : bookmarked.length ? (
          <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(min(100%,80px),1fr))] gap-2">
            {bookmarked.slice(0, 30).map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={full}
                onClick={() => onUseBookmarked(item.id)}
                title={`加入参考图：${item.postTitle}`}
                className="group relative min-w-0 overflow-hidden rounded-md border border-border bg-surface-2 focus-visible:outline-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-40"
              >
                <img
                  src={item.previewUrl}
                  alt={item.postTitle}
                  className="aspect-square w-full object-contain"
                />
                <span className="absolute right-1 top-1 flex h-9 w-9 items-center justify-center rounded-md border border-border bg-surface text-foreground opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-visible:opacity-100">
                  <Plus size={16} />
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-xs leading-5 text-text-muted">
            在灵感圈收藏带图内容后，会出现在这里。
          </p>
        )}
      </div>
    </div>
  );
}
