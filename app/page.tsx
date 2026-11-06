import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";

import { Logo } from "@/components/shared/Logo";
import { WishPoolPage } from "@/components/wish-pool/WishPoolPage";
import { headers } from "next/headers";

// 纯静态内容 → 服务端组件。入场动画走 CSS（.anim-rise，见 globals.css）。
function stagger(i: number): React.CSSProperties {
  return { "--stagger": i } as React.CSSProperties;
}

const CAPABILITIES = [
  {
    id: "01",
    title: "多模型接入",
    desc: "统一接入海外主流图像模型，通道自动回退，稳定出图。",
  },
  {
    id: "02",
    title: "对话式迭代",
    desc: "用自然语言描述修改方向，在同一条线程里持续精修。",
  },
  {
    id: "03",
    title: "实时生成墙",
    desc: "所有产出实时上墙，进度可见，版本一目了然。",
  },
  {
    id: "04",
    title: "PPT 一键成稿",
    desc: "从提纲到逐页配图自动生成，可直接导出成品。",
  },
] as const;

const STEPS = [
  {
    id: "01",
    title: "描述想法",
    desc: "一句话、一张参考图，或一段草图说明。",
  },
  {
    id: "02",
    title: "实时生成",
    desc: "多通道并行调度，等待更短，进度实时可见。",
  },
  {
    id: "03",
    title: "迭代导出",
    desc: "满意即下载，不满意继续对话，历史全保留。",
  },
] as const;

/** 生成墙预览砖块：纯 CSS 静态 mock，预演新工作台的「墙」形态。 */
const WALL_TILES = [
  { ratio: "aspect-[4/5]", label: "山间驿站 · v3", tone: "warm" },
  { ratio: "aspect-square", label: "字体海报 · v1", tone: "cool" },
  { ratio: "aspect-[4/3]", label: "产品场景 · v2", tone: "warm" },
  { ratio: "aspect-[3/4]", label: "角色设定 · v4", tone: "cool" },
  { ratio: "aspect-square", label: "包装主视觉", tone: "accent" },
  { ratio: "aspect-[4/5]", label: "空间氛围 · v2", tone: "warm" },
  { ratio: "aspect-[4/3]", label: "信息图底图", tone: "cool" },
  { ratio: "aspect-[3/4]", label: "插画草稿 · v5", tone: "warm" },
] as const;

/* 墙面占位画：纯 CSS 渐变构图，四种光影结构轮转，
   全部走 surface/border token，深浅主题自动适配。 */
const TILE_COMPOSITIONS = [
  // 左上天光
  "radial-gradient(130% 100% at 28% 0%, rgb(var(--surface-3)) 0%, rgb(var(--surface-2)) 72%)",
  // 地平线
  "linear-gradient(180deg, rgb(var(--surface-3) / 0.9) 0%, rgb(var(--surface-2)) 44%, rgb(var(--surface-2)) 56%, rgb(var(--surface-3) / 0.65) 100%)",
  // 对角明暗
  "linear-gradient(135deg, rgb(var(--surface-3)) 0%, rgb(var(--surface-2)) 55%, rgb(var(--border) / 0.55) 135%)",
  // 偏心光晕
  "radial-gradient(closest-side at 62% 58%, rgb(var(--surface-3)) 0%, rgb(var(--surface-2)) 100%)",
] as const;

const ACCENT_COMPOSITION =
  "linear-gradient(140deg, rgb(var(--brand-primary) / 0.28) 0%, rgb(var(--brand-primary) / 0.08) 58%), radial-gradient(90% 70% at 70% 20%, rgb(var(--brand-primary) / 0.18) 0%, transparent 100%)";

function WallTile({
  ratio,
  label,
  tone,
  index,
}: {
  ratio: string;
  label: string;
  tone: "warm" | "cool" | "accent";
  index: number;
}): React.ReactElement {
  return (
    <figure
      className="anim-rise group relative overflow-hidden rounded-md border border-border bg-surface"
      style={stagger(index + 2)}
    >
      <div
        className={`${ratio} w-full transition-transform duration-500 ease-out group-hover:scale-[1.03]`}
        style={{
          backgroundColor: "rgb(var(--surface-2))",
          backgroundImage:
            tone === "accent"
              ? ACCENT_COMPOSITION
              : TILE_COMPOSITIONS[index % TILE_COMPOSITIONS.length],
        }}
      >
        {/* 模拟画面纹理：细网格，零性能开销 */}
        <div
          aria-hidden
          className="h-full w-full opacity-[0.5]"
          style={{
            backgroundImage:
              "linear-gradient(rgb(var(--border) / 0.5) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--border) / 0.5) 1px, transparent 1px)",
            backgroundSize: "22px 22px",
          }}
        />
      </div>
      <figcaption className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 border-t border-border bg-surface px-2.5 py-1.5">
        <span className="truncate font-mono text-[10px] tracking-wide text-text-muted">
          {label}
        </span>
        {tone === "accent" ? (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
        ) : null}
      </figcaption>
    </figure>
  );
}

