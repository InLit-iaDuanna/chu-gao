"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Folder, FolderPlus, Images, Pencil, Trash2 } from "lucide-react";

import { Button, Checkbox, DropdownMenu, DropdownMenuItem, DropdownMenuSeparator, Input, useToast } from "@/components/ui";
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
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
  const [selectedMediaIds, setSelectedMediaIds] = useState<Set<string>>(new Set());
  const [newName, setNewName] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  const load = useCallback(async (collectionId: string | null) => {
    setLoading(true);
    try {
      const query = collectionId ? `?collectionId=${encodeURIComponent(collectionId)}` : "";
      const data = await inspirationRequest<BookmarksPayload>(`/api/inspiration/me/bookmarks${query}`);
      setItems(data.items);
      setCollections(data.collections);
      const visibleMedia = new Set(data.items.flatMap((post) => post.media.map((media) => media.id)));
      setSelectedMediaIds((current) => new Set([...current].filter((id) => visibleMedia.has(id))));
    } catch (error) {
      toast({ title: "收藏读取失败", description: error instanceof Error ? error.message : "请稍后重试", variant: "danger" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(selectedCollectionId); }, [load, selectedCollectionId]);

  const selectedCollection = collections.find((item) => item.id === selectedCollectionId) ?? null;
  const selectedCount = selectedMediaIds.size;
  const allVisibleMedia = useMemo(() => items.flatMap((post) => post.media.map((media) => media.id)), [items]);

  const createCollection = async () => {
    const name = newName.trim();
    if (!name) return;
    setWorking(true);
    try {
      const collection = await inspirationRequest<BookmarkCollection>("/api/inspiration/bookmark-collections", { method: "POST", body: JSON.stringify({ name }) });
      setCollections((current) => [collection, ...current]);
      setNewName("");
      setSelectedCollectionId(collection.id);
      toast({ title: `已创建「${collection.name}」`, variant: "success" });
    } catch (error) {
      toast({ title: "创建收藏夹失败", description: error instanceof Error ? error.message : "请稍后重试", variant: "danger" });
    } finally {
      setWorking(false);
    }
  };

  const renameSelected = async () => {
    if (!selectedCollection) return;
    const name = window.prompt("新的收藏夹名称", selectedCollection.name)?.trim();
    if (!name || name === selectedCollection.name) return;
    try {
      const updated = await inspirationRequest<BookmarkCollection>(`/api/inspiration/bookmark-collections/${selectedCollection.id}`, { method: "PATCH", body: JSON.stringify({ name }) });
      setCollections((current) => current.map((item) => item.id === updated.id ? { ...item, ...updated } : item));
    } catch (error) {
      toast({ title: "重命名失败", description: error instanceof Error ? error.message : "请稍后重试", variant: "danger" });
    }
  };

  const deleteSelected = async () => {
    if (!selectedCollection || !window.confirm(`删除收藏夹「${selectedCollection.name}」？帖子仍会保留在全部收藏中。`)) return;
    try {
      await inspirationRequest<{ deleted: boolean }>(`/api/inspiration/bookmark-collections/${selectedCollection.id}`, { method: "DELETE" });
      setSelectedCollectionId(null);
      setCollections((current) => current.filter((item) => item.id !== selectedCollection.id));
    } catch (error) {
      toast({ title: "删除收藏夹失败", description: error instanceof Error ? error.message : "请稍后重试", variant: "danger" });
    }
  };

  const toggleMembership = async (post: BookmarkedPost, collection: BookmarkCollection) => {
    const included = post.collectionIds.includes(collection.id);
    try {
      await inspirationRequest(included ? `/api/inspiration/bookmark-collections/${collection.id}/items` : `/api/inspiration/bookmark-collections/${collection.id}/items`, {
        method: included ? "DELETE" : "POST",
        body: JSON.stringify({ postId: post.id }),
      });
      setCollections((current) => current.map((item) => item.id === collection.id ? { ...item, itemCount: Math.max(0, item.itemCount + (included ? -1 : 1)) } : item));
      if (included && selectedCollectionId === collection.id) {
        setItems((current) => current.filter((item) => item.id !== post.id));
      } else {
        setItems((current) => current.map((item) => item.id === post.id ? { ...item, collectionIds: included ? item.collectionIds.filter((id) => id !== collection.id) : [...item.collectionIds, collection.id] } : item));
      }
    } catch (error) {
      toast({ title: "收藏夹更新失败", description: error instanceof Error ? error.message : "请稍后重试", variant: "danger" });
    }
  };

  const togglePostMedia = (post: BookmarkedPost) => {
    const ids = post.media.map((media) => media.id);
    const allSelected = ids.length > 0 && ids.every((id) => selectedMediaIds.has(id));
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
    if (!allSelected && selectedCount + ids.filter((id) => !selectedMediaIds.has(id)).length > 16) toast({ title: "一次最多带入 16 张参考图" });
  };

  const materializeSelected = async () => {
    if (!selectedMediaIds.size) return;
    setWorking(true);
    try {
      const result = await inspirationRequest<{ references: Array<{ key: string }> }>("/api/inspiration/me/bookmarks/references", {
        method: "POST",
        body: JSON.stringify({ mediaIds: [...selectedMediaIds] }),
      });
      const query = new URLSearchParams();
      result.references.forEach((item) => query.append("reference", item.key));
      router.push(`/app?${query.toString()}`);
    } catch (error) {
      toast({ title: "参考图回流失败", description: error instanceof Error ? error.message : "请稍后重试", variant: "danger" });
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="mt-5 space-y-4">
      <section className="surface-panel p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant={selectedCollectionId ? "ghost" : "secondary"} className="h-8 px-3 text-xs" onClick={() => setSelectedCollectionId(null)}><Folder size={13} /> 全部收藏</Button>
          {collections.map((collection) => <Button key={collection.id} variant={selectedCollectionId === collection.id ? "secondary" : "ghost"} className="h-8 px-3 text-xs" onClick={() => setSelectedCollectionId(collection.id)}>{collection.name}<span className="font-mono text-[10px] text-text-faint">{collection.itemCount}</span></Button>)}
          <div className="ml-auto flex min-w-56 gap-2"><Input value={newName} maxLength={40} placeholder="新建具名收藏夹" onChange={(event) => setNewName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void createCollection(); }} /><Button className="h-8 px-3 text-xs" disabled={!newName.trim() || working} onClick={() => void createCollection()}><FolderPlus size={13} /> 新建</Button></div>
        </div>
        {selectedCollection ? <div className="mt-3 flex items-center gap-2 border-t border-border pt-3 text-xs text-text-muted"><span>正在查看「{selectedCollection.name}」</span><Button variant="ghost" className="ml-auto h-7 px-2 text-[11px]" onClick={() => void renameSelected()}><Pencil size={12} /> 重命名</Button><Button variant="ghost" className="h-7 px-2 text-[11px] text-danger" onClick={() => void deleteSelected()}><Trash2 size={12} /> 删除</Button></div> : null}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-text-muted">勾选收藏中的图片，可批量复制为你自己的 referenceImageKeys，直接带回工作台继续创作。</p>
        <div className="flex items-center gap-2"><Button variant="ghost" className="h-8 px-2 text-xs" disabled={!allVisibleMedia.length} onClick={() => setSelectedMediaIds(new Set(allVisibleMedia.slice(0, 16)))}>选择可见图片</Button><Button className="h-8 px-3 text-xs" loading={working} disabled={!selectedCount} onClick={() => void materializeSelected()}><Images size={13} /> 带 {selectedCount} 张进入创作</Button></div>
      </div>

      {loading ? <div className="surface-panel min-h-64 p-6 text-sm text-text-muted">正在读取收藏…</div> : items.length ? (
        <div className="columns-1 gap-4 md:columns-2 xl:columns-3">
          {items.map((post) => {
            const postMediaIds = post.media.map((media) => media.id);
            const checked = Boolean(postMediaIds.length && postMediaIds.every((id) => selectedMediaIds.has(id)));
            return <div key={post.id} className="mb-4 break-inside-avoid"><div className="surface-panel mb-2 flex items-center gap-2 px-3 py-2"><label className="flex cursor-pointer items-center gap-2 text-xs text-text-muted"><Checkbox checked={checked} disabled={!postMediaIds.length} onChange={() => togglePostMedia(post)} />{postMediaIds.length ? `参考图片 ${postMediaIds.length} 张` : "无可用图片"}</label><DropdownMenu className="min-w-52" trigger={<Button variant="ghost" className="ml-auto h-7 gap-1 px-2 text-[11px]"><Folder size={12} /> 收藏夹 <ChevronDown size={11} /></Button>}>
              {collections.length ? collections.map((collection) => { const included = post.collectionIds.includes(collection.id); return <DropdownMenuItem key={collection.id} onClick={() => void toggleMembership(post, collection)}><span className={`flex h-4 w-4 items-center justify-center rounded border ${included ? "border-brand bg-brand text-on-accent" : "border-border"}`}>{included ? <Check size={11} /> : null}</span>{collection.name}</DropdownMenuItem>; }) : <DropdownMenuItem disabled>先创建一个收藏夹</DropdownMenuItem>}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => { setNewName("新收藏夹"); }}>新建收藏夹…</DropdownMenuItem>
            </DropdownMenu></div><InspirationCard post={post} basePath="/app/inspiration" /></div>;
          })}
        </div>
      ) : <div className="surface-panel flex min-h-64 flex-col items-center justify-center gap-2 px-6 text-center"><Folder size={20} className="text-text-faint" /><h2 className="text-lg font-medium">{selectedCollection ? "这个收藏夹还是空的" : "还没有收藏"}</h2><p className="max-w-sm text-sm leading-6 text-text-muted">在广场收藏值得继续推演的内容，再按项目或方向整理到具名收藏夹。</p></div>}
    </div>
  );
}
