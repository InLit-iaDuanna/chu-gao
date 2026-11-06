import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Download, Share2 } from "lucide-react";

import { downloadImageUrl } from "@/components/canvas/gallery-images";
import { friendlyErrorMessage } from "@/components/shared/error-copy";
import { ImageGallery } from "@/components/studio/ImageGallery";
import { CopyTextButton } from "@/components/studio/CopyTextButton";
import {
  generationStatusLabel,
  generationStatusTone,
} from "@/components/studio/lib/status";
import { StudioPageShell } from "@/components/studio/StudioPageShell";
import { checkSessionFromHeaders } from "@/lib/auth";
import { db } from "@/lib/db";
import { serializeGeneration } from "@/lib/generations";
import { getProviderChannelDisplayNameMap } from "@/lib/provider-channel-config";
import { isDatabaseUnavailableError } from "@/lib/service-errors";
import { formatDate } from "@/lib/utils";

async function getGeneration(id: string) {
  const sessionResult = await checkSessionFromHeaders(await headers());

  if (sessionResult.status !== "authenticated" || !process.env.DATABASE_URL) {
    return { status: "unavailable" as const };
  }

  try {
    const row = await db.generation.findFirst({
      where: {
        id,
        userId: sessionResult.user.id,
        deletedAt: null,
      },
      include: {
        images: true,
        provider: {
          select: { id: true, name: true },
        },
        providerAccount: {
          select: { id: true, name: true, baseUrl: true },
        },
      },
    });

    if (!row) {
      return { status: "not_found" as const };
    }

    const displayNameMap = await getProviderChannelDisplayNameMap();

    return {
      status: "found" as const,
      generation: serializeGeneration(row, { displayNameMap }),
    };
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      return { status: "unavailable" as const };
    }

    throw error;
  }
}

export default async function GenerationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await getGeneration(id);

  if (result.status === "unavailable") {
    return (
      <StudioPageShell eyebrow="Task" title="生成详情" wide>
        <div className="surface-panel flex min-h-72 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
          <h2 className="text-xl font-medium">生成详情暂不可用</h2>
          <p className="max-w-md text-sm leading-6 text-text-muted">
            暂时无法读取当前账户的生成详情，请稍后刷新。
          </p>
        </div>
      </StudioPageShell>
    );
  }

  if (result.status === "not_found") {
    notFound();
  }

  const generation = result.generation;
  const viewableImages = generation.images.filter(
    (image) => image.src ?? image.url,
  );
  const credits =
    (generation as { credits?: number; costCredits?: number }).credits ??
    (generation as { credits?: number; costCredits?: number }).costCredits ??
    0;

  return (
    <StudioPageShell
      eyebrow="Task"
      title="生成详情"
      wide
      actions={
        <Link
          href="/app/history"
          className="tool-button h-9 px-3 text-xs text-text-muted"
        >
          历史
        </Link>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="surface-panel p-3 sm:p-4">
          {viewableImages.length ? (
            <ImageGallery generation={generation} />
          ) : (
            <div className="flex min-h-[360px] items-center justify-center px-6 text-center lg:min-h-[560px]">
              <div className="max-w-sm">
                <p
                  className={`eyebrow ${generationStatusTone(generation.status)}`}
                >
                  {generationStatusLabel(generation.status)}
                </p>
                <h2 className="mt-2 text-2xl">
                  {generation.status === "FAILED" ? "任务失败" : "暂未产出图片"}
                </h2>
                {generation.status === "FAILED" ? (
                  <p className="mt-3 text-sm leading-6 text-danger">
                    {friendlyErrorMessage(
                      {
                        code: generation.errorCode ?? undefined,
                        message: generation.errorMessage ?? undefined,
                      },
                      "任务失败，请调整描述后重试。",
                    )}
                  </p>
                ) : generation.status === "PENDING" ||
                  generation.status === "RUNNING" ? (
                  <p className="mt-3 text-sm leading-6 text-text-muted">
                    任务仍在处理中，稍后刷新即可查看结果。
                  </p>
                ) : null}
              </div>
            </div>
          )}
        </div>

        <aside className="surface-panel h-fit p-5">
          <p className="eyebrow">任务详情</p>
          <p className="mt-2 break-all font-mono text-xs text-text-muted">
            {generation.id}
          </p>

          <div className="mt-4 grid gap-2">
            {generation.conversationId ? (
              <Link
                href={`/app?thread=${generation.conversationId}`}
                className="tool-button h-9 text-text-muted"
              >
                继续这个对话
              </Link>
            ) : (
              <Link href="/app" className="tool-button h-9 text-text-muted">
                回到工作台
              </Link>
            )}
            {viewableImages.map((image, index) => {
              const href = downloadImageUrl(image);

              return href ? (
                <a
                  key={image.id ?? `${href}-${index}`}
                  href={href}
                  download
                  className="tool-button h-9 text-text-muted"
                >
                  <Download className="h-4 w-4 stroke-[1.5]" />
                  下载原图 {index + 1}
                </a>
              ) : null;
            })}
            {viewableImages[0]?.id ? (
              <Link
                href={`/app/publish?imageId=${encodeURIComponent(viewableImages[0].id)}`}
                className="tool-button h-9 text-text-muted"
              >
                <Share2 className="h-4 w-4 stroke-[1.5]" />
                发布到灵感圈
              </Link>
            ) : null}
          </div>

          <dl className="mt-6 space-y-4 text-sm">
            <div>
              <dt className="text-text-muted">状态</dt>
              <dd className={`mt-1 ${generationStatusTone(generation.status)}`}>
                {generationStatusLabel(generation.status)}
              </dd>
            </div>
            <div>
              <dt className="text-text-muted">创建时间</dt>
              <dd className="mt-1">{formatDate(generation.createdAt)}</dd>
            </div>
            <div>
              <dt className="flex items-center justify-between text-text-muted">
                提示词
                <CopyTextButton text={generation.prompt} />
              </dt>
              <dd className="mt-1 select-text whitespace-pre-wrap break-words leading-6">
                {generation.prompt}
              </dd>
            </div>
            <div>
              <dt className="text-text-muted">模型</dt>
              <dd className="mt-1">{generation.modelId ?? "未记录"}</dd>
            </div>
            <div>
              <dt className="text-text-muted">分辨率</dt>
              <dd className="mt-1">{generation.resolution ?? "未记录"}</dd>
            </div>
            <div>
              <dt className="text-text-muted">比例</dt>
              <dd className="mt-1">{generation.aspectRatio}</dd>
            </div>
            <div>
              <dt className="text-text-muted">消耗</dt>
              <dd className="mt-1 font-mono">{credits} 点</dd>
            </div>
            {generation.errorCode || generation.errorMessage ? (
              <div>
                <dt className="text-text-muted">错误</dt>
                <dd className="mt-1 leading-6 text-danger">
                  {friendlyErrorMessage(
                    {
                      code: generation.errorCode ?? undefined,
                      message: generation.errorMessage ?? undefined,
                    },
                    "任务失败，请调整描述后重试。",
                  )}
                </dd>
              </div>
            ) : null}
          </dl>
        </aside>
      </div>
    </StudioPageShell>
  );
}
