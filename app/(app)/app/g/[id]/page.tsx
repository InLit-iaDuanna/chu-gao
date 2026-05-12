import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import {
  generationStatusLabel,
  generationStatusTone,
} from "@/components/workbench/status";
import { checkSessionFromHeaders } from "@/lib/auth";
import { db } from "@/lib/db";
import { serializeGeneration } from "@/lib/generations";
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
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    return row
      ? { status: "found" as const, generation: serializeGeneration(row) }
      : { status: "not_found" as const };
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
      <div className="surface-panel p-6">
        <p className="eyebrow">任务详情</p>
        <h1 className="mt-2 text-2xl">生成详情暂不可用</h1>
        <p className="mt-4 text-sm leading-6 text-text-muted">
          暂时无法读取当前账户的生成详情，请稍后刷新。
        </p>
      </div>
    );
  }

  if (result.status === "not_found") {
    notFound();
  }

  const generation = result.generation;

  const firstImage = generation.images[0] as
    | { src?: string; url?: string }
    | undefined;
  const imageUrl = firstImage?.src ?? firstImage?.url;
  const credits =
    (generation as { credits?: number; costCredits?: number }).credits ??
    (generation as { credits?: number; costCredits?: number }).costCredits ??
    0;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="surface-panel relative min-h-[380px] overflow-hidden p-3 sm:p-4 lg:min-h-[680px]">
        {imageUrl ? (
          <div className="relative h-[380px] overflow-hidden rounded-[8px] lg:h-[680px]">
            <img
              src={imageUrl}
              alt={generation.prompt}
              className="h-full w-full object-contain"
            />
          </div>
        ) : (
          <div className="flex min-h-[360px] items-center justify-center px-6 text-center lg:min-h-[640px]">
            <div className="max-w-sm">
              <p
                className={`eyebrow ${generationStatusTone(generation.status)}`}
              >
                {generationStatusLabel(generation.status)}
              </p>
              <h2 className="mt-2 text-2xl">
                {generation.status === "FAILED" ? "任务失败" : "暂未产出图片"}
              </h2>
              {generation.errorMessage ? (
                <p className="mt-3 text-sm leading-6 text-danger">
                  {generation.errorMessage}
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
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="eyebrow">任务详情</p>
            <h1 className="mt-2 break-all text-xl">{generation.id}</h1>
          </div>
          <Link href="/app/history" className="text-sm text-text-muted">
            历史
          </Link>
        </div>
        <div className="mt-4 grid gap-2">
          {generation.conversationId ? (
            <Link
              href={`/app?conversation=${generation.conversationId}`}
              className="tool-button h-9 text-text-muted"
            >
              继续这个对话
            </Link>
          ) : (
            <Link href="/app" className="tool-button h-9 text-text-muted">
              回到工作台
            </Link>
          )}
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
            <dt className="text-text-muted">提示词</dt>
            <dd className="mt-1 leading-6">{generation.prompt}</dd>
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
            <dt className="text-text-muted">渠道</dt>
            <dd className="mt-1">{generation.provider ?? "未分配"}</dd>
          </div>
          <div>
            <dt className="text-text-muted">消耗</dt>
            <dd className="mt-1">{credits} 点</dd>
          </div>
          {generation.errorCode || generation.errorMessage ? (
            <div>
              <dt className="text-text-muted">错误</dt>
              <dd className="mt-1 leading-6 text-danger">
                {[generation.errorCode, generation.errorMessage]
                  .filter(Boolean)
                  .join("：")}
              </dd>
            </div>
          ) : null}
        </dl>
      </aside>
    </div>
  );
}
