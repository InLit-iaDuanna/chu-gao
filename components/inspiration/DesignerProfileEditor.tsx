"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, ExternalLink, Trash2 } from "lucide-react";

import {
  Button,
  Checkbox,
  EmptyState,
  Input,
  Textarea,
  useToast,
} from "@/components/ui";
import { inspirationRequest } from "./api";
import type { Discipline } from "./types";

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

interface DesignerProfileForm {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  bio: string | null;
  designerTitle: string | null;
  designerLocation: string | null;
  designerWebsite: string | null;
  designDisciplines: Discipline[];
  joinedAt: string;
}

async function uploadAvatar(file: File): Promise<{ avatarUrl: string }> {
  const form = new FormData();
  form.set("file", file);
  const response = await fetch("/api/inspiration/profile/avatar", {
    method: "POST",
    body: form,
  });
  const payload = (await response.json()) as {
    ok?: boolean;
    data?: { avatarUrl: string };
    error?: { message?: string };
  };
  if (!response.ok || !payload.ok || !payload.data)
    throw new Error(payload.error?.message ?? "头像上传失败");
  return payload.data;
}

export function DesignerProfileEditor() {
  const { toast } = useToast();
  const [profile, setProfile] = useState<DesignerProfileForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inspirationRequest<DesignerProfileForm>("/api/inspiration/profile")
      .then(setProfile)
      .catch((error) =>
        toast({
          title: "资料读取失败",
          description: error instanceof Error ? error.message : "请稍后重试",
          variant: "danger",
        }),
      )
      .finally(() => setLoading(false));
  }, [toast]);

  if (loading)
    return (
      <div role="status" className="mt-5 min-h-64 py-6 text-sm text-text-muted">
        正在读取设计师资料…
      </div>
    );
  if (!profile)
    return (
      <EmptyState className="mt-5 min-h-64" title="设计师资料暂时无法读取。" />
    );

  const patch = <K extends keyof DesignerProfileForm>(
    key: K,
    value: DesignerProfileForm[K],
  ) =>
    setProfile((current) => (current ? { ...current, [key]: value } : current));
  const save = async () => {
    setSaving(true);
    try {
      const updated = await inspirationRequest<DesignerProfileForm>(
        "/api/inspiration/profile",
        {
          method: "PATCH",
          body: JSON.stringify({
            name: profile.name,
            bio: profile.bio,
            designerTitle: profile.designerTitle,
            designerLocation: profile.designerLocation,
            designerWebsite: profile.designerWebsite,
            designDisciplines: profile.designDisciplines,
          }),
        },
      );
      setProfile(updated);
      toast({ title: "设计师资料已更新", variant: "success" });
    } catch (error) {
      toast({
        title: "保存失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "danger",
      });
    } finally {
      setSaving(false);
    }
  };
  const changeAvatar = async (file: File | null) => {
    if (!file) return;
    setAvatarBusy(true);
    try {
      const result = await uploadAvatar(file);
      patch("avatarUrl", result.avatarUrl);
      toast({ title: "头像已更新", variant: "success" });
    } catch (error) {
      toast({
        title: "头像上传失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "danger",
      });
    } finally {
      setAvatarBusy(false);
    }
  };
  const removeAvatar = async () => {
    setAvatarBusy(true);
    try {
      await inspirationRequest<{ avatarUrl: null }>(
        "/api/inspiration/profile/avatar",
        { method: "DELETE" },
      );
      patch("avatarUrl", null);
    } finally {
      setAvatarBusy(false);
    }
  };

  return (
    <div className="mt-5 grid min-w-0 grid-cols-1 gap-6 break-words text-sm tracking-normal lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="min-w-0 border-b border-border pb-6 lg:border-b-0 lg:border-r lg:pr-6">
        <div className="flex flex-col items-center text-center">
          <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-lg border border-border bg-surface-2 text-2xl font-semibold">
            {profile.avatarUrl ? (
              <img
                src={profile.avatarUrl}
                alt={`${profile.name} 的头像`}
                className="h-full w-full object-cover"
              />
            ) : (
              profile.name.slice(0, 1).toUpperCase()
            )}
          </div>
          <h2 className="mt-4 max-w-full break-words text-xl font-semibold">
            {profile.name}
          </h2>
          <p className="mt-1 max-w-full break-all text-xs text-text-muted">
            {profile.email}
          </p>
          <div className="mt-5 grid w-full grid-cols-1 gap-2">
            <Button
              disabled={avatarBusy}
              onClick={() => avatarInputRef.current?.click()}
            >
              <Camera size={14} /> {avatarBusy ? "处理中…" : "更换头像"}
            </Button>
            <input
              ref={avatarInputRef}
              aria-label="上传头像"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              disabled={avatarBusy}
              onChange={(event) =>
                void changeAvatar(event.target.files?.[0] ?? null)
              }
            />
            {profile.avatarUrl ? (
              <Button
                variant="ghost"
                disabled={avatarBusy}
                onClick={() => void removeAvatar()}
              >
                <Trash2 size={16} /> 移除头像
              </Button>
            ) : null}
          </div>
          <a
            href={`/u/${profile.id}`}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-flex items-center gap-1 text-xs text-text-muted hover:text-foreground"
          >
            查看公开主页 <ExternalLink size={12} />
          </a>
        </div>
      </aside>

      <section className="min-w-0 space-y-5 [&_input:not([type=checkbox])]:h-9">
        <h2 className="app-section-title text-xl font-semibold">设计师资料</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 [&>label]:min-w-0">
          <label>
            <span className="mb-2 block text-xs text-text-muted">显示名称</span>
            <Input
              value={profile.name}
              maxLength={40}
              onChange={(event) => patch("name", event.target.value)}
            />
          </label>
          <label>
            <span className="mb-2 block text-xs text-text-muted">
              设计师身份
            </span>
            <Input
              value={profile.designerTitle ?? ""}
              maxLength={60}
              placeholder="例如：产品设计师 / 独立策展人"
              onChange={(event) => patch("designerTitle", event.target.value)}
            />
          </label>
          <label>
            <span className="mb-2 block text-xs text-text-muted">所在城市</span>
            <Input
              value={profile.designerLocation ?? ""}
              maxLength={80}
              placeholder="城市或工作方式"
              onChange={(event) =>
                patch("designerLocation", event.target.value)
              }
            />
          </label>
          <label>
            <span className="mb-2 block text-xs text-text-muted">个人网站</span>
            <Input
              value={profile.designerWebsite ?? ""}
              maxLength={500}
              type="url"
              placeholder="https://…"
              onChange={(event) => patch("designerWebsite", event.target.value)}
            />
          </label>
        </div>
        <label className="block">
          <span className="mb-2 block text-xs text-text-muted">简介</span>
          <Textarea
            value={profile.bio ?? ""}
            maxLength={1000}
            className="min-h-32"
            placeholder="你的关注方向、工作方法，以及希望在灵感圈讨论的议题。"
            onChange={(event) => patch("bio", event.target.value)}
          />
        </label>
        <div>
          <span className="mb-2 block text-xs text-text-muted">
            设计领域（可多选）
          </span>
          <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
            {DISCIPLINES.map((item) => {
              const checked = profile.designDisciplines.includes(item.value);
              return (
                <label
                  key={item.value}
                  className={`flex min-h-9 min-w-0 cursor-pointer items-center gap-2 rounded-md border px-2 py-2 text-sm ${checked ? "border-brand bg-brand/5" : "border-border"}`}
                >
                  <Checkbox
                    checked={checked}
                    onChange={() =>
                      patch(
                        "designDisciplines",
                        checked
                          ? profile.designDisciplines.filter(
                              (value) => value !== item.value,
                            )
                          : [...profile.designDisciplines, item.value],
                      )
                    }
                  />
                  <span className="min-w-0">{item.label}</span>
                </label>
              );
            })}
          </div>
        </div>
        <div className="flex justify-end border-t border-border pt-5">
          <Button
            variant="primary"
            disabled={!profile.name.trim()}
            loading={saving}
            onClick={() => void save()}
          >
            保存设计师资料
          </Button>
        </div>
      </section>
    </div>
  );
}
