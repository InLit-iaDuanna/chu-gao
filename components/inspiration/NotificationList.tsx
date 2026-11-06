"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Bell, CheckCheck, GitFork, Heart, MessageCircle } from "lucide-react";

import { Button, useToast } from "@/components/ui";
import { inspirationRequest } from "./api";

interface NotificationItem {
  id: string;
  type: "COMMENT" | "LIKE" | "DERIVED";
  createdAt: string;
  actorName: string;
  text: string;
  href: string;
  isRead: boolean;
  readAt: string | null;
}

export function NotificationList() {
  const { toast } = useToast();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [marking, setMarking] = useState(false);

  useEffect(() => {
    inspirationRequest<{ items: NotificationItem[]; unreadCount: number }>(
      "/api/inspiration/notifications",
    )
      .then((data) => {
        setItems(
          data.items.map((item) => ({
            ...item,
            href: item.href.startsWith("/inspiration/")
              ? `/app${item.href}`
              : item.href,
          })),
        );
        setUnreadCount(data.unreadCount);
      })
      .catch((error) =>
        toast({
          title: "动态读取失败",
          description: error instanceof Error ? error.message : "请稍后重试",
          variant: "danger",
        }),
      )
      .finally(() => setLoading(false));
  }, [toast]);

  const markRead = useCallback(
    async (notificationIds: string[]) => {
      const unreadIds = notificationIds.filter((id) =>
        items.some((item) => item.id === id && !item.isRead),
      );
      if (!unreadIds.length) return;
      setItems((current) =>
        current.map((item) =>
          unreadIds.includes(item.id)
            ? { ...item, isRead: true, readAt: new Date().toISOString() }
            : item,
        ),
      );
      setUnreadCount((current) => Math.max(0, current - unreadIds.length));
      await inspirationRequest("/api/inspiration/notifications", {
        method: "PATCH",
        body: JSON.stringify({ notificationIds: unreadIds }),
      }).catch(() => undefined);
    },
    [items],
  );

  const markAll = async () => {
    if (!unreadCount) return;
    setMarking(true);
    try {
      await inspirationRequest("/api/inspiration/notifications", {
        method: "PATCH",
        body: JSON.stringify({ all: true }),
      });
      const now = new Date().toISOString();
      setItems((current) =>
        current.map((item) => ({
          ...item,
          isRead: true,
          readAt: item.readAt ?? now,
        })),
      );
      setUnreadCount(0);
    } catch (error) {
      toast({
        title: "标记失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "danger",
      });
    } finally {
      setMarking(false);
    }
  };

  const iconFor = (type: NotificationItem["type"]) =>
    type === "COMMENT" ? (
      <MessageCircle size={14} />
    ) : type === "LIKE" ? (
      <Heart size={14} />
    ) : (
      <GitFork size={14} />
    );

  if (loading)
    return (
      <div className="surface-panel mt-5 min-h-64 p-6 text-sm text-text-muted">
        正在读取动态…
      </div>
    );
  if (!items.length)
    return (
      <div className="surface-panel mt-5 flex min-h-64 flex-col items-center justify-center gap-2 px-6 text-center">
        <Bell size={20} className="text-text-faint" />
        <h2 className="text-lg font-medium">暂时没有新动态</h2>
        <p className="max-w-sm text-sm leading-6 text-text-muted">
          有人回应、点赞或接着你的想法创作时，会出现在这里。
        </p>
      </div>
    );

  return (
    <div className="mt-5 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-text-muted">
          {unreadCount ? `${unreadCount} 条未读动态` : "动态已全部读完"}
        </p>
        <Button
          variant="ghost"
          className="h-8 px-3 text-xs"
          loading={marking}
          disabled={!unreadCount}
          onClick={() => void markAll()}
        >
          <CheckCheck size={14} /> 全部标记已读
        </Button>
      </div>
      <div className="surface-panel divide-y divide-border overflow-hidden">
        {items.map((item) => (
          <Link
            key={item.id}
            href={item.href}
            onClick={() => void markRead([item.id])}
            className={`relative flex items-start gap-3 px-4 py-4 transition-colors hover:bg-surface-2 ${item.isRead ? "bg-transparent" : "bg-brand/[0.045]"}`}
          >
            {!item.isRead ? (
              <span
                className="absolute left-1.5 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-brand"
                aria-label="未读"
              />
            ) : null}
            <span
              className={`mt-0.5 flex h-8 w-8 items-center justify-center rounded-md border ${item.isRead ? "border-border text-text-muted" : "border-brand/35 bg-brand/10 text-brand"}`}
            >
              {iconFor(item.type)}
            </span>
            <div className="min-w-0 flex-1">
              <p
                className={`text-sm ${item.isRead ? "font-normal" : "font-medium"}`}
              >
                <strong>{item.actorName}</strong>{" "}
                <span className="text-text-muted">{item.text}</span>
              </p>
              <p className="mt-1 font-mono text-[10px] text-text-faint">
                {new Date(item.createdAt).toLocaleString("zh-CN")}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
