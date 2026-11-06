"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Archive, Check, ExternalLink, EyeOff, Flag, Pencil, Plus, RefreshCw, RotateCcw, Sparkles, Star } from "lucide-react";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  Textarea,
  useToast,
} from "@/components/ui";
import { AdminPageHeader } from "./ui";

interface AdminPost {
  id: string;
  title: string;
  author: { name: string };
  shapeLabel: string;
  disciplineLabel: string;
  status: string;
  createdAt: string;
  media: Array<{ thumbnailUrl: string }>;
}

interface DailyItem {
  id: string;
  day: string;
  title: string;
  discipline: string;
  status: string;
  prompt: string;
  keywords: string[];
  questionPost: { id: string; title: string; status: string } | null;
  features: Array<{ postId: string; post: { id: string; title: string } }>;
  responses: Array<{ id: string; title: string; authorNameSnapshot: string }>;
  _count: { responses: number };
}

interface ReportItem {
  id: string;
  reason: string;
  note: string | null;
  status: string;
  createdAt: string;
  post: { id: string; title: string; authorNameSnapshot: string } | null;
  comment: { id: string; content: string; postId: string; authorNameSnapshot: string } | null;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(payload.error?.message ?? "请求失败");
  return payload.data as T;
}

const disciplineOptions = [
  ["GRAPHIC", "视觉平面"], ["PRODUCT", "产品体验"], ["INDUSTRIAL", "工业硬件"], ["SERVICE", "服务流程"],
  ["SPATIAL", "空间环境"], ["BRAND", "品牌策略"], ["MOTION", "动态影像"], ["DATAVIZ", "信息可视化"],
].map(([value, label]) => ({ value, label }));

const dailyStatusOptions = [
  { value: "DRAFT", label: "草稿" },
  { value: "SCHEDULED", label: "待发布" },
  { value: "PUBLISHED", label: "已发布" },
  { value: "ARCHIVED", label: "已归档" },
];

const dailyStatusLabels: Record<string, string> = Object.fromEntries(
  dailyStatusOptions.map((item) => [item.value, item.label]),
);

