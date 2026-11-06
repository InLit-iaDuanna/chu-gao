"use client";

import Link from "next/link";
import {
  Bookmark,
  GitFork,
  Heart,
  MessageCircle,
  Share2,
  LoaderCircle,
} from "lucide-react";
import { useRef, useState } from "react";

import { Button, useToast } from "@/components/ui";
import {
  inspirationRequest,
  InspirationApiError,
  loginForCurrentPage,
} from "./api";
import { ReportDialog } from "./ReportDialog";
import type { InspirationPost } from "./types";

export function PostActions({
  post,
  compact = false,
  basePath = "/inspiration",
}: {
  post: InspirationPost;
  compact?: boolean;
  basePath?: string;
}) {
  const { toast } = useToast();
  const [liked, setLiked] = useState(post.viewer.isLiked);
  const [bookmarked, setBookmarked] = useState(post.viewer.isBookmarked);
  const [likes, setLikes] = useState(post.counts.likes);
  const [bookmarks, setBookmarks] = useState(post.counts.bookmarks);
  const pendingRef = useRef({ like: false, bookmark: false });
  const [pending, setPending] = useState({ like: false, bookmark: false });
  const act = async (kind: "like" | "bookmark") => {
    if (pendingRef.current[kind]) return;
    pendingRef.current[kind] = true;
    setPending((current) => ({ ...current, [kind]: true }));
    try {
      const result = await inspirationRequest<{
        liked?: boolean;
        bookmarked?: boolean;
        count: number;
      }>(`/api/inspiration/posts/${post.id}/${kind}`, { method: "POST" });
      if (kind === "like") {
        setLiked(Boolean(result.liked));
        setLikes(result.count);
      } else {
        setBookmarked(Boolean(result.bookmarked));
        setBookmarks(result.count);
      }
    } catch (error) {
      if (error instanceof InspirationApiError && error.status === 401)
        return loginForCurrentPage();
      toast({
        title: "操作失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "danger",
      });
    } finally {
      pendingRef.current[kind] = false;
      setPending((current) => ({ ...current, [kind]: false }));
    }
  };
  const share = async () => {
    const url = `${window.location.origin}/inspiration/${post.id}`;
    if (navigator.share)
      await navigator.share({ title: post.title, url }).catch(() => undefined);
    else {
      await navigator.clipboard.writeText(url);
      toast({ title: "链接已复制" });
    }
  };

  const buttonClass = compact
    ? "h-11 min-w-11 gap-1 px-1.5 text-xs text-text-muted md:h-8 md:min-w-8"
    : "h-11 min-w-11 gap-1.5 px-2.5 text-xs text-text-muted md:h-9";

  return (
    <div className="flex flex-wrap items-center gap-1">
      <Button
        variant="ghost"
        className={buttonClass}
        onClick={() => void act("like")}
        aria-pressed={liked}
        disabled={pending.like}
        aria-busy={pending.like}
        aria-label={`${liked ? "取消点赞" : "点赞"}，${likes} 个赞`}
        title={liked ? "取消点赞" : "点赞"}
      >
        {pending.like ? (
          <LoaderCircle size={compact ? 13 : 15} className="animate-spin" />
        ) : (
          <Heart
            size={compact ? 13 : 15}
            className={liked ? "fill-current text-danger" : ""}
          />
        )}
        {likes}
      </Button>
      <Button
        variant="ghost"
        className={buttonClass}
        onClick={() => void act("bookmark")}
        aria-pressed={bookmarked}
        disabled={pending.bookmark}
        aria-busy={pending.bookmark}
        aria-label={`${bookmarked ? "取消收藏" : "收藏"}，${bookmarks} 次收藏`}
        title={bookmarked ? "取消收藏" : "收藏"}
      >
        {pending.bookmark ? (
          <LoaderCircle size={compact ? 13 : 15} className="animate-spin" />
        ) : (
          <Bookmark
            size={compact ? 13 : 15}
            className={bookmarked ? "fill-current text-brand" : ""}
          />
        )}
        {bookmarks}
      </Button>
      <Link
        href={`${basePath}/${post.id}#discussion`}
        aria-label={`查看讨论，${post.counts.comments} 条回应`}
        title="查看讨论"
        className={`pressable inline-flex items-center rounded-md hover:bg-surface-2 ${buttonClass}`}
      >
        <MessageCircle size={compact ? 13 : 15} /> {post.counts.comments}
      </Link>
      <Link
        href={`/app/publish?derivedFrom=${post.id}`}
        aria-label="接着这个想法创作"
        title="接着这个想法创作"
        className={`pressable inline-flex items-center rounded-md hover:bg-surface-2 ${buttonClass}`}
      >
        <GitFork size={compact ? 13 : 15} /> {post.counts.derived}
      </Link>
      {!compact ? (
        <>
          <Button
            variant="ghost"
            className={buttonClass}
            onClick={() => void share()}
          >
            <Share2 size={15} /> 分享
          </Button>
          <ReportDialog postId={post.id} triggerClassName={buttonClass} />
        </>
      ) : null}
    </div>
  );
}
