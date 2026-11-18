import Link from "next/link";

import { ArrowUpRight, MessageCircle } from "lucide-react";
import { IconButton } from "@/components/ui";

import { PostActions } from "./PostActions";
import type { InspirationPost } from "./types";

export function InspirationCard({
  post,
  basePath = "/inspiration",
}: {
  post: InspirationPost;
  basePath?: string;
}) {
  const cover = post.media.find((item) => item.isCover) ?? post.media[0];
  const postHref = `${basePath}/${post.id}`;
  return (
    <article className="group mb-4 min-w-0 break-inside-avoid overflow-hidden rounded-lg border border-border bg-surface text-sm tracking-normal">
      <Link href={postHref} className="block">
        {cover ? (
          <div
            className="relative overflow-hidden bg-surface-2"
            style={{ aspectRatio: `${cover.width} / ${cover.height}` }}
          >
            <img
              src={cover.thumbnailUrl || cover.url}
              alt={post.title}
              width={cover.width}
              height={cover.height}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.025]"
            />
            {post.media.length > 1 ? (
              <span className="absolute right-3 top-3 rounded-md border border-border bg-surface/95 px-2 py-1 text-xs text-foreground">
                {post.media.length} 张
              </span>
            ) : null}
          </div>
        ) : (
          <div className="min-h-52 bg-surface-2 p-5">
            <p className="text-xs text-text-muted">
              {post.disciplineLabel} · {post.shapeLabel}
            </p>
            <h2 className="mt-3 break-words text-xl font-semibold leading-7">
              {post.title}
            </h2>
            {post.story ? (
              <p className="mt-4 line-clamp-4 break-words text-sm leading-6 text-text-muted">
                {post.story}
              </p>
            ) : null}
            <p className="mt-8 flex items-center gap-1 text-xs text-text-muted">
              <MessageCircle size={13} /> {post.counts.comments} 个回应
            </p>
          </div>
        )}
      </Link>

      <div className="p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-text-muted">
            <span className="rounded-md bg-surface-2 px-2 py-1">
              {post.shapeLabel}
            </span>
            <span className="truncate">{post.disciplineLabel}</span>
            {post.sourceType !== "STANDARD" ? (
              <span className="truncate text-text-faint">
                · {post.sourceTypeLabel}
              </span>
            ) : null}
          </div>
          {post.author.id ? (
            <Link
              href={`${basePath === "/app/inspiration" ? "/app/inspiration/u" : "/u"}/${post.author.id}`}
              className="min-w-0 max-w-full truncate text-xs text-text-muted hover:text-foreground"
            >
              {post.author.name}
            </Link>
          ) : (
            <span className="min-w-0 max-w-full truncate text-xs text-text-muted">
              {post.author.name}
            </span>
          )}
        </div>

        {cover ? (
          <Link href={postHref} className="mt-3 block">
            <h2 className="line-clamp-2 break-words text-xl font-semibold leading-7">
              {post.title}
            </h2>
            {post.story ? (
              <p className="mt-1.5 line-clamp-2 break-words text-sm leading-6 text-text-muted">
                {post.story}
              </p>
            ) : null}
          </Link>
        ) : null}

        {post.tags.length ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {post.tags.slice(0, 5).map((tag) => (
              <Link
                key={tag.id}
                href={`${basePath}?tag=${encodeURIComponent(tag.slug)}`}
                className="max-w-full break-words text-xs text-text-muted hover:text-foreground"
              >
                #{tag.name}
              </Link>
            ))}
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-1 border-t border-border pt-2">
          <PostActions post={post} compact basePath={basePath} />
          <IconButton
            asChild
            className="h-9 w-9"
            aria-label="打开帖子"
            title="打开帖子"
          >
            <Link href={postHref}>
              <ArrowUpRight size={16} />
            </Link>
          </IconButton>
        </div>
      </div>
    </article>
  );
}
