"use client";

import { Loader2, Megaphone, Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button, Input, Select, Switch, Textarea } from "@/components/ui";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { cn, formatDate } from "@/lib/utils";

import {
  createAdminAnnouncement,
  deleteAdminAnnouncement,
  isAdminApiError,
  listAdminAnnouncements,
  patchAdminAnnouncement,
} from "./lib/api";
import type {
  AdminAnnouncement,
  AdminAnnouncementInput,
  AnnouncementDisplayModeValue,
  AnnouncementToneValue,
} from "./lib/types";
import {
  AdminField,
  AdminPageHeader,
  AdminTable,
  EmptyPanel,
  ErrorText,
} from "./ui";

const TONE_LABEL: Record<AnnouncementToneValue, string> = {
  info: "信息",
  warning: "提醒",
  success: "成功",
  danger: "紧急",
};

const TONE_DOT: Record<AnnouncementToneValue, string> = {
  info: "bg-info",
  warning: "bg-warning",
  success: "bg-success",
  danger: "bg-danger",
};

const TONE_TEXT: Record<AnnouncementToneValue, string> = {
  info: "text-info",
  warning: "text-warning",
  success: "text-success",
  danger: "text-danger",
};

const MODE_LABEL: Record<AnnouncementDisplayModeValue, string> = {
  banner: "横幅",
  popup: "弹窗",
  both: "横幅 + 弹窗",
};

const EMPTY_FORM: AdminAnnouncementInput = {
  title: "",
  body: "",
  tone: "info",
  displayMode: "banner",
  linkLabel: "",
  linkUrl: "",
  enabled: true,
  startsAt: null,
  endsAt: null,
};

/** ISO ↔ datetime-local 输入框值（本地时区 YYYY-MM-DDTHH:mm）。 */
function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function localInputToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function scheduleLabel(item: AdminAnnouncement): string {
  if (!item.startsAt && !item.endsAt) return "长期";
  const now = Date.now();
  if (item.startsAt && new Date(item.startsAt).getTime() > now) return "未开始";
  if (item.endsAt && new Date(item.endsAt).getTime() <= now) return "已结束";
  return "投放中";
}

