"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronDown,
  Folder,
  FolderPlus,
  Images,
  Pencil,
  Trash2,
} from "lucide-react";

import {
  Button,
  Checkbox,
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
  EmptyState,
  IconButton,
  Input,
  Select,
  useToast,
} from "@/components/ui";
import { inspirationRequest } from "./api";
import { InspirationCard } from "./InspirationCard";
import type { InspirationPost } from "./types";

interface BookmarkCollection {
  id: string;
  name: string;
  description: string | null;
  itemCount: number;
  updatedAt: string;
}

type BookmarkedPost = InspirationPost & { collectionIds: string[] };

interface BookmarksPayload {
  items: BookmarkedPost[];
  collections: BookmarkCollection[];
}

export function BookmarkCollectionsView() {
  const router = useRouter();
  const { toast } = useToast();
  const [items, setItems] = useState<BookmarkedPost[]>([]);
  const [collections, setCollections] = useState<BookmarkCollection[]>([]);
  const [selectedCollectionId, setSelectedCollectionId] = useState<
    string | null
  >(null);
  const [selectedMediaIds, setSelectedMediaIds] = useState<Set<string>>(
    new Set(),
  );
  const [newName, setNewName] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  const load = useCallback(
    async (collectionId: string | null) => {
      setLoading(true);
      try {
        const query = collectionId
          ? `?collectionId=${encodeURIComponent(collectionId)}`
          : "";
        const data = await inspirationRequest<BookmarksPayload>(
          `/api/inspiration/me/bookmarks${query}`,
        );
        setItems(data.items);
        setCollections(data.collections);
        const visibleMedia = new Set(
          data.items.flatMap((post) => post.media.map((media) => media.id)),
        );
        setSelectedMediaIds(
          (current) =>
            new Set([...current].filter((id) => visibleMedia.has(id))),
        );
      } catch (error) {
        toast({
          title: "收藏读取失败",
          description: error instanceof Error ? error.message : "请稍后重试",
          variant: "danger",
        });
      } finally {
        setLoading(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    void load(selectedCollectionId);
  }, [load, selectedCollectionId]);

  const selectedCollection =
    collections.find((item) => item.id === selectedCollectionId) ?? null;
  const selectedCount = selectedMediaIds.size;
  const allVisibleMedia = useMemo(
    () => items.flatMap((post) => post.media.map((media) => media.id)),
    [items],
  );

  const createCollection = async () => {
    const name = newName.trim();
    if (!name) return;
    setWorking(true);
    try {
      const collection = await inspirationRequest<BookmarkCollection>(
        "/api/inspiration/bookmark-collections",
        { method: "POST", body: JSON.stringify({ name }) },
      );
      setCollections((current) => [collection, ...current]);
      setNewName("");
      setSelectedCollectionId(collection.id);
      toast({ title: `已创建「${collection.name}」`, variant: "success" });
    } catch (error) {
      toast({
        title: "创建收藏夹失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "danger",
      });
    } finally {
      setWorking(false);
    }
  };

  const renameSelected = async () => {
    if (!selectedCollection) return;
    const name = window
      .prompt("新的收藏夹名称", selectedCollection.name)
      ?.trim();
    if (!name || name === selectedCollection.name) return;
    try {
      const updated = await inspirationRequest<BookmarkCollection>(
        `/api/inspiration/bookmark-collections/${selectedCollection.id}`,
        { method: "PATCH", body: JSON.stringify({ name }) },
      );
      setCollections((current) =>
        current.map((item) =>
          item.id === updated.id ? { ...item, ...updated } : item,
        ),
      );
    } catch (error) {
      toast({
        title: "重命名失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "danger",
      });
    }
  };

  const deleteSelected = async () => {
    if (
      !selectedCollection ||
      !window.confirm(
        `删除收藏夹「${selectedCollection.name}」？帖子仍会保留在全部收藏中。`,
      )
    )
      return;
    try {
      await inspirationRequest<{ deleted: boolean }>(
        `/api/inspiration/bookmark-collections/${selectedCollection.id}`,
        { method: "DELETE" },
      );
      setSelectedCollectionId(null);
      setCollections((current) =>
        current.filter((item) => item.id !== selectedCollection.id),
      );
    } catch (error) {
      toast({
        title: "删除收藏夹失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "danger",
      });
    }
  };

  const toggleMembership = async (
    post: BookmarkedPost,
    collection: BookmarkCollection,
  ) => {
    const included = post.collectionIds.includes(collection.id);
    try {
      await inspirationRequest(
        included
          ? `/api/inspiration/bookmark-collections/${collection.id}/items`
          : `/api/inspiration/bookmark-collections/${collection.id}/items`,
        {
          method: included ? "DELETE" : "POST",
          body: JSON.stringify({ postId: post.id }),
        },
      );
      setCollections((current) =>
        current.map((item) =>
          item.id === collection.id
            ? {
                ...item,
                itemCount: Math.max(0, item.itemCount + (included ? -1 : 1)),
              }
            : item,
        ),
      );
      if (included && selectedCollectionId === collection.id) {
        setItems((current) => current.filter((item) => item.id !== post.id));
      } else {
        setItems((current) =>
          current.map((item) =>
            item.id === post.id
              ? {
                  ...item,
                  collectionIds: included
                    ? item.collectionIds.filter((id) => id !== collection.id)
                    : [...item.collectionIds, collection.id],
                }
              : item,
          ),
        );
      }
    } catch (error) {
      toast({
        title: "收藏夹更新失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "danger",
      });
    }
  };

  const togglePostMedia = (post: BookmarkedPost) => {
    const ids = post.media.map((media) => media.id);
    const allSelected =
      ids.length > 0 && ids.every((id) => selectedMediaIds.has(id));
    setSelectedMediaIds((current) => {
      const next = new Set(current);
      if (allSelected) ids.forEach((id) => next.delete(id));
      else {
        for (const id of ids) {
          if (next.size >= 16) break;
          next.add(id);
        }
      }
      return next;
    });
    if (
      !allSelected &&
      selectedCount + ids.filter((id) => !selectedMediaIds.has(id)).length > 16
    )
      toast({ title: "一次最多带入 16 张参考图" });
  };

  const materializeSelected = async () => {
    if (!selectedMediaIds.size) return;
    setWorking(true);
    try {
      const result = await inspirationRequest<{
        references: Array<{ key: string }>;
      }>("/api/inspiration/me/bookmarks/references", {
        method: "POST",
        body: JSON.stringify({ mediaIds: [...selectedMediaIds] }),
      });
      const query = new URLSearchParams();
      result.references.forEach((item) => query.append("reference", item.key));
      router.push(`/app?${query.toString()}`);
    } catch (error) {
      toast({
        title: "参考图回流失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "danger",
      });
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="mt-5 min-w-0 space-y-4 text-sm tracking-normal">
      <section className="border-b border-border pb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Select
            aria-label="收藏夹"
            value={selectedCollectionId ?? "all"}
            onValueChange={(value) =>
              setSelectedCollectionId(value === "all" ? null : value)
            }
            className="h-9 min-w-0 sm:max-w-64 [&>span:first-child]:truncate"
            contentClassName="max-w-[calc(100vw-32px)]"
            options={[
              { value: "all", label: "全部收藏" },
              ...collections.map((collection) => ({
                value: collection.id,
                label: (
                  <span className="block max-w-56 truncate">
                    {collection.name} · {collection.itemCount}
                  </span>
                ),
              })),
            ]}
          />
          <div className="flex min-w-0 gap-2 sm:ml-auto sm:w-80">
            <Input
              aria-label="新收藏夹名称"
              className="h-9 min-w-0"
              value={newName}
              maxLength={40}
              placeholder="新收藏夹名称"
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void createCollection();
              }}
            />
            <Button
              disabled={!newName.trim() || working}
              onClick={() => void createCollection()}
            >
              <FolderPlus size={16} /> 新建
            </Button>
          </div>
        </div>
        {selectedCollection ? (
          <div className="mt-3 flex items-center gap-2 text-xs text-text-muted">
            <span className="min-w-0 flex-1 break-words">
              正在查看「{selectedCollection.name}」
            </span>
            <IconButton
              aria-label="重命名收藏夹"
              title="重命名收藏夹"
              className="h-9 w-9"
              onClick={() => void renameSelected()}
            >
              <Pencil size={16} />
            </IconButton>
            <IconButton
              variant="danger"
              aria-label="删除收藏夹"
              title="删除收藏夹"
              className="h-9 w-9"
              onClick={() => void deleteSelected()}
            >
              <Trash2 size={16} />
            </IconButton>
          </div>
        ) : null}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-text-muted">
          已选 {selectedCount}/16 张参考图
        </p>
        <div className="flex max-w-full flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            disabled={!allVisibleMedia.length}
            onClick={() =>
              setSelectedMediaIds(new Set(allVisibleMedia.slice(0, 16)))
            }
          >
            选择可见图片
          </Button>
          <Button
            variant="primary"
            loading={working}
            disabled={!selectedCount}
            onClick={() => void materializeSelected()}
          >
            <Images size={16} /> 带 {selectedCount} 张进入创作
          </Button>
        </div>
      </div>

      {loading ? (
        <div role="status" className="min-h-64 py-6 text-sm text-text-muted">
          正在读取收藏…
        </div>
      ) : items.length ? (
        <div className="columns-1 gap-4 md:columns-2 xl:columns-3">
          {items.map((post) => {
            const postMediaIds = post.media.map((media) => media.id);
            const checked = Boolean(
              postMediaIds.length &&
              postMediaIds.every((id) => selectedMediaIds.has(id)),
            );
            return (
              <div key={post.id} className="mb-4 min-w-0 break-inside-avoid">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <label className="flex min-h-9 cursor-pointer items-center gap-2 text-xs text-text-muted">
                    <Checkbox
                      checked={checked}
                      disabled={!postMediaIds.length}
                      onChange={() => togglePostMedia(post)}
                    />
                    {postMediaIds.length
                      ? `参考图片 ${postMediaIds.length} 张`
                      : "无可用图片"}
                  </label>
                  <DropdownMenu
                    className="min-w-52 max-w-[calc(100vw-32px)]"
                    trigger={
                      <Button
                        variant="ghost"
                        className="ml-auto gap-1 px-2 text-xs"
                      >
                        <Folder size={14} /> 收藏夹 <ChevronDown size={14} />
                      </Button>
                    }
                  >
                    {collections.length ? (
                      collections.map((collection) => {
                        const included = post.collectionIds.includes(
                          collection.id,
                        );
                        return (
                          <DropdownMenuItem
                            key={collection.id}
                            className="[&>span]:whitespace-normal"
                            onClick={() =>
                              void toggleMembership(post, collection)
                            }
                          >
                            <span
                              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${included ? "border-brand bg-brand text-on-accent" : "border-border"}`}
                            >
                              {included ? <Check size={11} /> : null}
                            </span>
                            <span className="min-w-0 break-words">
                              {collection.name}
                            </span>
                          </DropdownMenuItem>
                        );
                      })
                    ) : (
                      <DropdownMenuItem disabled>
                        先创建一个收藏夹
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => {
                        setNewName("新收藏夹");
                      }}
                    >
                      新建收藏夹…
                    </DropdownMenuItem>
                  </DropdownMenu>
                </div>
                <InspirationCard post={post} basePath="/app/inspiration" />
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState
          className="min-h-64"
          icon={Folder}
          title={selectedCollection ? "这个收藏夹还是空的" : "还没有收藏"}
          description="收藏值得继续推演的内容，按项目或方向整理。"
        />
      )}
    </div>
  );
}