export default async function HomePage(): Promise<React.ReactElement> {
  const host = (await headers()).get("host")?.split(":")[0].toLowerCase();
  if (host === "iwish.chugao.art") {
    return <WishPoolPage />;
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      {/* ─── 顶部导航 ─────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-border bg-background">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-5">
          <Logo />
          <nav className="flex items-center gap-1">
            <Link
              href="/inspiration"
              className="hidden h-8 items-center rounded-md px-3 text-sm text-text-muted transition-colors hover:bg-surface-2 hover:text-foreground sm:flex"
            >
              灵感圈
            </Link>
            <Link
              href="/login"
              className="flex h-8 items-center rounded-md px-3 text-sm text-text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              登录
            </Link>
            <Link
              href="/register"
              className="flex h-8 items-center gap-1.5 rounded-md bg-brand px-3.5 text-sm font-medium text-on-accent transition-colors hover:bg-brand/88"
            >
              免费开始
              <ArrowRight size={14} aria-hidden />
            </Link>
          </nav>
        </div>
      </header>

      {/* ─── Hero ─────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-6xl px-5 pb-16 pt-20 sm:pt-28">
        <p
          className="anim-rise font-mono text-xs uppercase tracking-[0.2em] text-text-faint"
          style={stagger(0)}
        >
          Chūgǎo Studio — 图像生成工作台
        </p>
        <h1
          className="anim-rise mt-5 max-w-3xl text-[clamp(2.6rem,6vw,4.5rem)] font-semibold leading-[1.04] tracking-[-0.035em]"
          style={stagger(1)}
        >
          稳稳地接住🫴
          <br />
          <span className="text-text-muted">你的设计</span>
        </h1>
        <p
          className="anim-rise mt-6 max-w-xl text-base leading-relaxed text-text-muted"
          style={stagger(2)}
        >
          Chūgǎo 是为设计学生打造的图像生成工作台：一次对话、多轮迭代，
          所有产出实时呈现在生成墙上，从模糊想法到可用画面一站完成。
        </p>
        <div className="anim-rise mt-9 flex flex-wrap items-center gap-3" style={stagger(3)}>
          <Link
            href="/register"
            className="flex h-11 items-center gap-2 rounded-md bg-brand px-6 text-sm font-medium text-on-accent transition-colors hover:bg-brand/88"
          >
            免费开始
            <ArrowRight size={16} aria-hidden />
          </Link>
          <Link
            href="/login"
            className="flex h-11 items-center gap-2 rounded-md border border-border px-6 text-sm text-foreground transition-colors hover:border-border-strong hover:bg-surface-2"
          >
            已有账号登录
          </Link>
        </div>
        <p
          className="anim-rise mt-5 font-mono text-xs text-text-faint"
          style={stagger(4)}
        >
          注册即送初始额度 · 无需信用卡
        </p>
      </section>

      {/* ─── 生成墙预览 ───────────────────────────────────── */}
      <section className="border-y border-border bg-surface/40">
        <div className="mx-auto w-full max-w-6xl px-5 py-14">
          <div className="mb-8 flex items-end justify-between gap-4">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-text-faint">
                The Wall
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-[-0.02em]">
                你的每一次生成，都在墙上
              </h2>
            </div>
            <div className="hidden items-center gap-2 font-mono text-xs text-text-muted sm:flex">
              <span className="relative h-1.5 w-1.5">
                <span className="absolute inset-0 animate-ping rounded-full bg-brand motion-reduce:animate-none" />
                <span className="relative block h-1.5 w-1.5 rounded-full bg-brand" />
              </span>
              实时生成中
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {WALL_TILES.map((tile, i) => (
              <WallTile key={tile.label} {...tile} index={i} />
            ))}
          </div>
        </div>
      </section>

      {/* ─── 核心能力 ─────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-6xl px-5 py-20">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-text-faint">
          Capabilities
        </p>
        <h2 className="mt-2 text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">
          为创作流程而生
        </h2>
        <div className="mt-10 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
          {CAPABILITIES.map((cap) => (
            <div key={cap.id} className="bg-surface p-6">
              <p className="font-mono text-xs text-brand">{cap.id}</p>
              <h3 className="mt-3 text-[15px] font-semibold tracking-[-0.01em]">
                {cap.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-text-muted">
                {cap.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ─── 工作流 ───────────────────────────────────────── */}
      <section className="border-t border-border">
        <div className="mx-auto w-full max-w-6xl px-5 py-20">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-text-faint">
            Workflow
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">
            三步，到达你想要的画面
          </h2>
          <div className="mt-10 grid gap-10 sm:grid-cols-3">
            {STEPS.map((step) => (
              <div key={step.id} className="border-t border-border pt-5">
                <p className="font-mono text-xs text-text-faint">{step.id}</p>
                <h3 className="mt-2 text-[15px] font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-text-muted">
                  {step.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── 收尾 CTA ─────────────────────────────────────── */}
      <section className="border-t border-border bg-surface/40">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-start gap-6 px-5 py-20">
          <h2 className="max-w-2xl text-[clamp(1.8rem,4vw,2.8rem)] font-semibold leading-[1.1] tracking-[-0.03em]">
            准备好把想法
            <br />
            挂上墙了吗
          </h2>
          <Link
            href="/register"
            className="flex h-11 items-center gap-2 rounded-md bg-brand px-6 text-sm font-medium text-on-accent transition-colors hover:bg-brand/88"
          >
            免费开始
            <ArrowUpRight size={16} aria-hidden />
          </Link>
        </div>
        <footer className="border-t border-border">
          <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-5">
            <Logo size="sm" />
            <p className="font-mono text-[11px] text-text-faint">
              © 2026 Chūgǎo Studio
            </p>
          </div>
        </footer>
      </section>
    </main>
  );
}
