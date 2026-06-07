import { ImageGallery } from "@/components/workbench/ImageGallery";
import type { GalleryImage } from "@/components/workbench/gallery-images";
import type { WorkbenchTaskStatus } from "@/components/workbench/types";

export function Canvas({
  images,
  status,
  error,
  selectedImageId,
  onSelectedImageIdChange,
}: {
  images?: GalleryImage[];
  status: WorkbenchTaskStatus;
  error?: string | null;
  selectedImageId?: string | null;
  onSelectedImageIdChange?: (imageId: string | null) => void;
  onUseExample?: (prompt: string) => void;
}) {
  const frameClass =
    "surface-panel canvas-panel flex min-h-[420px] items-center justify-center p-6 lg:min-h-0";

  const viewableImages =
    images?.filter((image) => image.src ?? image.url) ?? [];

  if (viewableImages.length === 0) {
    if (status === "pending" || status === "running") {
      const statusLabel = status === "pending" ? "排队中" : "生成中";

      return (
        <div className={frameClass}>
          <div className="max-w-sm text-center">
            <p className="eyebrow">{statusLabel}</p>
            <h3 className="mt-2 text-xl font-medium">正在处理画面</h3>
            <p className="mt-3 break-words text-sm leading-6 text-text-muted">
              任务已经提交到队列，完成后会自动刷新结果。
            </p>
          </div>
        </div>
      );
    }

    if (status === "failed") {
      return (
        <div className={frameClass}>
          <div className="max-w-sm text-center">
            <p className="eyebrow text-danger">失败</p>
            <h3 className="mt-2 text-xl font-medium">任务没有完成</h3>
            <p className="mt-3 break-words text-sm leading-6 text-text-muted">
              {error ??
                "生成没有完成。你可以调整描述、降低张数或稍后重新发送。"}
            </p>
          </div>
        </div>
      );
    }

    if (status === "canceled") {
      return (
        <div className={frameClass}>
          <div className="max-w-sm text-center">
            <p className="eyebrow">已取消</p>
            <h3 className="mt-2 text-xl font-medium">任务已取消</h3>
            <p className="mt-3 break-words text-sm leading-6 text-text-muted">
              如果任务还未开始，点数会退回到账户余额。
            </p>
          </div>
        </div>
      );
    }

    return (
      <div className={frameClass}>
        <div className="max-w-md text-center">
          <p className="eyebrow">画布</p>
          <h3 className="mt-2 text-xl font-medium">结果会出现在这里</h3>
          <p className="mt-3 break-words text-sm leading-6 text-text-muted">
            可以直接写目标图，也可以像对话一样补充用途、风格、构图、参考约束和需要避开的内容。生成后继续发送消息即可迭代同一张图。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="surface-panel canvas-panel img-enter relative min-h-[420px] overflow-hidden p-3 lg:min-h-0">
      <ImageGallery
        images={viewableImages}
        alt="生成结果"
        selectedIndex={Math.max(
          viewableImages.findIndex(
            (image) => image.id && image.id === selectedImageId,
          ),
          0,
        )}
        onSelectedIndexChange={(index) =>
          onSelectedImageIdChange?.(viewableImages[index]?.id ?? null)
        }
        statusLabel={
          status === "running"
            ? "生成中"
            : status === "failed"
              ? "失败"
              : status === "canceled"
                ? "已取消"
                : "已完成"
        }
      />
    </div>
  );
}
