import Image from "next/image";
import Link from "next/link";
import { headers } from "next/headers";

import { ActionableStatus } from "@/components/shared/ActionableStatus";
import { ClearHistoryButton } from "@/components/workbench/ClearHistoryButton";
import {
  generationStatusLabel,
  generationStatusTone,
} from "@/components/workbench/status";
import { checkSessionFromHeaders } from "@/lib/auth";
import {
  conversationSummaryRowInclude,
  serializeConversationSummary,
} from "@/lib/conversations";
import { db } from "@/lib/db";
import { serializeGeneration } from "@/lib/generations";
import { isDatabaseUnavailableError } from "@/lib/service-errors";
import { formatDate } from "@/lib/utils";

async function getGenerations() {
  const sessionResult = await checkSessionFromHeaders(await headers());

  if (sessionResult.status !== "authenticated" || !process.env.DATABASE_URL) {
    return null;
  }

  try {
    const rows = await db.generation.findMany({
      where: {
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
      orderBy: {
        createdAt: "desc",
      },
      take: 60,
    });

    return rows.map(serializeGeneration);
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      return null;
    }

    throw error;
  }
}

async function getConversations() {
  const sessionResult = await checkSessionFromHeaders(await headers());

  if (sessionResult.status !== "authenticated" || !process.env.DATABASE_URL) {
    return null;
  }

  try {
    const rows = await db.conversation.findMany({
      where: {
        userId: sessionResult.user.id,
        archivedAt: null,
      },
      include: conversationSummaryRowInclude(),
      orderBy: {
        lastMessageAt: "desc",
      },
      take: 60,
    });

    return rows.map(serializeConversationSummary);
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      return null;
    }

    throw error;
  }
}

export default async function HistoryPage() {
  const [conversations, generations] = await Promise.all([
    getConversations(),
    getGenerations(),
  ]);
  const hasHistory = Boolean(
    conversations &&
      generations &&
      (conversations.length > 0 || generations.length > 0),
  );

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between gap-4 max-sm:flex-col max-sm:items-start">
        <div>
          <p className="eyebrow">画廊</p>
          <h1 className="mt-2 text-4xl max-sm:text-3xl">对话与生成记录</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 max-sm:w-full">
          {hasHistory ? <ClearHistoryButton /> : null}
          <Link href="/app" className="tool-button h-9 text-text-muted">
            新建对话
          </Link>
        </div>
      </div>

      {!conversations || !generations ? (
        <ActionableStatus
          tone="warning"
          eyebrow="历史"
          title="历史暂时无法读取"
          description="请稍后刷新页面。你仍然可以返回创作页，服务恢复后新的任务会继续保存。"
          action={
            <Link href="/app" className="tool-button h-9 text-text-muted">
              返回创作
            </Link>
          }
        />
      ) : conversations.length === 0 && generations.length === 0 ? (
        <div className="surface-panel flex min-h-72 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
          <h2 className="text-xl font-medium">当前账户还没有创作历史</h2>
          <p className="max-w-md text-sm leading-6 text-text-muted">
            回到创作页，描述第一张图。完成后的结果会出现在这里。
          </p>
          <Link href="/app" className="tool-button mt-2 h-9 text-text-muted">
            开始创作
          </Link>
        </div>
      ) : (
        <div className="space-y-8">
          {conversations.length ? (
            <section>
              <div className="mb-3">
                <p className="eyebrow">对话</p>
                <h2 className="mt-1 text-2xl">继续创作</h2>
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {conversations.map((conversation) => (
                  <Link
                    key={conversation.id}
                    href={`/app?conversation=${conversation.id}`}
                    className="surface-panel img-enter block overflow-hidden p-3 transition-all hover:-translate-y-0.5 hover:bg-surface-2"
                  >
                    <div className="relative mb-3 h-40 overflow-hidden rounded-[8px] bg-surface-2">
                      {conversation.thumbnailUrl ? (
                        <Image
                          src={conversation.thumbnailUrl}
                          alt={conversation.title}
                          fill
                          className="object-cover"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center px-6 text-center text-sm text-text-muted">
                          对话还没有完成的图片
                        </div>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-3 font-mono text-xs text-text-muted">
                      <span>{formatDate(conversation.lastMessageAt)}</span>
                      <span>{conversation.generationCount} 个任务</span>
                    </div>
                    <h3 className="mt-2 line-clamp-1 font-medium">
                      {conversation.title}
                    </h3>
                    {conversation.latestMessage ? (
                      <p className="mt-2 line-clamp-2 text-sm leading-6 text-text-muted">
                        {conversation.latestMessage}
                      </p>
                    ) : null}
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          <section>
            <div className="mb-3">
              <p className="eyebrow">任务</p>
              <h2 className="mt-1 text-2xl">单次生成记录</h2>
            </div>
            <div className="columns-1 gap-4 md:columns-2 xl:columns-3">
              {generations.map((generation) => {
                const firstImage = generation.images[0] as
                  | { src?: string; url?: string }
                  | undefined;
                const imageUrl = firstImage?.src ?? firstImage?.url;

                return (
                  <Link
                    key={generation.id}
                    href={
                      generation.conversationId
                        ? `/app?conversation=${generation.conversationId}`
                        : `/app/g/${generation.id}`
                    }
                    className="surface-panel img-enter mb-4 block break-inside-avoid p-3 transition-all hover:-translate-y-0.5 hover:bg-surface-2"
                  >
                    <div className="relative mb-3 h-64 overflow-hidden rounded-[8px] bg-surface-2 sm:h-80">
                      {imageUrl ? (
                        <Image
                          src={imageUrl}
                          alt={generation.prompt}
                          fill
                          className="object-cover"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center px-6 text-center text-sm text-text-muted">
                          {generation.status === "FAILED"
                            ? (generation.errorMessage ??
                              "任务失败，可以打开详情查看原因")
                            : generationStatusLabel(generation.status)}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center justify-between font-mono text-xs text-text-muted">
                      <span>{formatDate(generation.createdAt)}</span>
                      <span className={generationStatusTone(generation.status)}>
                        {generationStatusLabel(generation.status)}
                      </span>
                    </div>
                    <p className="mt-2 line-clamp-3 text-sm leading-6">
                      {generation.prompt}
                    </p>
                  </Link>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
