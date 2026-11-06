"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BarChart3,
  Bell,
  Bookmark,
  FilePenLine,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  UserRound,
} from "lucide-react";

import { Button, useToast } from "@/components/ui";
import { inspirationRequest } from "./api";
import { BookmarkCollectionsView } from "./BookmarkCollectionsView";
import { DesignerProfileEditor } from "./DesignerProfileEditor";
import { InspirationCard } from "./InspirationCard";
import { NotificationList } from "./NotificationList";
import type { InspirationPost } from "./types";

type Tab = "posts" | "bookmarks" | "notifications" | "analytics" | "profile";

interface Analytics {
  totals: {
    posts: number;
    published: number;
    likes: number;
    bookmarks: number;
    comments: number;
    derived: number;
    engagement: number;
  };
  averages: { engagementPerPublished: number };
  challenge: {
    currentStreak: number;
    bestStreak: number;
    totalDays: number;
    lastParticipationDay: string | null;
    participatedToday: boolean;
  };
  dailyPromptStreak: number;
  activity: {
    total: number;
    asOf: string;
    days: Array<{
      day: string;
      likes: number;
      bookmarks: number;
      comments: number;
      derived: number;
      total: number;
    }>;
  };
  breakdown: {
    disciplines: Array<{ value: string; posts: number; engagement: number }>;
    shapes: Array<{ value: string; posts: number; engagement: number }>;
  };
  posts: Array<{
    id: string;
    title: string;
    status: string;
    likeCount: number;
    bookmarkCount: number;
    commentCount: number;
    derivedCount: number;
    engagement: number;
  }>;
}

const DISCIPLINE_LABELS: Record<string, string> = {
  GRAPHIC: "视觉平面",
  PRODUCT: "产品体验",
  INDUSTRIAL: "工业硬件",
  SERVICE: "服务流程",
  SPATIAL: "空间环境",
  BRAND: "品牌策略",
  MOTION: "动态影像",
  DATAVIZ: "信息可视化",
};

const SHAPE_LABELS: Record<string, string> = {
  WORK: "作品",
  TEARDOWN: "拆解",
  PATTERN: "模式",
  QUESTION: "命题",
  REFERENCE: "参考",
  PROCESS: "过程",
};

