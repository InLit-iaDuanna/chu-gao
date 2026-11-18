import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  CircleAlert,
  Download,
  MessageSquare,
  Share2,
} from "lucide-react";
import { Button, EmptyState } from "@/components/ui";

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
      <StudioPageShell title="生成详情" wide>
        <EmptyState
          role="status"
          icon={CircleAlert}
          className="min-h-72 border-t border-border"
          title="生成详情暂不可用"
          description="暂时无法读取当前账户的生成详情，请稍后刷新。"
        />
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
      title="生成详情"
      wide
      actions={
        <Button asChild>
          <Link href="/app/history">
            <ArrowLeft size={16} aria-hidden="true" />
            历史
          </Link>
        </Button>
      }
    >
      <div className="grid min-w-0 gap-6 border-t border-border pt-6 text-sm tracking-normal lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-8">
        <div className="min-w-0">
          {viewableImages.length ? (
            <ImageGallery
              generation={generation}
              frameClassName="h-[320px] rounded-lg sm:h-[480px] lg:h-[620px]"
            />
          ) : (
            <div
              role="status"
              className="flex min-h-[320px] items-center justify-center rounded-lg border border-border bg-surface-2 px-5 text-center sm:min-h-[480px] lg:min-h-[560px]"
            >
              <div className="min-w-0 max-w-sm">
                <p
                  className={`text-xs font-medium ${generationStatusTone(generation.status)}`}
                >
                  {generationStatusLabel(generation.status)}
                </p>
                <h2 className="mt-2 text-xl font-semibold">
                  {generation.status === "FAILED" ? "任务失败" : "暂未产出图片"}
                </h2>
                {generation.status === "FAILED" ? (
                  <p className="mt-3 break-words text-sm leading-6 text-danger [overflow-wrap:anywhere]">
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

        <aside
          aria-labelledby="generation-details-heading"
          className="h-fit min-w-0 border-t border-border pt-6 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0"
        >
          <h2 id="generation-details-heading" className="app-section-title">
            任务详情
          </h2>
          <p
            tabIndex={0}
            className="mt-2 max-w-full overflow-x-auto whitespace-nowrap font-mono text-xs text-text-muted"
          >
            {generation.id}
          </p>

          <div className="mt-4 grid gap-2">
            {generation.conversationId ? (
              <Button asChild variant="primary">
                <Link href={`/app?thread=${generation.conversationId}`}>
                  <MessageSquare size={16} aria-hidden="true" />
                  继续这个对话
                </Link>
              </Button>
            ) : (
              <Button asChild variant="primary">
                <Link href="/app">
                  <ArrowLeft size={16} aria-hidden="true" />
                  回到工作台
                </Link>
              </Button>
            )}
            {viewableImages.map((image, index) => {
              const href = downloadImageUrl(image);

              return href ? (
                <Button asChild key={image.id ?? `${href}-${index}`}>
                  <a href={href} download>
                    <Download className="h-4 w-4 stroke-[1.5]" />
                    下载原图 {index + 1}
                  </a>
                </Button>
              ) : null;
            })}
            {viewableImages[0]?.id ? (
              <Button asChild>
                <Link
                  href={`/app/publish?imageId=${encodeURIComponent(viewableImages[0].id)}`}
                >
                  <Share2 className="h-4 w-4 stroke-[1.5]" />
                  发布到灵感圈
                </Link>
              </Button>
            ) : null}
          </div>

          <dl className="mt-6 space-y-4 border-t border-border pt-5 text-sm [&_dt]:text-xs [&_dd]:break-words [&_dd]:[overflow-wrap:anywhere]">
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
              <dt className="flex items-center justify-between gap-3 text-text-muted [&_button]:h-9 [&_button]:w-9">
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
                <dd role="status" className="mt-1 leading-6 text-danger">
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
