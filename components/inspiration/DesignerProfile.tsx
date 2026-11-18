"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  ExternalLink,
  MapPin,
  Pencil,
  UserPlus,
} from "lucide-react";

import { Button, EmptyState } from "@/components/ui";
import {
  inspirationRequest,
  InspirationApiError,
  loginForCurrentPage,
} from "./api";
import { InspirationCard } from "./InspirationCard";
import type { InspirationPost } from "./types";

interface ProfileData {
  user: {
    id: string;
    name: string;
    avatarUrl: string | null;
    bio: string | null;
    designerTitle: string | null;
    designerLocation: string | null;
    designerWebsite: string | null;
    designDisciplines: Array<{ value: string; label: string }>;
    joinedAt: string;
    followerCount: number;
    followingCount: number;
    isFollowing: boolean;
    isSelf: boolean;
  };
  posts: InspirationPost[];
}

export function DesignerProfile({
  userId,
  basePath = "/inspiration",
}: {
  userId: string;
  basePath?: string;
}) {
  const [data, setData] = useState<ProfileData | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    inspirationRequest<ProfileData>(`/api/inspiration/users/${userId}`)
      .then(setData)
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : "设计师主页无法读取"),
      );
  }, [userId]);
  const follow = async () => {
    if (!data) return;
    try {
      const result = await inspirationRequest<{ following: boolean }>(
        "/api/inspiration/follows",
        {
          method: "POST",
          body: JSON.stringify({ targetType: "USER", targetKey: userId }),
        },
      );
      setData({
        ...data,
        user: {
          ...data.user,
          isFollowing: result.following,
          followerCount: data.user.followerCount + (result.following ? 1 : -1),
        },
      });
    } catch (cause) {
      if (cause instanceof InspirationApiError && cause.status === 401)
        loginForCurrentPage();
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
        正在读取设计师主页…
      </div>
    );
  return (
    <main className="mx-auto min-w-0 max-w-7xl break-words px-4 py-6 text-sm tracking-normal sm:px-6">
      <Button asChild variant="ghost" className="px-2">
        <Link href={basePath}>
          <ArrowLeft size={16} /> 返回广场
        </Link>
      </Button>
      <section className="app-page-header mt-5 flex flex-col justify-between gap-5 border-b border-border pb-6 sm:flex-row sm:items-end">
        <div className="min-w-0 max-w-2xl">
          <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-lg border border-border bg-surface-2 text-2xl font-semibold">
            {data.user.avatarUrl ? (
              <img
                src={data.user.avatarUrl}
                alt={`${data.user.name} 的头像`}
                className="h-full w-full object-cover"
              />
            ) : (
              data.user.name.slice(0, 1).toUpperCase()
            )}
          </div>
          <h1 className="app-page-title mt-4 break-words text-xl font-semibold tracking-normal sm:text-2xl">
            {data.user.name}
          </h1>
          {data.user.designerTitle ? (
            <p className="mt-2 text-sm text-text-muted">
              {data.user.designerTitle}
            </p>
          ) : null}
          {data.user.bio ? (
            <p className="mt-4 max-w-xl whitespace-pre-wrap break-words text-sm leading-6 text-text-muted">
              {data.user.bio}
            </p>
          ) : null}
          {data.user.designDisciplines.length ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {data.user.designDisciplines.map((item) => (
                <span
                  key={item.value}
                  className="rounded-md bg-surface-2 px-2.5 py-1 text-xs text-text-muted"
                >
                  {item.label}
                </span>
              ))}
            </div>
          ) : null}
          <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-text-muted">
            <span className="flex items-center gap-1.5">
              <CalendarDays size={13} />{" "}
              {new Date(data.user.joinedAt).toLocaleDateString("zh-CN")} 加入
            </span>
            {data.user.designerLocation ? (
              <span className="flex min-w-0 max-w-full items-center gap-1.5">
                <MapPin size={13} className="shrink-0" />{" "}
                <span className="min-w-0 break-words">
                  {data.user.designerLocation}
                </span>
              </span>
            ) : null}
            {data.user.designerWebsite ? (
              <a
                href={data.user.designerWebsite}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 hover:text-foreground"
              >
                <ExternalLink size={13} /> 个人网站
              </a>
            ) : null}
          </div>
          <div className="mt-4 flex flex-wrap gap-4 text-sm">
            <span>
              <strong>{data.user.followerCount}</strong>{" "}
              <span className="text-text-muted">关注者</span>
            </span>
            <span>
              <strong>{data.user.followingCount}</strong>{" "}
              <span className="text-text-muted">关注中</span>
            </span>
            <span>
              <strong>{data.posts.length}</strong>{" "}
              <span className="text-text-muted">发布</span>
            </span>
          </div>
        </div>
        {data.user.isSelf ? (
          <Button asChild variant="secondary">
            <Link href="/app/inspiration?view=mine&section=profile">
              <Pencil size={14} /> 编辑设计师资料
            </Link>
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => void follow()}>
            <UserPlus size={14} />{" "}
            {data.user.isFollowing ? "已关注" : "关注设计师"}
          </Button>
        )}
      </section>
      <section className="py-8">
        <h2 className="app-section-title text-xl font-semibold">公开内容</h2>
        {data.posts.length ? (
          <div className="mt-5 columns-1 gap-4 sm:columns-2 lg:columns-3 xl:columns-4">
            {data.posts.map((post) => (
              <InspirationCard key={post.id} post={post} basePath={basePath} />
            ))}
          </div>
        ) : (
          <EmptyState className="mt-5 min-h-48" title="还没有公开发布。" />
        )}
      </section>
    </main>
  );
}
