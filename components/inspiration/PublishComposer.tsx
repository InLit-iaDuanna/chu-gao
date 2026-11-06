"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ImagePlus,
  LoaderCircle,
  Plus,
  Send,
  Sparkles,
  Upload,
  X,
} from "lucide-react";

import {
  Button,
  Checkbox,
  Input,
  Select,
  Textarea,
  useToast,
} from "@/components/ui";
import {
  getPpt,
  listGenerations,
  uploadReferenceImage,
} from "@/components/studio/lib/api";
import type { Generation } from "@/components/studio/lib/types";
import { buildPptPublishPrefill } from "@/components/studio/ppt/ppt-publish";
import { inspirationRequest } from "./api";
import {
  readPublishPreload,
  removePublishPreload,
  type PublishPreloadMedia,
  type PublishPreloadSource,
} from "./publish-preload";
import type {
  Discipline,
  InspirationPost,
  PostShape,
  PromptVisibility,
} from "./types";

const SHAPES: Array<{ value: PostShape; label: string; description: string }> =
  [
    { value: "WORK", label: "作品", description: "成品与创作说明" },
    {
      value: "TEARDOWN",
      label: "拆解",
      description: "分析现有产品、界面或物件",
    },
    { value: "PATTERN", label: "模式", description: "可复用的结构或交互范式" },
    { value: "QUESTION", label: "命题", description: "抛出值得讨论的设计问题" },
    {
      value: "REFERENCE",
      label: "参考",
      description: "外部好东西，以及它为何值得看",
    },
    { value: "PROCESS", label: "过程", description: "从问题到方案的推演路径" },
  ];

const DISCIPLINES: Array<{ value: Discipline; label: string }> = [
  { value: "GRAPHIC", label: "视觉平面" },
  { value: "PRODUCT", label: "产品体验" },
  { value: "INDUSTRIAL", label: "工业硬件" },
  { value: "SERVICE", label: "服务流程" },
  { value: "SPATIAL", label: "空间环境" },
  { value: "BRAND", label: "品牌策略" },
  { value: "MOTION", label: "动态影像" },
  { value: "DATAVIZ", label: "信息可视化" },
];

type SelectedMedia = {
  key: string;
  existingMediaId?: string;
  imageId?: string;
  sourceKey?: string;
  mimeType?: string;
  preview: string;
  role: "FINAL" | "PROCESS";
  isCover: boolean;
};

function toSelectedMedia(
  media: PublishPreloadMedia,
  index: number,
  shape?: PostShape,
): SelectedMedia {
  return {
    key: media.sourceGeneratedImageId
      ? `generated:${media.sourceGeneratedImageId}`
      : `upload:${media.sourceKey ?? index}`,
    ...(media.sourceGeneratedImageId
      ? { imageId: media.sourceGeneratedImageId }
      : {}),
    ...(media.sourceKey ? { sourceKey: media.sourceKey } : {}),
    ...(media.mimeType ? { mimeType: media.mimeType } : {}),
    preview: media.preview,
    role: media.role ?? (shape === "PROCESS" ? "PROCESS" : "FINAL"),
    isCover: media.isCover ?? index === 0,
  };
}