export function InspirationDashboard({
  initialTab = "posts",
}: {
  initialTab?: Tab;
} = {}) {
  const { toast } = useToast();
  const router = useRouter();
  const tab = initialTab;
  const setTab = (value: Tab) =>
    router.push(`/app/inspiration?view=mine&section=${value}`, {
      scroll: false,
    });
  const [posts, setPosts] = useState<InspirationPost[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const removePost = async (post: InspirationPost) => {
    if (
      !window.confirm(
        `确定删除《${post.title}》吗？图片会保留 30 天以便误删恢复。`,
      )
    )
      return;
    setDeletingId(post.id);
    try {
      await inspirationRequest(`/api/inspiration/posts/${post.id}`, {
        method: "DELETE",
      });
      setPosts((current) => current.filter((item) => item.id !== post.id));
      toast({ title: "帖子已删除", description: "公开图片将在 30 天后清理。" });
    } catch (cause) {
      toast({
        title: "删除失败",
        description: cause instanceof Error ? cause.message : "请稍后重试",
        variant: "danger",
      });
    } finally {
      setDeletingId(null);
    }
  };

  useEffect(() => {
    setLoadError("");
    if (tab !== "posts" && tab !== "analytics") {
      setLoading(false);
      return;
    }
    setLoading(true);
    const controller = new AbortController();
    const request =
      tab === "posts"
        ? inspirationRequest<{ items: InspirationPost[] }>(
            "/api/inspiration/me/posts",
            { signal: controller.signal },
          ).then((data) => {
            if (!controller.signal.aborted) setPosts(data.items);
          })
        : inspirationRequest<Analytics>("/api/inspiration/analytics/me", {
            signal: controller.signal,
          }).then((data) => {
            if (!controller.signal.aborted) setAnalytics(data);
          });
    request
      .catch((error) => {
        if (!controller.signal.aborted)
          setLoadError(error instanceof Error ? error.message : "内容读取失败");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [tab, reload]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1">
          {[
            ["posts", "我的发布", FilePenLine],
            ["bookmarks", "收藏", Bookmark],
            ["notifications", "动态", Bell],
            ["analytics", "数据", BarChart3],
            ["profile", "资料", UserRound],
          ].map(([value, label, Icon]) => (
            <Button
              key={String(value)}
              variant="ghost"
              onClick={() => setTab(value as Tab)}
              aria-pressed={tab === value}
              className={`h-9 gap-1.5 px-3 text-xs ${tab === value ? "bg-surface-2 text-foreground" : "text-text-muted"}`}
            >
              <Icon size={14} /> {String(label)}
            </Button>
          ))}
        </div>
        <Link
          href="/app/publish"
          className="tool-button h-9 border-brand bg-brand px-3 text-xs text-on-accent hover:bg-brand-hover"
        >
          <Plus size={14} /> 发布灵感
        </Link>
      </div>

      {loading ? (
        <div className="surface-panel mt-5 min-h-64 p-6 text-sm text-text-muted">
          正在读取…
        </div>
      ) : null}

      {!loading && loadError ? (
        <div
          role="alert"
          className="mt-5 flex min-h-48 flex-col items-center justify-center gap-3 text-center"
        >
          <p className="text-sm text-danger">{loadError}</p>
          <Button onClick={() => setReload((value) => value + 1)}>
            重新加载
          </Button>
        </div>
      ) : null}
      {!loading && !loadError && tab === "posts" ? (
        posts.length ? (
          <div className="mt-5 columns-1 gap-4 md:columns-2 xl:columns-3">
            {posts.map((post) => (
              <div key={post.id} className="relative mb-4 break-inside-avoid">
                <InspirationCard post={post} basePath="/app/inspiration" />
                {post.status !== "PUBLISHED" ? (
                  <span className="absolute left-3 top-3 z-10 rounded-full bg-background/85 px-2 py-1 text-[10px] text-text-muted backdrop-blur">
                    {post.status === "DRAFT"
                      ? "草稿"
                      : post.status === "PENDING"
                        ? "审核中"
                        : "已隐藏"}
                  </span>
                ) : null}
                <div className="absolute right-2 top-2 z-20 flex gap-1 rounded-lg border border-border bg-background/90 p-1 shadow-sm backdrop-blur">
                  <Link
                    href={`/app/publish?edit=${post.id}`}
                    className="tool-button h-7 px-2 text-[10px] text-text-muted"
                  >
                    <Pencil size={11} /> 编辑
                  </Link>
                  <Button
                    variant="ghost"
                    className="h-7 gap-1 px-2 text-[10px] text-danger"
                    disabled={deletingId === post.id}
                    onClick={() => void removePost(post)}
                  >
                    <Trash2 size={11} /> 删除
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty
            title="还没有发布"
            description="可以从生成结果直接发布，也可以提出一个纯文字设计问题。"
          />
        )
      ) : null}

      {!loading && tab === "bookmarks" ? <BookmarkCollectionsView /> : null}

      {!loading && tab === "notifications" ? <NotificationList /> : null}

      {!loading && !loadError && tab === "analytics" && analytics ? (
        <div className="mt-5 space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="公开发布" value={analytics.totals.published} />
            <Metric label="累计收到互动" value={analytics.totals.engagement} />
            <Metric
              label="篇均互动"
              value={analytics.averages.engagementPerPublished}
            />
            <Metric
              label="被继续创作"
              value={analytics.totals.derived}
              accent
            />
          </div>
          <div className="surface-panel flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
                <Sparkles size={19} />
              </span>
              <div>
                <p className="text-sm font-medium">
                  每日挑战连续参与 {analytics.challenge.currentStreak} 天
                </p>
                <p className="mt-1 text-xs text-text-muted">
                  最长 {analytics.challenge.bestStreak} 天 · 累计参与{" "}
                  {analytics.challenge.totalDays} 天
                  {analytics.challenge.participatedToday
                    ? " · 今天已完成"
                    : analytics.challenge.currentStreak
                      ? " · 今天回应即可续上"
                      : ""}
                </p>
              </div>
            </div>
            <Link
              href="/app/inspiration/daily"
              className="tool-button h-9 shrink-0 px-3 text-xs text-text-muted"
            >
              {analytics.challenge.participatedToday
                ? "查看今日讨论"
                : "参与今日挑战"}
            </Link>
          </div>
          <section className="surface-panel p-5">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="eyebrow">Recent response</p>
                <h2 className="mt-1 text-sm font-medium">近 14 天收到的互动</h2>
              </div>
              <span className="font-mono text-xl">
                {analytics.activity.total}
              </span>
            </div>
            <ActivityBars days={analytics.activity.days} />
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-text-muted">
              <span>
                赞{" "}
                {analytics.activity.days.reduce(
                  (sum, item) => sum + item.likes,
                  0,
                )}
              </span>
              <span>
                收藏{" "}
                {analytics.activity.days.reduce(
                  (sum, item) => sum + item.bookmarks,
                  0,
                )}
              </span>
              <span>
                讨论{" "}
                {analytics.activity.days.reduce(
                  (sum, item) => sum + item.comments,
                  0,
                )}
              </span>
              <span className="text-brand">
                衍生{" "}
                {analytics.activity.days.reduce(
                  (sum, item) => sum + item.derived,
                  0,
                )}
              </span>
            </div>
          </section>
          <div className="grid gap-5 lg:grid-cols-2">
            <Breakdown
              title="发布学科"
              items={analytics.breakdown.disciplines}
              labels={DISCIPLINE_LABELS}
            />
            <Breakdown
              title="内容类型"
              items={analytics.breakdown.shapes}
              labels={SHAPE_LABELS}
            />
          </div>
          <div className="surface-panel overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <span className="text-xs font-medium">内容表现</span>
              <span className="text-[10px] text-text-faint">按总互动排序</span>
            </div>
            {analytics.posts.length ? (
              analytics.posts.map((post) => (
                <Link
                  key={post.id}
                  href={`/app/inspiration/${post.id}`}
                  className="grid gap-1 border-b border-border px-4 py-3 last:border-0 hover:bg-surface-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-4"
                >
                  <span className="truncate text-sm">{post.title}</span>
                  <span className="font-mono text-[10px] text-text-muted">
                    互动 {post.engagement} · 赞 {post.likeCount} · 藏{" "}
                    {post.bookmarkCount} · 讨论 {post.commentCount} · 衍生{" "}
                    {post.derivedCount}
                  </span>
                </Link>
              ))
            ) : (
              <p className="px-4 py-8 text-center text-sm text-text-muted">
                发布内容后，这里会显示互动表现。
              </p>
            )}
          </div>
        </div>
      ) : null}

      {!loading && tab === "profile" ? <DesignerProfileEditor /> : null}
    </div>
  );
}

function Empty({ title, description }: { title: string; description: string }) {
  return (
    <div className="surface-panel mt-5 flex min-h-64 flex-col items-center justify-center gap-2 px-6 text-center">
      <h2 className="text-lg font-medium">{title}</h2>
      <p className="max-w-sm text-sm leading-6 text-text-muted">
        {description}
      </p>
    </div>
  );
}

function Metric({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div className="surface-panel p-5">
      <p className="text-xs text-text-muted">{label}</p>
      <p
        className={`mt-2 font-mono text-3xl ${accent ? "text-brand" : "text-foreground"}`}
      >
        {value}
      </p>
    </div>
  );
}

function ActivityBars({ days }: { days: Analytics["activity"]["days"] }) {
  const maximum = Math.max(1, ...days.map((item) => item.total));
  return (
    <div className="mt-5">
      <div
        className="grid h-28 items-end gap-1"
        style={{
          gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`,
        }}
      >
        {days.map((item) => (
          <div
            key={item.day}
            className="group relative flex h-full items-end"
            title={`${item.day}：${item.total} 次互动`}
          >
            <span
              className="w-full min-w-1 rounded-sm bg-brand/70 transition-colors group-hover:bg-brand"
              style={{
                height: item.total
                  ? `${Math.max(8, (item.total / maximum) * 100)}%`
                  : "2px",
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between font-mono text-[9px] text-text-faint">
        <span>{days[0]?.day.slice(5)}</span>
        <span>{days.at(-1)?.day.slice(5)}</span>
      </div>
    </div>
  );
}

function Breakdown({
  title,
  items,
  labels,
}: {
  title: string;
  items: Analytics["breakdown"]["disciplines"];
  labels: Record<string, string>;
}) {
  const maximum = Math.max(1, ...items.map((item) => item.posts));
  return (
    <section className="surface-panel p-5">
      <h2 className="text-sm font-medium">{title}</h2>
      {items.length ? (
        <div className="mt-4 space-y-3">
          {items.map((item) => (
            <div key={item.value}>
              <div className="flex items-center justify-between gap-3 text-xs">
                <span>{labels[item.value] ?? item.value}</span>
                <span className="font-mono text-text-muted">
                  {item.posts} 篇 · {item.engagement} 互动
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full bg-brand/70"
                  style={{ width: `${(item.posts / maximum) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-xs text-text-muted">暂无公开内容。</p>
      )}
    </section>
  );
}