function shanghaiDay(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function InspirationView() {
  const { toast } = useToast();
  const [posts, setPosts] = useState<AdminPost[]>([]);
  const [daily, setDaily] = useState<DailyItem[]>([]);
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [day, setDay] = useState(shanghaiDay);
  const [discipline, setDiscipline] = useState("GRAPHIC");
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [keywords, setKeywords] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [editingDaily, setEditingDaily] = useState<DailyItem | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editPrompt, setEditPrompt] = useState("");
  const [editDiscipline, setEditDiscipline] = useState("GRAPHIC");
  const [editKeywords, setEditKeywords] = useState("");
  const [editStatus, setEditStatus] = useState("DRAFT");
  const [editFeaturePostIds, setEditFeaturePostIds] = useState<string[]>([]);
  const [savingDaily, setSavingDaily] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [postData, dailyData, reportData] = await Promise.all([
        api<{ items: AdminPost[] }>("/api/admin/inspiration/posts?status=PENDING"),
        api<{ items: DailyItem[] }>("/api/admin/inspiration/daily"),
        api<{ items: ReportItem[] }>("/api/admin/inspiration/reports?status=OPEN&limit=100"),
      ]);
      setPosts(postData.items);
      setDaily(dailyData.items);
      setReports(reportData.items);
    } catch (cause) {
      toast({ title: "灵感圈后台读取失败", description: cause instanceof Error ? cause.message : "请稍后重试", variant: "danger" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const reviewPost = async (id: string, action: "APPROVE" | "HIDE" | "RESTRICT_AUTHOR") => {
    try {
      await api(`/api/admin/inspiration/posts/${id}`, { method: "PATCH", body: JSON.stringify({ action }) });
      setPosts((current) => current.filter((item) => item.id !== id));
      toast({ title: action === "APPROVE" ? "帖子已通过" : "帖子已处理" });
    } catch (cause) {
      toast({ title: "审核失败", description: cause instanceof Error ? cause.message : "请稍后重试", variant: "danger" });
    }
  };

  const createDaily = async (publish: boolean) => {
    if (!title.trim() || !prompt.trim()) return;
    setPublishing(true);
    try {
      await api("/api/admin/inspiration/daily", {
        method: "POST",
        body: JSON.stringify({ day, discipline, title: title.trim(), prompt: prompt.trim(), keywords: keywords.split(/[,，\s]+/).filter(Boolean), publish }),
      });
      setTitle(""); setPrompt(""); setKeywords("");
      toast({ title: publish ? "每日命题已发布" : "每日命题草稿已保存" });
      await load();
    } catch (cause) {
      toast({ title: "发布失败", description: cause instanceof Error ? cause.message : "请稍后重试", variant: "danger" });
    } finally {
      setPublishing(false);
    }
  };

  const openDailyEditor = (item: DailyItem) => {
    setEditingDaily(item);
    setEditTitle(item.title);
    setEditPrompt(item.prompt);
    setEditDiscipline(item.discipline);
    setEditKeywords(item.keywords.join("、"));
    setEditStatus(item.status);
    setEditFeaturePostIds(item.features.map((feature) => feature.postId));
  };

  const saveDaily = async () => {
    if (!editingDaily || !editTitle.trim() || !editPrompt.trim()) return;
    setSavingDaily(true);
    try {
      await api(`/api/admin/inspiration/daily/${editingDaily.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: editTitle.trim(),
          prompt: editPrompt.trim(),
          discipline: editDiscipline,
          keywords: editKeywords.split(/[,，、\s]+/).filter(Boolean),
          status: editStatus,
          featurePostIds: editFeaturePostIds,
        }),
      });
      setEditingDaily(null);
      toast({ title: "每日命题已更新", variant: "success" });
      await load();
    } catch (cause) {
      toast({ title: "更新失败", description: cause instanceof Error ? cause.message : "请稍后重试", variant: "danger" });
    } finally {
      setSavingDaily(false);
    }
  };

  const setDailyArchived = async (item: DailyItem, archived: boolean) => {
    try {
      if (archived) {
        await api(`/api/admin/inspiration/daily/${item.id}`, { method: "DELETE" });
      } else {
        await api(`/api/admin/inspiration/daily/${item.id}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "PUBLISHED" }),
        });
      }
      toast({ title: archived ? "每日命题已归档" : "每日命题已恢复发布", variant: "success" });
      await load();
    } catch (cause) {
      toast({ title: archived ? "归档失败" : "恢复失败", description: cause instanceof Error ? cause.message : "请稍后重试", variant: "danger" });
    }
  };

  const toggleFeaturedResponse = (postId: string) => {
    setEditFeaturePostIds((current) =>
      current.includes(postId)
        ? current.filter((id) => id !== postId)
        : current.length >= 12
          ? current
          : [...current, postId],
    );
  };

  const resolveReport = async (id: string, hideTarget: boolean) => {
    try {
      const status = hideTarget ? "RESOLVED" : "DISMISSED";
      await api(`/api/admin/inspiration/reports/${id}`, { method: "PATCH", body: JSON.stringify({ status, resolution: hideTarget ? "审核后下架目标内容" : "已复核，不需要下架", hideTarget }) });
      setReports((current) => current.filter((item) => item.id !== id));
    } catch (cause) {
      toast({ title: "举报处理失败", description: cause instanceof Error ? cause.message : "请稍后重试", variant: "danger" });
    }
  };

  return (
    <div>
      <AdminPageHeader eyebrow="Community" title="灵感圈" description="每日命题策展、首帖审核、举报处理与社区风控。" actions={<Button variant="secondary" onClick={() => void load()}><RefreshCw size={14} /> 刷新</Button>} />

      <section className="surface-panel p-5">
        <div className="flex items-center gap-2"><Sparkles size={17} /><h2 className="font-medium">发布每日命题</h2></div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label><span className="mb-1.5 block text-xs text-text-muted">日期</span><Input type="date" value={day} onChange={(event) => setDay(event.target.value)} /></label>
          <label><span className="mb-1.5 block text-xs text-text-muted">学科</span><Select value={discipline} onValueChange={setDiscipline} options={disciplineOptions} /></label>
          <label className="md:col-span-2"><span className="mb-1.5 block text-xs text-text-muted">命题标题</span><Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：公共空间里的等待，怎样才不焦虑？" /></label>
          <label className="md:col-span-2"><span className="mb-1.5 block text-xs text-text-muted">命题说明</span><Textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} className="min-h-28" placeholder="说明问题背景、观察方向和开放边界。" /></label>
          <label className="md:col-span-2"><span className="mb-1.5 block text-xs text-text-muted">关键词</span><Input value={keywords} onChange={(event) => setKeywords(event.target.value)} placeholder="等待、服务触点、信息反馈" /></label>
        </div>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" disabled={publishing || !title.trim() || !prompt.trim()} onClick={() => void createDaily(false)}>{publishing ? "保存中…" : "保存草稿"}</Button>
          <Button disabled={publishing || !title.trim() || !prompt.trim()} onClick={() => void createDaily(true)}><Plus size={14} /> {publishing ? "发布中…" : "立即发布"}</Button>
        </div>
      </section>

      <section className="mt-6">
        <div className="mb-3 flex items-center justify-between"><h2 className="font-medium">待审核首帖</h2><span className="text-xs text-text-muted">{posts.length} 条</span></div>
        {loading ? <div className="surface-panel p-5 text-sm text-text-muted">正在读取…</div> : posts.length ? <div className="grid gap-3 lg:grid-cols-2">{posts.map((post) => <article key={post.id} className="surface-panel flex gap-4 p-4">{post.media[0] ? <img src={post.media[0].thumbnailUrl} alt="" className="h-24 w-24 rounded-md object-cover" /> : <div className="flex h-24 w-24 items-center justify-center rounded-md bg-surface-2 text-xs text-text-faint">文字帖</div>}<div className="min-w-0 flex-1"><div className="flex items-center gap-2 text-[11px] text-text-muted"><span>{post.shapeLabel}</span><span>·</span><span>{post.disciplineLabel}</span></div><h3 className="mt-1 line-clamp-2 font-medium">{post.title}</h3><p className="mt-1 text-xs text-text-muted">{post.author.name}</p><div className="mt-3 flex flex-wrap gap-2"><Button size="sm" onClick={() => void reviewPost(post.id, "APPROVE")}><Check size={13} /> 通过</Button><Button size="sm" variant="secondary" onClick={() => void reviewPost(post.id, "HIDE")}><EyeOff size={13} /> 隐藏</Button><Link href={`/inspiration/${post.id}`} target="_blank" className="tool-button h-8 px-2 text-xs text-text-muted"><ExternalLink size={13} /> 预览</Link></div></div></article>)}</div> : <div className="surface-panel flex min-h-32 items-center justify-center text-sm text-text-muted">没有待审核内容</div>}
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-2">
        <div><div className="mb-3 flex items-center justify-between"><h2 className="font-medium">举报队列</h2><span className="text-xs text-text-muted">{reports.filter((item) => item.status === "OPEN").length} 条开放</span></div><div className="surface-panel divide-y divide-border">{reports.slice(0, 30).map((report) => <article key={report.id} className="p-4"><div className="flex items-start gap-2"><Flag size={14} className="mt-0.5 text-danger" /><div className="min-w-0 flex-1"><p className="text-xs font-medium">{report.reason} · {report.status}</p><p className="mt-1 text-sm text-text-muted">{report.post?.title ?? report.comment?.content ?? "目标已删除"}</p>{report.note ? <p className="mt-1 text-xs text-text-faint">{report.note}</p> : null}{report.status === "OPEN" ? <div className="mt-3 flex gap-2"><Button size="sm" variant="secondary" onClick={() => void resolveReport(report.id, false)}>驳回</Button><Button size="sm" variant="danger" onClick={() => void resolveReport(report.id, true)}>下架并结案</Button></div> : null}</div></div></article>)}</div></div>
        <div>
          <div className="mb-3 flex items-center justify-between"><h2 className="font-medium">每日命题记录</h2><span className="text-xs text-text-muted">{daily.length} 条</span></div>
          <div className="surface-panel divide-y divide-border">
            {daily.slice(0, 30).map((item) => (
              <article key={item.id} className="flex items-start justify-between gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-[10px] text-text-faint">{new Date(item.day).toISOString().slice(0, 10)} · {item.discipline}</p>
                  <p className="mt-1 truncate text-sm font-medium">{item.title}</p>
                  <p className="mt-1 text-xs text-text-muted">{dailyStatusLabels[item.status] ?? item.status} · {item._count.responses} 个回应 · {item.features.length} 条精选</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={() => openDailyEditor(item)}><Pencil size={13} /> 编辑与精选</Button>
                    {item.status === "ARCHIVED" ? (
                      <Button size="sm" variant="secondary" onClick={() => void setDailyArchived(item, false)}><RotateCcw size={13} /> 恢复发布</Button>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => void setDailyArchived(item, true)}><Archive size={13} /> 归档</Button>
                    )}
                  </div>
                </div>
                {item.questionPost ? <Link href={`/inspiration/${item.questionPost.id}`} target="_blank" aria-label="查看命题帖子" className="text-text-faint hover:text-foreground"><ExternalLink size={15} /></Link> : null}
              </article>
            ))}
          </div>
        </div>
      </section>

      <Dialog open={Boolean(editingDaily)} onOpenChange={(open) => { if (!open && !savingDaily) setEditingDaily(null); }}>
        <DialogContent className="max-h-[calc(100vh-32px)] max-w-[720px] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>编辑每日命题</DialogTitle>
            <DialogDescription>修改命题状态与内容，并从已发布回应中选择最多 12 条精选。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 px-5 pb-5 md:grid-cols-2">
            <label><span className="mb-1.5 block text-xs text-text-muted">状态</span><Select value={editStatus} onValueChange={setEditStatus} options={dailyStatusOptions} /></label>
            <label><span className="mb-1.5 block text-xs text-text-muted">学科</span><Select value={editDiscipline} onValueChange={setEditDiscipline} options={disciplineOptions} /></label>
            <label className="md:col-span-2"><span className="mb-1.5 block text-xs text-text-muted">命题标题</span><Input value={editTitle} onChange={(event) => setEditTitle(event.target.value)} /></label>
            <label className="md:col-span-2"><span className="mb-1.5 block text-xs text-text-muted">命题说明</span><Textarea value={editPrompt} onChange={(event) => setEditPrompt(event.target.value)} className="min-h-28" /></label>
            <label className="md:col-span-2"><span className="mb-1.5 block text-xs text-text-muted">关键词</span><Input value={editKeywords} onChange={(event) => setEditKeywords(event.target.value)} placeholder="等待、服务触点、信息反馈" /></label>
            <div className="md:col-span-2">
              <div className="mb-2 flex items-center justify-between gap-3"><span className="text-xs text-text-muted">精选回应</span><span className="font-mono text-[10px] text-text-faint">{editFeaturePostIds.length}/12</span></div>
              {editingDaily?.responses.length ? (
                <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                  {editingDaily.responses.map((response) => {
                    const selected = editFeaturePostIds.includes(response.id);
                    return (
                      <button key={response.id} type="button" aria-pressed={selected} onClick={() => toggleFeaturedResponse(response.id)} className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors ${selected ? "bg-brand/10 text-foreground" : "hover:bg-surface-2"}`}>
                        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${selected ? "border-brand bg-brand text-on-accent" : "border-border"}`}>{selected ? <Star size={12} fill="currentColor" /> : null}</span>
                        <span className="min-w-0"><span className="block truncate text-sm">{response.title}</span><span className="block truncate text-[10px] text-text-faint">{response.authorNameSnapshot}</span></span>
                      </button>
                    );
                  })}
                </div>
              ) : <div className="rounded-md border border-dashed border-border p-4 text-center text-xs text-text-faint">还没有可精选的已发布回应</div>}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" disabled={savingDaily} onClick={() => setEditingDaily(null)}>取消</Button>
            <Button loading={savingDaily} disabled={!editTitle.trim() || !editPrompt.trim()} onClick={() => void saveDaily()}>保存修改</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