export function PublishComposer() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [shape, setShape] = useState<PostShape>(
    (searchParams.get("shape") as PostShape) || "WORK",
  );
  const [discipline, setDiscipline] = useState<Discipline>(
    (searchParams.get("discipline") as Discipline) || "GRAPHIC",
  );
  const [title, setTitle] = useState("");
  const [story, setStory] = useState("");
  const [origin, setOrigin] = useState("ORIGINAL");
  const [externalUrl, setExternalUrl] = useState("");
  const [sourceNote, setSourceNote] = useState("");
  const [promptVisibility, setPromptVisibility] =
    useState<PromptVisibility>("STRUCTURE_ONLY");
  const [tagValue, setTagValue] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [selected, setSelected] = useState<SelectedMedia[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState("");
  const [preloadToken, setPreloadToken] = useState<string | null>(null);
  const [preloadSource, setPreloadSource] =
    useState<PublishPreloadSource | null>(null);
  const editId = searchParams.get("edit");
  const [editingPost, setEditingPost] = useState<InspirationPost | null>(null);
  const [editLoading, setEditLoading] = useState(Boolean(editId));
  const [editLoadFailed, setEditLoadFailed] = useState(false);

  useEffect(() => {
    if (!editId) return;
    let cancelled = false;
    setEditingPost(null);
    setEditLoadFailed(false);
    setEditLoading(true);
    inspirationRequest<InspirationPost>(`/api/inspiration/posts/${editId}`)
      .then((post) => {
        if (cancelled) return;
        if (!post.viewer.isAuthor) throw new Error("你不能编辑这条帖子");
        setEditingPost(post);
        setShape(post.shape);
        setDiscipline(post.discipline);
        setTitle(post.title);
        setStory(post.story ?? "");
        setOrigin(post.origin);
        setExternalUrl(post.externalUrl ?? "");
        setSourceNote(post.sourceNote ?? "");
        setPromptVisibility(post.promptVisibility);
        setTags(post.tags.map((tag) => tag.name));
        setSelected(
          post.media.map((media) => ({
            key: `existing:${media.id}`,
            existingMediaId: media.id,
            preview: media.thumbnailUrl || media.url,
            role: media.role,
            isCover: media.isCover,
          })),
        );
        setNotice(
          post.status === "PUBLISHED"
            ? "正在编辑已发布内容；现有图片会保留，可继续补充新图片。"
            : "已载入草稿，你可以继续补充后再保存或提交。",
        );
      })
      .catch((cause) => {
        if (!cancelled) {
          setEditLoadFailed(true);
          setNotice(cause instanceof Error ? cause.message : "草稿读取失败");
        }
      })
      .finally(() => {
        if (!cancelled) setEditLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [editId]);

  useEffect(() => {
    if (editId) return;
    const token = searchParams.get("preload");
    if (!token) return;

    try {
      const preload = readPublishPreload(token);
      if (!preload) {
        setNotice("这份画布预填已失效，请从 Canvas 重新点击“发灵感”。");
        return;
      }

      setPreloadToken(token);
      setPreloadSource(preload.source);
      if (preload.shape) setShape(preload.shape);
      if (preload.discipline) setDiscipline(preload.discipline);
      if (preload.title) setTitle(preload.title);
      if (preload.story) setStory(preload.story);
      if (preload.origin) setOrigin(preload.origin);
      if (preload.externalUrl) setExternalUrl(preload.externalUrl);
      if (preload.sourceNote) setSourceNote(preload.sourceNote);
      if (preload.promptVisibility)
        setPromptVisibility(preload.promptVisibility);
      if (preload.tags) setTags(preload.tags);
      if (preload.media?.length) {
        setSelected(
          preload.media.map((media, index) =>
            toSelectedMedia(media, index, preload.shape),
          ),
        );
      }
    } catch {
      setNotice("无法读取这份预填内容，请从 Canvas 重新点击“发灵感”。");
    }
  }, [editId, searchParams]);

  useEffect(() => {
    if (editId) return;
    const source = searchParams.get("source");
    const pptId = searchParams.get("pptId");
    if (source !== "ppt" || !pptId) return;

    let cancelled = false;
    getPpt(pptId)
      .then((deck) => {
        if (cancelled) return;
        const prefill = buildPptPublishPrefill(deck);
        if (!prefill.media.length) {
          setNotice("这份 PPT 还没有已完成的页面，请先生成至少一页再发布。");
          return;
        }
        setShape("WORK");
        setPreloadSource("PPT");
        setTitle(prefill.title);
        setStory(prefill.story);
        setTags(prefill.tags);
        setPromptVisibility(prefill.promptVisibility);
        setSelected(
          prefill.media.map((media) => ({
            key: media.key,
            imageId: media.imageId,
            preview: media.preview,
            role: media.role,
            isCover: media.isCover,
          })),
        );
        setNotice(
          prefill.truncated
            ? `PPT 共 ${prefill.completedMediaCount} 张已完成页面，发布器已带入前 9 张；你可以继续调整。`
            : `已从 PPT 带入 ${prefill.media.length} 张已完成页面。`,
        );
      })
      .catch((cause) => {
        if (!cancelled) {
          setNotice(
            cause instanceof Error
              ? cause.message
              : "无法读取这份 PPT，请稍后重试。",
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [editId, searchParams]);

  useEffect(() => {
    listGenerations({ limit: 50, status: "SUCCEEDED" })
      .then((page) => {
        setGenerations(page.items);
        const imageId =
          editId ||
          searchParams.get("preload") ||
          searchParams.get("source") === "ppt"
            ? null
            : searchParams.get("imageId");
        if (imageId) {
          for (const generation of page.items) {
            const image = generation.images.find((item) => item.id === imageId);
            if (image) {
              setSelected([
                {
                  key: `generated:${image.id}`,
                  imageId: image.id,
                  preview: image.thumbnailUrl || image.url,
                  role: "FINAL",
                  isCover: true,
                },
              ]);
              setTitle((current) => current || "生成作品");
              break;
            }
          }
        }
      })
      .catch(() => setGenerations([]))
      .finally(() => setHistoryLoading(false));
  }, [editId, searchParams]);

  const allImages = useMemo(
    () =>
      generations.flatMap((generation) =>
        generation.images.map((image) => ({ generation, image })),
      ),
    [generations],
  );

  const toggleImage = (
    generation: Generation,
    image: Generation["images"][number],
  ) => {
    if (shape === "REFERENCE") return;
    setSelected((current) => {
      const exists = current.some((item) => item.imageId === image.id);
      if (exists) {
        const next = current.filter((item) => item.imageId !== image.id);
        if (next.length && !next.some((item) => item.isCover))
          next[0] = { ...next[0], isCover: true };
        return next;
      }
      if (current.length >= 9) {
        toast({ title: "最多选择 9 张图片" });
        return current;
      }
      if (!title) setTitle("生成作品");
      return [
        ...current,
        {
          key: `generated:${image.id}`,
          imageId: image.id,
          preview: image.thumbnailUrl || image.url,
          role: shape === "PROCESS" ? "PROCESS" : "FINAL",
          isCover: current.length === 0,
        },
      ];
    });
  };

  const upload = async (file: File | null) => {
    if (
      !file ||
      selected.length >= 9 ||
      editingPost?.status === "HIDDEN" ||
      shape === "REFERENCE"
    )
      return;
    setUploading(true);
    try {
      const result = await uploadReferenceImage(file);
      const preview = URL.createObjectURL(file);
      setSelected((current) => [
        ...current,
        {
          key: `upload:${result.key}`,
          sourceKey: result.key,
          mimeType: result.mimeType,
          preview,
          role: shape === "PROCESS" ? "PROCESS" : "FINAL",
          isCover: current.length === 0,
        },
      ]);
    } catch (cause) {
      toast({
        title: "图片上传失败",
        description: cause instanceof Error ? cause.message : "请稍后重试",
        variant: "danger",
      });
    } finally {
      setUploading(false);
    }
  };

  const addTag = () => {
    const value = tagValue.trim().replace(/^#/, "");
    if (!value || tags.includes(value) || tags.length >= 12) return;
    setTags((current) => [...current, value]);
    setTagValue("");
  };

  const validate = () => {
    if (title.trim().length < 2) return "请填写标题";
    if (shape === "WORK" && selected.length === 0)
      return "作品类型必须选择图片";
    if (shape === "PROCESS" && selected.length < 2)
      return "过程类型至少需要两张图片";
    if (shape === "REFERENCE" && selected.length > 0)
      return "参考类型不附带站内图片，只保留外链和手写说明";
    if (shape === "REFERENCE" && (!externalUrl.trim() || !sourceNote.trim()))
      return "参考类型需要同时填写外链和来源说明";
    return "";
  };

  const submit = async (draft: boolean) => {
    if (uploading) {
      setNotice("图片仍在上传，请等待上传完成后再保存。");
      return;
    }
    if (editId && (!editingPost || editLoadFailed)) {
      setNotice("编辑内容尚未成功载入，请返回后重新进入编辑。");
      return;
    }
    const invalid = validate();
    if (invalid && (!draft || (shape === "REFERENCE" && selected.length > 0))) {
      setNotice(invalid);
      return;
    }
    setSubmitting(true);
    setNotice("");
    try {
      const newMedia = selected.filter((item) => !item.existingMediaId);
      const mediaPayload = newMedia.map((item) => ({
        sourceGeneratedImageId: item.imageId,
        sourceKey: item.sourceKey,
        mimeType: item.mimeType,
        role: item.role,
        isCover: item.isCover,
      }));

      if (editId && editingPost) {
        if (mediaPayload.length) {
          await inspirationRequest(`/api/inspiration/posts/${editId}/media`, {
            method: "POST",
            body: JSON.stringify({ media: mediaPayload }),
          });
          const appendedKeys = new Set(newMedia.map((item) => item.key));
          setSelected((current) =>
            current.map((item) =>
              !item.existingMediaId && appendedKeys.has(item.key)
                ? { ...item, existingMediaId: `appended:${item.key}` }
                : item,
            ),
          );
        }
        const requestedStatus =
          editingPost.status === "PUBLISHED" || editingPost.status === "HIDDEN"
            ? undefined
            : draft
              ? "DRAFT"
              : "PENDING";
        const post = await inspirationRequest<InspirationPost>(
          `/api/inspiration/posts/${editId}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              shape,
              discipline,
              title: title.trim() || "未命名草稿",
              story: story.trim() || null,
              origin,
              externalUrl: externalUrl.trim() || null,
              sourceNote: sourceNote.trim() || null,
              promptVisibility,
              tags,
              ...(requestedStatus ? { status: requestedStatus } : {}),
            }),
          },
        );
        toast({
          title:
            post.status === "PUBLISHED"
              ? "内容已更新"
              : post.status === "PENDING"
                ? "已提交审核"
                : "草稿已保存",
        });
        router.push(
          post.status === "PUBLISHED"
            ? `/app/inspiration/${post.id}`
            : "/app/inspiration?view=mine",
        );
        router.refresh();
        return;
      }

      const post = await inspirationRequest<InspirationPost>(
        "/api/inspiration/posts",
        {
          method: "POST",
          body: JSON.stringify({
            shape,
            discipline,
            title: title.trim() || "未命名草稿",
            story: story.trim() || null,
            origin,
            sourceType: preloadSource ?? "STANDARD",
            externalUrl: externalUrl.trim() || null,
            sourceNote: sourceNote.trim() || null,
            promptVisibility,
            tags,
            dailyPromptId: searchParams.get("dailyPrompt") || null,
            derivedFromPostId: searchParams.get("derivedFrom") || null,
            draft,
            media: mediaPayload,
          }),
        },
      );
      if (preloadToken) {
        try {
          removePublishPreload(preloadToken);
        } catch {
          // The post already exists; storage cleanup must not turn success into an error.
        }
      }
      toast({
        title: draft
          ? "草稿已保存"
          : post.status === "PUBLISHED"
            ? "已发布到灵感圈"
            : "已提交审核",
        description:
          post.status === "PENDING"
            ? "首帖通过审核后会自动出现在广场。"
            : undefined,
      });
      router.push(
        post.status === "PUBLISHED"
          ? `/app/inspiration/${post.id}`
          : "/app/inspiration?view=mine",
      );
      router.refresh();
    } catch (cause) {
      setNotice(
        cause instanceof Error ? cause.message : "发布失败，请稍后重试",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (editId && editLoading) {
    return (
      <div className="surface-panel min-h-72 p-6 text-sm text-text-muted">
        正在读取草稿与现有内容…
      </div>
    );
  }

  if (editId && editLoadFailed && !editingPost) {
    return (
      <div className="surface-panel min-h-72 p-6">
        <p className="text-sm font-medium">无法载入这条内容</p>
        <p className="mt-2 text-sm text-text-muted">{notice}</p>
        <Button
          variant="secondary"
          className="mt-5"
          onClick={() => router.push("/app/inspiration?view=mine")}
        >
          返回我的灵感
        </Button>
      </div>
    );
  }

  const mediaEditingDisabled =
    editingPost?.status === "HIDDEN" || shape === "REFERENCE";

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-6">
        <section className="surface-panel p-5 sm:p-6">
          <p className="eyebrow">01 · 内容类型</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {SHAPES.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => {
                  setShape(item.value);
                  if (item.value === "REFERENCE") {
                    const hasExistingMedia = selected.some(
                      (media) => media.existingMediaId,
                    );
                    setSelected((current) =>
                      current.filter((media) => media.existingMediaId),
                    );
                    if (hasExistingMedia) {
                      setNotice(
                        "已有图片的帖子不能改为参考类型；请保留原类型，或新建一条参考。",
                      );
                    }
                  }
                }}
                className={`rounded-lg border p-3 text-left transition-colors ${shape === item.value ? "border-brand bg-brand/5" : "border-border hover:border-border-strong"}`}
              >
                <span className="text-sm font-medium">{item.label}</span>
                <span className="mt-1 block text-xs leading-5 text-text-muted">
                  {item.description}
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="surface-panel p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="eyebrow">02 · 图片</p>
              <h2 className="mt-1 font-medium">
                从生成历史选图，或上传本地作品
              </h2>
            </div>
            <label
              className={`tool-button h-9 px-3 text-xs text-text-muted ${mediaEditingDisabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
            >
              <Upload size={14} /> {uploading ? "上传中…" : "上传图片"}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                disabled={uploading || mediaEditingDisabled}
                onChange={(event) =>
                  void upload(event.target.files?.[0] ?? null)
                }
              />
            </label>
          </div>
          <p className="mt-2 text-xs leading-5 text-text-faint">
            发布时会复制一份长期公开快照；删除生成历史不会导致帖子图片失效。过程稿只会发布你手动选择的图片。
          </p>
          {mediaEditingDisabled ? (
            <p className="mt-2 text-xs leading-5 text-text-faint">
              {shape === "REFERENCE"
                ? "参考类型只保存外链与作者手写说明，不附带站内图片。"
                : "这条内容已被隐藏，只能修改文字；恢复公开后才能继续补图。"}
            </p>
          ) : null}
          {preloadSource ? (
            <div
              className="mt-3 rounded-lg border border-brand/30 bg-brand/5 px-3 py-2 text-xs leading-5 text-text-muted"
              role="status"
            >
              已从{" "}
              {preloadSource === "CANVAS"
                ? "Canvas"
                : preloadSource === "NODES"
                  ? "节点工作流"
                  : "PPT"}{" "}
              导入内容。图片、标题与正文仍可在发布前调整。
            </div>
          ) : null}
          {selected.length ? (
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {selected.map((item, index) => (
                <div
                  key={item.key}
                  className="relative overflow-hidden rounded-lg border border-brand bg-surface-2"
                >
                  <img
                    src={item.preview}
                    alt={`已选择图片 ${index + 1}`}
                    className="aspect-square h-full w-full object-cover"
                  />
                  {!item.existingMediaId ? (
                    <button
                      type="button"
                      onClick={() =>
                        setSelected((current) =>
                          current.filter(
                            (candidate) => candidate.key !== item.key,
                          ),
                        )
                      }
                      className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-md bg-black/60 text-white"
                    >
                      <X size={13} />
                    </button>
                  ) : (
                    <span className="absolute right-1.5 top-1.5 rounded-md bg-black/60 px-2 py-1 text-[10px] text-white">
                      已有图片
                    </span>
                  )}
                  {!item.existingMediaId ? (
                    <button
                      type="button"
                      onClick={() =>
                        setSelected((current) =>
                          current.map((candidate) => ({
                            ...candidate,
                            isCover: candidate.key === item.key,
                          })),
                        )
                      }
                      className={`absolute bottom-1.5 left-1.5 rounded-md px-2 py-1 text-[10px] ${item.isCover ? "bg-brand text-on-accent" : "bg-black/60 text-white"}`}
                    >
                      {item.isCover ? "封面" : "设为封面"}
                    </button>
                  ) : item.isCover ? (
                    <span className="absolute bottom-1.5 left-1.5 rounded-md bg-brand px-2 py-1 text-[10px] text-on-accent">
                      封面
                    </span>
                  ) : null}
                  {shape === "PROCESS" && !item.existingMediaId ? (
                    <label className="absolute bottom-1.5 right-1.5 flex items-center gap-1 rounded-md bg-black/60 px-2 py-1 text-[10px] text-white">
                      <Checkbox
                        checked={item.role === "PROCESS"}
                        onChange={(event) =>
                          setSelected((current) =>
                            current.map((candidate) =>
                              candidate.key === item.key
                                ? {
                                    ...candidate,
                                    role: event.target.checked
                                      ? "PROCESS"
                                      : "FINAL",
                                  }
                                : candidate,
                            ),
                          )
                        }
                      />{" "}
                      过程稿
                    </label>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
          <div className="mt-4 max-h-[440px] overflow-y-auto rounded-lg border border-border p-2">
            {historyLoading ? (
              <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-text-muted">
                <LoaderCircle className="animate-spin" size={16} />{" "}
                正在读取生成历史
              </div>
            ) : allImages.length ? (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                {allImages.map(({ generation, image }) => {
                  const active = selected.some(
                    (item) => item.imageId === image.id,
                  );
                  return (
                    <button
                      key={image.id}
                      type="button"
                      disabled={uploading || mediaEditingDisabled}
                      onClick={() => toggleImage(generation, image)}
                      className={`relative overflow-hidden rounded-md border disabled:cursor-not-allowed disabled:opacity-50 ${active ? "border-brand" : "border-border hover:border-border-strong"}`}
                    >
                      <img
                        src={image.thumbnailUrl || image.url}
                        alt={generation.prompt}
                        className="aspect-square w-full object-cover"
                      />
                      {active ? (
                        <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-brand text-on-accent">
                          <Check size={12} />
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex min-h-40 flex-col items-center justify-center gap-2 text-center text-sm text-text-muted">
                <ImagePlus size={20} className="text-text-faint" />
                还没有可发布的生成图片
              </div>
            )}
          </div>
        </section>

        <section className="surface-panel space-y-5 p-5 sm:p-6">
          <p className="eyebrow">03 · 洞察与来源</p>
          <label className="block">
            <span className="mb-2 block text-xs text-text-muted">标题</span>
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={120}
              placeholder={
                shape === "QUESTION"
                  ? "你真正想讨论的设计问题是什么？"
                  : "给这条灵感一个准确的标题"
              }
              className="h-11"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-xs text-text-muted">正文</span>
            <Textarea
              value={story}
              onChange={(event) => setStory(event.target.value)}
              maxLength={10000}
              placeholder="不要只描述画面。写下问题、观察、取舍、依据，或者你还没想清楚的部分。"
              className="min-h-48"
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label>
              <span className="mb-2 block text-xs text-text-muted">
                主学科（单选必填）
              </span>
              <Select
                value={discipline}
                onValueChange={(value) => setDiscipline(value as Discipline)}
                options={DISCIPLINES}
                controlSize="lg"
              />
            </label>
            <label>
              <span className="mb-2 block text-xs text-text-muted">
                内容来源
              </span>
              <Select
                value={origin}
                onValueChange={setOrigin}
                options={[
                  { value: "ORIGINAL", label: "原创" },
                  { value: "STUDY", label: "研究 / 临摹" },
                  { value: "REPOST", label: "转载" },
                ]}
                controlSize="lg"
              />
            </label>
          </div>
          {shape === "REFERENCE" || origin !== "ORIGINAL" ? (
            <>
              <label className="block">
                <span className="mb-2 block text-xs text-text-muted">
                  外部链接（只保存，不由服务器抓取）
                </span>
                <Input
                  value={externalUrl}
                  onChange={(event) => setExternalUrl(event.target.value)}
                  type="url"
                  placeholder="https://…"
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-xs text-text-muted">
                  来源与推荐理由
                </span>
                <Textarea
                  value={sourceNote}
                  onChange={(event) => setSourceNote(event.target.value)}
                  placeholder="来源是什么？它为什么值得看？"
                  className="min-h-28"
                />
              </label>
            </>
          ) : null}
          <div>
            <span className="mb-2 block text-xs text-text-muted">
              标签（最多 12 个）
            </span>
            <div className="flex gap-2">
              <Input
                value={tagValue}
                onChange={(event) => setTagValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addTag();
                  }
                }}
                placeholder="输入标签后回车"
              />
              <Button variant="secondary" type="button" onClick={addTag}>
                <Plus size={14} />
              </Button>
            </div>
            {tags.length ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() =>
                      setTags((current) =>
                        current.filter((item) => item !== tag),
                      )
                    }
                    className="rounded-full border border-border px-2.5 py-1 text-xs text-text-muted hover:text-danger"
                  >
                    #{tag} ×
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </section>
      </div>

      <aside className="space-y-4 xl:sticky xl:top-4 xl:h-fit">
        <section className="surface-panel p-5">
          <p className="eyebrow">发布设置</p>
          <label className="mt-4 block">
            <span className="mb-2 block text-xs text-text-muted">
              提示词权限
            </span>
            <Select
              value={promptVisibility}
              onValueChange={(value) =>
                setPromptVisibility(value as PromptVisibility)
              }
              options={[
                { value: "PUBLIC", label: "完全公开" },
                { value: "STRUCTURE_ONLY", label: "只公开结构" },
                { value: "PRIVATE", label: "完全私有" },
              ]}
              controlSize="lg"
            />
          </label>
          <p className="mt-2 text-xs leading-5 text-text-faint">
            “只公开结构”会展示模型、尺寸、比例、seed
            与风格标签，但隐藏提示词原文。
          </p>
          {searchParams.get("derivedFrom") ? (
            <div className="mt-4 rounded-lg border border-brand/40 bg-brand/5 p-3 text-xs leading-5 text-text-muted">
              <Sparkles size={14} className="mb-2 text-brand" />
              这条内容会记录为对原帖的继续推演，并进入想法传承树。
            </div>
          ) : null}
          {searchParams.get("dailyPrompt") ? (
            <div className="mt-4 rounded-lg border border-brand/40 bg-brand/5 p-3 text-xs leading-5 text-text-muted">
              发布后会自动归入今天的每日命题。
            </div>
          ) : null}
          {notice ? (
            <div className="mt-4 rounded-md border border-danger/40 bg-danger/5 p-3 text-xs text-danger">
              {notice}
            </div>
          ) : null}
          <div className="mt-5 grid gap-2">
            <Button
              className="h-10"
              disabled={submitting || uploading}
              onClick={() => void submit(false)}
            >
              <Send size={14} />{" "}
              {submitting
                ? "正在保存…"
                : uploading
                  ? "等待图片上传…"
                  : editingPost?.status === "PUBLISHED" ||
                      editingPost?.status === "HIDDEN"
                    ? "保存修改"
                    : editId
                      ? "提交这份内容"
                      : "发布到灵感圈"}
            </Button>
            {editingPost?.status === "PUBLISHED" ||
            editingPost?.status === "HIDDEN" ? null : (
              <Button
                variant="secondary"
                className="h-9"
                disabled={submitting || uploading}
                onClick={() => void submit(true)}
              >
                保存草稿
              </Button>
            )}
          </div>
          <p className="mt-4 text-[11px] leading-5 text-text-faint">
            新账号的首帖可能进入人工审核；已有站内创作记录的可信账号默认先发后审。
          </p>
        </section>
      </aside>
    </div>
  );
}
