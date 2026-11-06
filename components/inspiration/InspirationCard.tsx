import Link from "next/link";

import { ArrowUpRight, MessageCircle } from "lucide-react";

import { PostActions } from "./PostActions";
import type { InspirationPost } from "./types";

const DISCIPLINE_ACCENTS: Record<string, string> = {
  GRAPHIC: "from-fuchsia-500/25",
  PRODUCT: "from-blue-500/25",
  INDUSTRIAL: "from-amber-500/25",
  SERVICE: "from-emerald-500/25",
  SPATIAL: "from-orange-500/25",
  BRAND: "from-rose-500/25",
  MOTION: "from-violet-500/25",
  DATAVIZ: "from-cyan-500/25",
};

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
    <article className="surface-panel group mb-4 break-inside-avoid overflow-hidden">
      <Link href={postHref} className="block">
        {cover ? (
          <div
            className="relative overflow-hidden bg-surface-2"
            style={{ aspectRatio: `${cover.width} / ${cover.height}` }}
          >
            <img
              src={cover.thumbnailUrl || cover.url}
              alt={post.title}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.025]"
            />
            {post.media.length > 1 ? (
              <span className="absolute right-3 top-3 rounded-full bg-black/60 px-2 py-1 font-mono text-[10px] text-white">
                {post.media.length} 张
              </span>
            ) : null}
          </div>
        ) : (
          <div
            className={`min-h-52 bg-gradient-to-br ${DISCIPLINE_ACCENTS[post.discipline] ?? "from-brand/20"} via-surface to-surface-2 p-6`}
          >
            <div className="h-1 w-12 rounded-full bg-brand" />
            <p className="mt-8 font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
              {post.disciplineLabel} · {post.shapeLabel}
            </p>
            <h2 className="mt-3 text-2xl font-semibold leading-tight tracking-tight">
              {post.title}
            </h2>
            {post.story ? (
              <p className="mt-4 line-clamp-4 text-sm leading-6 text-text-muted">
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
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2 text-[11px] text-text-muted">
            <span className="rounded-full border border-border px-2 py-0.5">
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
              className="truncate text-xs text-text-muted hover:text-foreground"
            >
              {post.author.name}
            </Link>
          ) : (
            <span className="truncate text-xs text-text-muted">
              {post.author.name}
            </span>
          )}
        </div>

        {cover ? (
          <Link href={postHref} className="mt-3 block">
            <h2 className="line-clamp-2 text-[15px] font-medium leading-6">
              {post.title}
            </h2>
            {post.story ? (
              <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-text-muted">
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
                className="text-[11px] text-text-faint hover:text-foreground"
              >
                #{tag.name}
              </Link>
            ))}
          </div>
        ) : null}

        <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-2">
          <PostActions post={post} compact basePath={basePath} />
          <Link
            href={postHref}
            aria-label="打开帖子"
            className="text-text-faint transition-colors hover:text-foreground"
          >
            <ArrowUpRight size={15} />
          </Link>
        </div>
      </div>
    </article>
  );
}
