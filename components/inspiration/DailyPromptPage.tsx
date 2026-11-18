"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, CalendarDays, Plus, Sparkles } from "lucide-react";

import { Button, EmptyState } from "@/components/ui";
import {
  inspirationRequest,
  InspirationApiError,
  loginForCurrentPage,
} from "./api";
import { InspirationCard } from "./InspirationCard";
import type { InspirationPost } from "./types";

interface DailyData {
  prompt: null | {
    id: string;
    day: string;
    discipline: string;
    title: string;
    prompt: string;
    keywords: string[];
    questionPost: InspirationPost | null;
    features: InspirationPost[];
    responses: InspirationPost[];
    viewer: { isFollowingDiscipline: boolean };
  };
}

export function DailyPromptPage({
  basePath = "/inspiration",
}: {
  basePath?: string;
} = {}) {
  const [data, setData] = useState<DailyData | null>(null);
  const [error, setError] = useState("");
  const [following, setFollowing] = useState(false);
  const [followPending, setFollowPending] = useState(false);
  useEffect(() => {
    inspirationRequest<DailyData>("/api/inspiration/daily")
      .then((result) => {
        setData(result);
        setFollowing(Boolean(result.prompt?.viewer.isFollowingDiscipline));
      })
      .catch((cause) =>
        setError(
          cause instanceof Error ? cause.message : "每日命题暂时无法读取",
        ),
      );
  }, []);

  const followDiscipline = async () => {
    if (!data?.prompt || followPending) return;
    setFollowPending(true);
    try {
      const result = await inspirationRequest<{ following: boolean }>(
        "/api/inspiration/follows",
        {
          method: "POST",
          body: JSON.stringify({
            targetType: "DISCIPLINE",
            targetKey: data.prompt.discipline,
            following: !following,
          }),
        },
      );
      setFollowing(result.following);
    } catch (cause) {
      if (cause instanceof InspirationApiError && cause.status === 401)
        loginForCurrentPage();
    } finally {
      setFollowPending(false);
    }
  };

  if (error)
    return (
      <div className="mx-auto min-h-[60vh] max-w-4xl px-6 py-16 text-center text-sm text-text-muted">
        {error}
      </div>
    );
  if (!data)
    return (
      <div className="mx-auto min-h-[60vh] max-w-4xl px-6 py-16 text-sm text-text-muted">
        正在打开今天的命题…
      </div>
    );
  if (!data.prompt) {
    return (
      <main className="mx-auto flex min-h-[65vh] max-w-4xl flex-col items-center justify-center gap-4 px-6 text-center">
        <Sparkles size={30} className="text-text-faint" />
        <h1 className="app-page-title text-xl font-semibold sm:text-2xl">
          今天的命题正在策展
        </h1>
        <p className="max-w-lg text-sm leading-7 text-text-muted">
          管理员发布命题后会出现在这里。现在可以先去广场看看大家正在讨论的问题。
        </p>
        <Button asChild>
          <Link href={basePath}>
            <ArrowLeft size={16} /> 返回广场
          </Link>
        </Button>
      </main>
    );
  }

  const prompt = data.prompt;
  return (
    <main className="min-w-0 text-sm tracking-normal">
      <section className="border-b border-border">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
          <Button asChild variant="ghost" className="px-2">
            <Link href={basePath}>
              <ArrowLeft size={16} /> 灵感广场
            </Link>
          </Button>
          <div className="app-page-header mt-5 block max-w-4xl border-0 pb-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
              <CalendarDays size={14} /> {prompt.day} · 每日命题
            </div>
            <h1 className="app-page-title mt-3 break-words text-xl font-semibold tracking-normal sm:text-2xl">
              {prompt.title}
            </h1>
            <p className="app-page-description mt-3 max-w-3xl whitespace-pre-wrap break-words text-sm leading-7 text-text-muted">
              {prompt.prompt}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {prompt.keywords.map((keyword) => (
                <span
                  key={keyword}
                  className="max-w-full break-words rounded-md bg-surface-2 px-2.5 py-1 text-xs text-text-muted"
                >
                  #{keyword}
                </span>
              ))}
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button asChild variant="primary">
                <Link
                  href={`/app/publish?dailyPrompt=${prompt.id}&shape=QUESTION&discipline=${prompt.discipline}`}
                >
                  <Plus size={16} /> 回应今日命题
                </Link>
              </Button>
              <Button
                variant="secondary"
                disabled={followPending}
                aria-pressed={following}
                onClick={() => void followDiscipline()}
              >
                {followPending
                  ? "正在更新…"
                  : following
                    ? "已关注这个学科"
                    : "关注这个学科"}
              </Button>
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl space-y-8 px-4 py-6 sm:px-6">
        {prompt.features.length ? (
          <section>
            <h2 className="app-section-title text-xl font-semibold">
              今日策展
            </h2>
            <div className="mt-5 columns-1 gap-4 sm:columns-2 lg:columns-3 xl:columns-4">
              {prompt.features.map((post) => (
                <InspirationCard
                  key={post.id}
                  post={post}
                  basePath={basePath}
                />
              ))}
            </div>
          </section>
        ) : null}
        <section>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="app-section-title text-xl font-semibold">
                大家的回应
              </h2>
            </div>
            <span className="text-xs text-text-muted">
              {prompt.responses.length} 条
            </span>
          </div>
          {prompt.responses.length ? (
            <div className="mt-5 columns-1 gap-4 sm:columns-2 lg:columns-3 xl:columns-4">
              {prompt.responses.map((post) => (
                <InspirationCard
                  key={post.id}
                  post={post}
                  basePath={basePath}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              className="mt-5 min-h-48"
              icon={Sparkles}
              title="还没有人回应今天的命题。"
              action={
                <Button asChild>
                  <Link
                    href={`/app/publish?dailyPrompt=${prompt.id}&shape=QUESTION&discipline=${prompt.discipline}`}
                  >
                    <Plus size={16} /> 成为第一个回应者
                  </Link>
                </Button>
              }
            />
          )}
        </section>
      </div>
    </main>
  );
}
