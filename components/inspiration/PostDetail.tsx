"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  GitBranch,
  Plus,
  RefreshCw,
  UserPlus,
} from "lucide-react";

import { Button, useToast } from "@/components/ui";
import {
  inspirationRequest,
  InspirationApiError,
  loginForCurrentPage,
} from "./api";
import { CommentThread } from "./CommentThread";
import { LineageTree, type LineageData } from "./LineageTree";
import { PostActions } from "./PostActions";
import type { InspirationPost } from "./types";

function recipeCreationHref(recipe: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const key of [
    "prompt",
    "negativePrompt",
    "modelName",
    "aspectRatio",
    "resolution",
    "seed",
  ]) {
    const value = recipe[key];
    if (typeof value === "string" || typeof value === "number") {
      params.set(key, String(value));
    }
  }
  const query = params.toString();
  return query ? `/app?${query}` : "/app";
}

export function PostDetail({
  postId,
  basePath = "/inspiration",
}: {
  postId: string;
  basePath?: string;
}) {
  const { toast } = useToast();
  const [post, setPost] = useState<InspirationPost | null>(null);
  const [lineage, setLineage] = useState<LineageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tagBusy, setTagBusy] = useState<Record<string, boolean>>({});

  useEffect(() => {
    Promise.all([
      inspirationRequest<InspirationPost>(`/api/inspiration/posts/${postId}`),
      inspirationRequest<LineageData>(
        `/api/inspiration/posts/${postId}/lineage`,
      ).catch(() => null),
    ])
      .then(([postResult, lineageResult]) => {
        setPost(postResult);
        setLineage(lineageResult);
      })
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : "帖子无法读取"),
      )
      .finally(() => setLoading(false));
  }, [postId]);

  const recipe = useMemo(
    () => post?.media.find((item) => item.recipe)?.recipe ?? null,
    [post],
  );
  const follow = async () => {
    if (!post?.author.id) return;
    try {
      const result = await inspirationRequest<{ following: boolean }>(
        "/api/inspiration/follows",
        {
          method: "POST",
          body: JSON.stringify({
            targetType: "USER",
            targetKey: post.author.id,
          }),
        },
      );
      setPost({
        ...post,
        viewer: { ...post.viewer, isFollowingAuthor: result.following },
      });
    } catch (cause) {
      if (cause instanceof InspirationApiError && cause.status === 401)
        return loginForCurrentPage();
      toast({
        title: "关注失败",
        description: cause instanceof Error ? cause.message : "请稍后重试",
        variant: "danger",
      });
    }
  };
  const followTag = async (tagId: string, currentlyFollowing: boolean) => {
    if (!post || tagBusy[tagId]) return;
    setTagBusy((current) => ({ ...current, [tagId]: true }));
    try {
      const result = await inspirationRequest<{ following: boolean }>(
        "/api/inspiration/follows",
        {
          method: "POST",
          body: JSON.stringify({
            targetType: "TAG",
            targetKey: tagId,
            following: !currentlyFollowing,
          }),
        },
      );
      setPost((current) =>
        current
          ? {
              ...current,
              tags: current.tags.map((tag) =>
                tag.id === tagId
                  ? { ...tag, isFollowing: result.following }
                  : tag,
              ),
            }
          : current,
      );
    } catch (cause) {
      if (cause instanceof InspirationApiError && cause.status === 401) {
        return loginForCurrentPage();
      }
      toast({
        title: "标签关注失败",
        description: cause instanceof Error ? cause.message : "请稍后重试",
        variant: "danger",
      });
    } finally {
      setTagBusy((current) => ({ ...current, [tagId]: false }));
    }
  };
  if (loading)
    return (
      <div className="mx-auto min-h-[60vh] max-w-6xl px-6 py-16 text-sm text-text-muted">
        正在读取帖子…
      </div>
    );
  if (!post || error)
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-4xl flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="text-2xl">帖子无法打开</h1>
        <p className="text-sm text-text-muted">{error}</p>
        <Link
          href={basePath}
          className="tool-button h-9 px-4 text-sm text-text-muted"
        >
          <ArrowLeft size={14} /> 返回广场
        </Link>
      </div>
    );

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <Link
        href={basePath}
        className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-foreground"
      >
        <ArrowLeft size={14} /> 返回灵感广场
      </Link>
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          {post.media.length ? (
            <section className="space-y-3">
              {post.media.map((media) => (
                <figure
                  key={media.id}
                  className="surface-panel overflow-hidden p-2"
                >
                  <img
                    src={media.url}
                    alt={post.title}
                    className="h-auto w-full rounded-[8px] bg-surface-2 object-contain"
                  />
                  {media.role === "PROCESS" ? (
                    <figcaption className="px-2 py-2 text-xs text-text-muted">
                      过程稿
                    </figcaption>
                  ) : null}
                </figure>
              ))}
            </section>
          ) : null}

          <article className="surface-panel p-5 sm:p-7">
            <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
              <span className="rounded-full border border-border px-2.5 py-1">
                {post.shapeLabel}
              </span>
              <span>{post.disciplineLabel}</span>
              <span>·</span>
              <span>{post.originLabel}</span>
              {post.sourceType !== "STANDARD" ? (
                <>
                  <span>·</span>
                  <span>{post.sourceTypeLabel}</span>
                </>
              ) : null}
            </div>
            <h1 className="mt-4 text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
              {post.title}
            </h1>
            {post.story ? (
              <div className="mt-6 whitespace-pre-wrap text-[15px] leading-8 text-text-muted">
                {post.story}
              </div>
            ) : null}
            {post.sourceNote ? (
              <div className="mt-6 rounded-lg border border-border bg-surface-2 p-4 text-sm leading-6 text-text-muted">
                <p className="font-medium text-foreground">来源说明</p>
                <p className="mt-1 whitespace-pre-wrap">{post.sourceNote}</p>
              </div>
            ) : null}
            {post.externalUrl ? (
              <a
                href={post.externalUrl}
                target="_blank"
                rel="noreferrer nofollow"
                className="mt-4 inline-flex items-center gap-1.5 text-sm text-brand hover:underline"
              >
                打开作者提供的外部参考 <ArrowUpRight size={14} />
              </a>
            ) : null}
            {post.tags.length ? (
              <div className="mt-6 flex flex-wrap gap-2">
                {post.tags.map((tag) => (
                  <span
                    key={tag.id}
                    className={`inline-flex overflow-hidden rounded-full border ${tag.isFollowing ? "border-brand/50 bg-brand/5" : "border-border"}`}
                  >
                    <Link
                      href={`${basePath}?tag=${encodeURIComponent(tag.slug)}`}
                      className="px-2.5 py-1 text-xs text-text-muted hover:text-foreground"
                    >
                      #{tag.name}
                    </Link>
                    <button
                      type="button"
                      aria-label={`${tag.isFollowing ? "取消关注" : "关注"}标签 ${tag.name}`}
                      aria-pressed={Boolean(tag.isFollowing)}
                      disabled={Boolean(tagBusy[tag.id])}
                      onClick={() =>
                        void followTag(tag.id, Boolean(tag.isFollowing))
                      }
                      className="flex items-center gap-1 border-l border-inherit px-2 py-1 text-[10px] text-text-muted transition-colors hover:bg-surface-2 hover:text-foreground disabled:cursor-wait disabled:opacity-50"
                    >
                      {tag.isFollowing ? (
                        <Check size={11} />
                      ) : (
                        <Plus size={11} />
                      )}
                      {tag.isFollowing ? "已关注" : "关注"}
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            <div className="mt-7 border-t border-border pt-4">
              <PostActions post={post} basePath={basePath} />
            </div>
          </article>

          {recipe ? (
            <section className="surface-panel p-5 sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="eyebrow">Reproducible recipe</p>
                  <h2 className="mt-1 text-lg font-medium">可复现配方</h2>
                </div>
                <Link
                  href={recipeCreationHref(recipe)}
                  className="tool-button h-9 px-3 text-xs text-text-muted"
                >
                  <RefreshCw size={14} /> 用这套参数创作
                </Link>
              </div>
              <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
                {Object.entries(recipe).map(([key, value]) => (
                  <div key={key}>
                    <dt className="font-mono text-[10px] uppercase text-text-faint">
                      {key}
                    </dt>
                    <dd className="mt-1 break-words leading-6 text-text-muted">
                      {Array.isArray(value) ? value.join("、") : String(value)}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}

          {lineage && lineage.nodes.length > 1 ? (
            <section className="surface-panel p-5 sm:p-6">
              <div className="flex items-center gap-2">
                <GitBranch size={17} />
                <h2 className="font-medium">想法传承树</h2>
              </div>
              <p className="mt-2 text-sm leading-6 text-text-muted">
                这些帖子不是简单转发，而是在前一个想法上继续推演。
              </p>
              <LineageTree
                data={lineage}
                currentPostId={post.id}
                basePath={basePath}
              />
            </section>
          ) : null}

          <CommentThread postId={post.id} />
        </div>

        <aside className="space-y-4 lg:sticky lg:top-20 lg:h-fit">
          <section className="surface-panel p-5">
            <p className="eyebrow">作者</p>
            <Link
              href={
                post.author.id
                  ? `${basePath === "/app/inspiration" ? "/app/inspiration/u" : "/u"}/${post.author.id}`
                  : "#"
              }
              className="mt-3 block text-lg font-medium"
            >
              {post.author.name}
            </Link>
            {post.author.id && !post.viewer.isAuthor ? (
              <Button
                variant="secondary"
                className="mt-4 w-full"
                onClick={() => void follow()}
              >
                <UserPlus size={14} />{" "}
                {post.viewer.isFollowingAuthor ? "已关注" : "关注设计师"}
              </Button>
            ) : null}
            <Link
              href={`/app/publish?derivedFrom=${post.id}`}
              className="tool-button mt-2 h-9 w-full text-xs text-text-muted"
            >
              <GitBranch size={14} /> 接着这个想法创作
            </Link>
          </section>
          {post.dailyPrompt ? (
            <Link
              href={`${basePath}/daily`}
              className="surface-panel block p-5 transition-colors hover:border-border-strong"
            >
              <p className="eyebrow">每日命题</p>
              <h3 className="mt-2 font-medium">{post.dailyPrompt.title}</h3>
              <p className="mt-2 line-clamp-3 text-sm leading-6 text-text-muted">
                {post.dailyPrompt.prompt}
              </p>
            </Link>
          ) : null}
        </aside>
      </div>
    </main>
  );
}