export function AnnouncementsView() {
  const [items, setItems] = useState<AdminAnnouncement[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<AdminAnnouncementInput>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(() => {
    listAdminAnnouncements()
      .then(setItems)
      .catch(() => setItems([]));
  }, []);

  useEffect(reload, [reload]);

  async function run(action: () => Promise<unknown>, okMessage: string) {
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(okMessage);
      reload();
      return true;
    } catch (actionError) {
      setError(isAdminApiError(actionError) ? actionError.message : "操作失败");
      return false;
    }
  }

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setEditorOpen(true);
  }

  function openEdit(item: AdminAnnouncement) {
    setEditingId(item.id);
    setForm({
      title: item.title,
      body: item.body,
      tone: item.tone,
      displayMode: item.displayMode,
      linkLabel: item.linkLabel ?? "",
      linkUrl: item.linkUrl ?? "",
      enabled: item.enabled,
      startsAt: item.startsAt,
      endsAt: item.endsAt,
    });
    setEditorOpen(true);
  }

  async function saveEditor() {
    if (saving) return;
    setSaving(true);
    const succeeded = await run(
      async () => {
        if (editingId) {
          await patchAdminAnnouncement(editingId, form);
        } else {
          await createAdminAnnouncement(form);
        }
      },
      editingId ? "公告已更新" : "公告已创建",
    );
    setSaving(false);
    if (succeeded) setEditorOpen(false);
  }

  const patch = (partial: Partial<AdminAnnouncementInput>) =>
    setForm((current) => ({ ...current, ...partial }));

  return (
    <div>
      <AdminPageHeader
        eyebrow="Announcements"
        title="公告"
        description="面向所有用户的全局公告，支持横幅与弹窗，可设定投放时间窗。"
        actions={
          <Button type="button" variant="primary" onClick={openCreate}>
            <Plus size={14} />
            新建公告
          </Button>
        }
      />

      <ErrorText message={error} />
      {notice ? <p className="mb-3 text-sm text-success">{notice}</p> : null}

      {!items ? (
        <div className="surface-panel h-64 animate-pulse" />
      ) : items.length === 0 ? (
        <EmptyPanel text="暂无公告，点击右上角「新建公告」发布第一条" />
      ) : (
        <AdminTable
          head={["公告", "色调", "展示", "投放", "状态", "创建时间", "操作"]}
        >
          {items.map((item) => {
            const schedule = scheduleLabel(item);
            return (
              <tr
                key={item.id}
                className="border-b border-border/60 last:border-0"
              >
                <td className="max-w-72 px-4 py-2.5">
                  <p className="truncate text-[13px] font-medium">
                    {item.title || "（无标题）"}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-text-faint">
                    {item.body}
                  </p>
                </td>
                <td className="px-4 py-2.5">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 text-xs",
                      TONE_TEXT[item.tone],
                    )}
                  >
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        TONE_DOT[item.tone],
                      )}
                    />
                    {TONE_LABEL[item.tone]}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-xs text-text-muted">
                  {MODE_LABEL[item.displayMode]}
                </td>
                <td className="px-4 py-2.5">
                  <span
                    className={cn(
                      "text-xs",
                      schedule === "投放中" || schedule === "长期"
                        ? "text-success"
                        : "text-text-faint",
                    )}
                  >
                    {schedule}
                  </span>
                  {item.startsAt || item.endsAt ? (
                    <p className="mt-0.5 text-[10px] text-text-faint">
                      {item.startsAt ? formatDate(item.startsAt) : "即刻"}
                      {" → "}
                      {item.endsAt ? formatDate(item.endsAt) : "长期"}
                    </p>
                  ) : null}
                </td>
                <td className="px-4 py-2.5">
                  <Switch
                    checked={item.enabled}
                    onChange={(checked) =>
                      void run(
                        () =>
                          patchAdminAnnouncement(item.id, { enabled: checked }),
                        checked ? "公告已启用" : "公告已停用",
                      )
                    }
                    aria-label="启用公告"
                  />
                </td>
                <td className="px-4 py-2.5 font-mono text-xs text-text-muted">
                  {formatDate(item.createdAt)}
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      onClick={() => openEdit(item)}
                      aria-label="编辑公告"
                      title="编辑"
                      className="flex h-7 w-7 items-center justify-center rounded-md p-0 text-text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
                    >
                      <Pencil size={13} />
                    </Button>
                    <Button
                      type="button"
                      onClick={() => {
                        if (window.confirm("确定删除这条公告吗？")) {
                          void run(
                            () => deleteAdminAnnouncement(item.id),
                            "公告已删除",
                          );
                        }
                      }}
                      aria-label="删除公告"
                      title="删除"
                      className="flex h-7 w-7 items-center justify-center rounded-md p-0 text-text-muted transition-colors hover:bg-danger/10 hover:text-danger"
                    >
                      <Trash2 size={13} />
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </AdminTable>
      )}

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-w-[640px]">
          <DialogHeader>
            <DialogTitle>{editingId ? "编辑公告" : "新建公告"}</DialogTitle>
          </DialogHeader>

          <div className="grid max-h-[62vh] gap-3 overflow-y-auto px-5 pb-4">
            <div className="grid grid-cols-2 gap-3">
              <AdminField label="标题（可空）">
                <Input
                  value={form.title}
                  maxLength={80}
                  placeholder="例：新版本上线"
                  onChange={(event) => patch({ title: event.target.value })}
                />
              </AdminField>
              <div className="grid grid-cols-2 gap-3">
                <AdminField label="色调">
                  <Select
                    aria-label="色调"
                    value={form.tone}
                    onValueChange={(value) =>
                      patch({
                        tone: value as AnnouncementToneValue,
                      })
                    }
                    options={Object.entries(TONE_LABEL).map(
                      ([value, label]) => ({ value, label }),
                    )}
                  />
                </AdminField>
                <AdminField label="展示方式">
                  <Select
                    aria-label="展示方式"
                    value={form.displayMode}
                    onValueChange={(value) =>
                      patch({
                        displayMode: value as AnnouncementDisplayModeValue,
                      })
                    }
                    options={Object.entries(MODE_LABEL).map(
                      ([value, label]) => ({ value, label }),
                    )}
                  />
                </AdminField>
              </div>
            </div>

            <AdminField label="内容">
              <Textarea
                className="h-24 resize-none py-2"
                value={form.body}
                maxLength={2000}
                placeholder="公告正文，将在横幅/弹窗中展示"
                onChange={(event) => patch({ body: event.target.value })}
              />
            </AdminField>

            <div className="grid grid-cols-2 gap-3">
              <AdminField label="链接文字（可空）">
                <Input
                  value={form.linkLabel ?? ""}
                  maxLength={24}
                  placeholder="查看详情"
                  onChange={(event) =>
                    patch({ linkLabel: event.target.value || null })
                  }
                />
              </AdminField>
              <AdminField label="链接地址（可空）">
                <Input
                  value={form.linkUrl ?? ""}
                  maxLength={500}
                  placeholder="https://… 或 /app/history"
                  onChange={(event) =>
                    patch({ linkUrl: event.target.value || null })
                  }
                />
              </AdminField>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <AdminField label="开始时间（可空）">
                <Input
                  type="datetime-local"
                  value={isoToLocalInput(form.startsAt ?? null)}
                  onChange={(event) =>
                    patch({ startsAt: localInputToIso(event.target.value) })
                  }
                />
              </AdminField>
              <AdminField label="结束时间（可空）">
                <Input
                  type="datetime-local"
                  value={isoToLocalInput(form.endsAt ?? null)}
                  onChange={(event) =>
                    patch({ endsAt: localInputToIso(event.target.value) })
                  }
                />
              </AdminField>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={form.enabled}
                onChange={(checked) => patch({ enabled: checked })}
              />
              创建后立即启用
            </label>

            {/* 实时预览：与前台 AnnouncementBanner 同一套扁平样式 */}
            <div className="rounded-md border border-border">
              <p className="border-b border-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-text-faint">
                预览
              </p>
              {form.displayMode !== "popup" ? (
                <div className="flex h-9 items-center gap-2.5 border-b border-border px-3">
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      TONE_DOT[form.tone],
                    )}
                  />
                  {form.title ? (
                    <span className="text-xs font-semibold">{form.title}</span>
                  ) : null}
                  <span className="min-w-0 flex-1 truncate text-xs text-text-muted">
                    {form.body || "公告内容…"}
                  </span>
                  {form.linkUrl ? (
                    <span
                      className={cn(
                        "text-xs font-medium",
                        TONE_TEXT[form.tone],
                      )}
                    >
                      {form.linkLabel || "查看详情"}
                    </span>
                  ) : null}
                </div>
              ) : null}
              {form.displayMode !== "banner" ? (
                <div className="bg-surface-2/50 p-3">
                  <div className="rounded-lg border border-border bg-surface p-3.5">
                    <div className="mb-1.5 flex items-center gap-2">
                      <span
                        className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          TONE_DOT[form.tone],
                        )}
                      />
                      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-faint">
                        公告
                      </span>
                    </div>
                    <p className="text-sm font-semibold">
                      {form.title || "公告"}
                    </p>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-text-muted">
                      {form.body || "公告内容…"}
                    </p>
                    <div className="mt-3 flex items-center justify-between border-t border-border pt-2.5">
                      <span className="flex items-center gap-1.5 text-[10px] text-text-faint">
                        <Megaphone size={10} />
                        Chūgǎo Studio
                      </span>
                      <span className="rounded-md bg-brand px-2.5 py-1 text-[10px] font-medium text-on-accent">
                        我知道了
                      </span>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setEditorOpen(false)}
            >
              取消
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => void saveEditor()}
              disabled={saving || form.body.trim().length === 0}
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : null}
              {editingId ? "保存修改" : "发布公告"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
