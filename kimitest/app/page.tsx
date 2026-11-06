import Link from "next/link";
import { ArrowRight, ArrowUpRight, Sparkles } from "lucide-react";

// 初稿印务所 · First Draft Press —— 编辑级纸墨落地页。
// 纯静态服务端组件：零 Three.js、零模糊、零辉光；
// 动效只走 transform/opacity（见 globals.css）。

function stagger(i: number): React.CSSProperties {
  return { "--stagger": i } as React.CSSProperties;
}

const MARQUEE_ITEMS = [
  "文本生图 TEXT-TO-IMAGE",
  "多轮对话 MULTI-TURN",
  "版本留存 VERSIONING",
  "参考图控制 REFERENCE",
  "PPT 模式 PPT MODE",
  "批量导出 BATCH EXPORT",
];

const CAPABILITIES = [
  {
    index: "01",
    title: "智能生成",
    desc: "从一句话到完整草稿。多通道智能路由，等待更短、出图更稳。",
  },
  {
    index: "02",
    title: "多轮迭代",
    desc: "每一次修改都保留版本，随时回溯到任意一稿。",
  },
  {
    index: "03",
    title: "参考图控制",
    desc: "最多 16 张参考图，构图、色调、风格逐一锚定。",
  },
  {
    index: "04",
    title: "PPT 模式",
    desc: "草稿直接长成演示文稿，课堂汇报一步到位。",
  },
];

const STEPS = [
  {
    step: "STEP 01",
    title: "描述想法",
    desc: "用自然语言说出想要的画面，或丢进几张参考图。",
  },
  {
    step: "STEP 02",
    title: "实时生成",
    desc: "多通道并行调度，进度可见，失败自动换路重试。",
  },
  {
    step: "STEP 03",
    title: "导出与迭代",
    desc: "满意即导出；不满意继续对话，全部版本都在。",
  },
];

export default function HomePage(): React.ReactElement {
  return (
    <main className="relative min-h-screen bg-background text-foreground">
      {/* ── 顶栏：发丝线通栏，非浮动胶囊 ─────────────────────── */}
      <header className="fixed inset-x-0 top-0 z-50 border-b border-border bg-background/95">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-5">
          <Link href="/" className="flex items-baseline gap-2.5">
            <span className="font-serif text-[22px] leading-none tracking-[-0.02em]">
              初稿<sup className="ml-0.5 font-mono text-[10px]">®</sup>
            </span>
            <span className="hidden font-mono text-[10px] uppercase tracking-[0.24em] text-text-faint sm:inline">
              First Draft Press
            </span>
          </Link>
          <nav className="flex items-center gap-1 sm:gap-2">
            <Link
              href="#capabilities"
              className="hidden h-9 items-center px-3 font-mono text-[11px] uppercase tracking-[0.16em] text-text-muted transition-colors hover:text-foreground sm:flex"
            >
              能力
            </Link>
            <Link
              href="#workflow"
              className="hidden h-9 items-center px-3 font-mono text-[11px] uppercase tracking-[0.16em] text-text-muted transition-colors hover:text-foreground sm:flex"
            >
              流程
            </Link>
            <Link
              href="/login"
              className="flex h-9 items-center px-3 text-[13px] text-text-muted transition-colors hover:text-foreground"
            >
              登录
            </Link>
            <Link
              href="/register"
              className="group flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] border border-ink bg-ink px-4 text-[13px] font-semibold text-background transition-colors duration-150 hover:border-brand hover:bg-brand hover:text-on-brand"
            >
              免费开始
              <ArrowRight
                size={13}
                strokeWidth={2.5}
                className="transition-transform duration-150 group-hover:translate-x-0.5"
              />
            </Link>
          </nav>
        </div>
      </header>

      {/* ── Hero：巨型衬线 + 栏线网格 + 套准标记 ─────────────── */}
      <section className="press-columns relative border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-5 pb-20 pt-36 sm:pt-44">
          {/* 刊头行 */}
          <div
            className="anim-rise flex items-center gap-4 font-mono text-[10px] uppercase tracking-[0.24em] text-text-faint"
            style={stagger(0)}
          >
            <span>No. 001 — AI 图像工作台</span>
            <span aria-hidden className="h-px flex-1 bg-border" />
            <span className="hidden sm:inline">为设计学生而印</span>
            <span aria-hidden className="hidden h-px flex-1 bg-border sm:block" />
            <span>EST. 2026</span>
          </div>

          <div className="reg-marks mt-10">
            <h1
              className="anim-rise font-serif text-[clamp(3.2rem,10.5vw,9rem)] leading-[1.0] tracking-[-0.03em]"
              style={stagger(1)}
            >
              稳稳地接住
              <br />
              <em className="font-normal italic text-brand">你的设计灵感</em>
              <span className="text-brand">.</span>
            </h1>
          </div>

          <div className="mt-10 flex flex-col gap-10 sm:flex-row sm:items-end sm:justify-between">
            <p
              className="anim-rise max-w-md text-[16px] leading-[1.75] text-text-muted"
              style={stagger(2)}
            >
              初稿是为设计学生打造的图像生成工作台。从模糊的想法到可用的画面，
              一次对话，多轮迭代，一站完成。
            </p>
            <div className="anim-rise flex flex-wrap items-center gap-3" style={stagger(3)}>
              <Link
                href="/register"
                className="group flex h-12 items-center gap-2 rounded-[var(--radius-md)] border border-ink bg-ink px-7 text-[15px] font-semibold text-background transition-colors duration-150 hover:border-brand hover:bg-brand hover:text-on-brand"
              >
                免费开始
                <ArrowRight
                  size={16}
                  strokeWidth={2.5}
                  className="transition-transform duration-150 group-hover:translate-x-1"
                />
              </Link>
              <Link
                href="/login"
                className="flex h-12 items-center rounded-[var(--radius-md)] border border-border-strong px-7 text-[15px] font-medium text-foreground transition-colors duration-150 hover:border-ink hover:bg-ink hover:text-background"
              >
                已有账号
              </Link>
              <span className="stamp ml-2 hidden lg:inline-flex">公测中 · V3</span>
            </div>
          </div>

          <p
            className="anim-rise mt-8 font-mono text-[10px] uppercase tracking-[0.2em] text-text-faint"
            style={stagger(4)}
          >
            注册即得初始额度 · 无需信用卡 · 学生免费
          </p>
        </div>
      </section>

      {/* ── 跑马灯 ─────────────────────────────────────────── */}
      <div className="marquee border-b border-border bg-surface py-3" aria-hidden>
        <div className="marquee-track">
          {[0, 1].map((copy) => (
            <div key={copy} className="flex shrink-0 items-center">
              {MARQUEE_ITEMS.map((item) => (
                <span
                  key={`${copy}-${item}`}
                  className="flex items-center font-mono text-[11px] uppercase tracking-[0.22em] text-text-muted"
                >
                  <span className="px-6">{item}</span>
                  <span className="text-brand">✳</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* ── 产品打样：FIG.01 工作台样张 ──────────────────────── */}
      <section className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-5 py-24">
          <div className="mb-8 flex items-baseline justify-between">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.24em] text-text-faint">
              Fig. 01 — 工作台样张
            </h2>
            <span className="font-mono text-[11px] uppercase tracking-[0.24em] text-text-faint">
              实际界面，非示意图
            </span>
          </div>

          <div className="reg-marks border border-border-strong bg-surface">
            {/* 窗口栏 */}
            <div className="flex items-center gap-3 border-b border-border px-5 py-3">
              <div className="flex gap-1.5">
                <span className="h-2.5 w-2.5 border border-ink/40" />
                <span className="h-2.5 w-2.5 border border-ink/40" />
                <span className="h-2.5 w-2.5 bg-brand" />
              </div>
              <div className="mx-auto flex items-center gap-2 border border-border bg-background px-3.5 py-1 font-mono text-[11px] text-text-muted">
                <span className="h-1.5 w-1.5 bg-success" />
                chugao.studio / workbench
              </div>
              <div className="w-12" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-[220px_1fr]">
              {/* 侧栏 */}
              <div className="hidden flex-col gap-2.5 border-r border-border p-4 sm:flex">
                <div className="flex items-center gap-2 border border-ink bg-ink px-3 py-2.5 text-background">
                  <Sparkles size={13} />
                  <span className="text-[12px] font-medium">新建对话</span>
                </div>
                {[72, 58, 64].map((width, i) => (
                  <div key={i} className="flex flex-col gap-2 px-3 py-2.5">
                    <div className="h-1.5 bg-ink/15" style={{ width: `${width}%` }} />
                    <div className="h-1 bg-ink/8" style={{ width: `${width - 18}%` }} />
                  </div>
                ))}
                <div className="mt-auto border border-border p-3">
                  <div className="h-1.5 w-3/5 bg-ink/15" />
                  <div className="mt-2 h-1 w-2/5 bg-ink/8" />
                </div>
              </div>

              {/* 主区 */}
              <div className="p-5">
                <div className="mb-4 flex items-start gap-2.5">
                  <div className="border border-border bg-background px-3.5 py-2.5">
                    <div className="h-1.5 w-44 bg-ink/15" />
                    <div className="mt-1.5 h-1.5 w-28 bg-ink/10" />
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-text-faint">
                    <span className="h-1.5 w-1.5 animate-pulse bg-brand" />
                    生成中
                  </div>
                </div>

                {/* 样张网格：网点 / 墨 / 专色 / 骨架 */}
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <div className="press-dots relative aspect-[4/5] border border-border">
                    <span className="absolute bottom-2 left-2 border border-ink/30 bg-surface px-1.5 py-0.5 font-mono text-[10px]">
                      V1
                    </span>
                  </div>
                  <div className="relative aspect-[4/5] border border-ink bg-ink">
                    <span className="absolute bottom-2 left-2 bg-brand px-1.5 py-0.5 font-mono text-[10px] text-on-brand">
                      V2
                    </span>
                  </div>
                  <div className="relative aspect-[4/5] border border-brand bg-brand">
                    <span className="absolute bottom-2 left-2 bg-ink px-1.5 py-0.5 font-mono text-[10px] text-background">
                      V3
                    </span>
                  </div>
                  <div className="relative aspect-[4/5] border border-border">
                    <div className="skeleton-glow absolute inset-0 flex items-center justify-center">
                      <Sparkles size={16} className="animate-pulse text-brand" />
                    </div>
                  </div>
                </div>

                {/* 输入坞 */}
                <div className="mt-4 flex items-center gap-3 border border-border-strong bg-background px-4 py-3">
                  <div className="h-1.5 flex-1 bg-ink/12" />
                  <div className="flex h-7 w-7 items-center justify-center bg-ink">
                    <ArrowRight size={13} className="text-background" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 核心能力：编号索引行，hover 整行反色 ──────────────── */}
      <section id="capabilities" className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-5 py-24">
          <div className="mb-4 font-mono text-[11px] uppercase tracking-[0.24em] text-text-faint">
            Capabilities — 核心能力
          </div>
          <h2 className="mb-14 font-serif text-[clamp(2.2rem,5vw,4rem)] leading-[1.05] tracking-[-0.02em]">
            为<em className="italic text-brand">表达</em>而生
          </h2>

          <div className="border-t border-border">
            {CAPABILITIES.map(({ index, title, desc }) => (
              <div
                key={index}
                className="group grid cursor-default grid-cols-[auto_1fr_auto] items-baseline gap-4 border-b border-border py-7 transition-colors duration-150 hover:bg-ink sm:grid-cols-[80px_1fr_1fr_48px] sm:gap-8 sm:py-9"
              >
                <span className="font-mono text-[12px] tracking-[0.1em] text-brand transition-colors duration-150 group-hover:text-brand">
                  {index}
                </span>
                <h3 className="font-serif text-[clamp(1.6rem,3.4vw,2.6rem)] leading-none tracking-[-0.02em] transition-colors duration-150 group-hover:text-background">
                  {title}
                </h3>
                <p className="col-span-2 max-w-sm text-[14px] leading-relaxed text-text-muted transition-colors duration-150 group-hover:text-background/70 sm:col-span-1">
                  {desc}
                </p>
                <ArrowUpRight
                  size={20}
                  strokeWidth={1.8}
                  className="hidden self-center justify-self-end text-text-faint transition-all duration-150 group-hover:translate-x-1 group-hover:text-brand sm:block"
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 工作流程：三栏分格 ───────────────────────────────── */}
      <section id="workflow" className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-5 py-24">
          <div className="mb-4 font-mono text-[11px] uppercase tracking-[0.24em] text-text-faint">
            Process — 如何工作
          </div>
          <h2 className="mb-14 font-serif text-[clamp(2.2rem,5vw,4rem)] leading-[1.05] tracking-[-0.02em]">
            三步，抵达画面
          </h2>

          <div className="grid border border-border-strong sm:grid-cols-3">
            {STEPS.map(({ step, title, desc }, i) => (
              <div
                key={step}
                className={`p-8 ${i > 0 ? "border-t border-border sm:border-l sm:border-t-0" : ""}`}
              >
                <div className="font-mono text-[11px] uppercase tracking-[0.24em] text-brand">
                  {step}
                </div>
                <h3 className="mt-5 font-serif text-[26px] tracking-[-0.01em]">
                  {title}
                </h3>
                <p className="mt-3 text-[14px] leading-relaxed text-text-muted">
                  {desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 终章 CTA ───────────────────────────────────────── */}
      <section className="press-columns border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-5 py-28 text-center sm:py-36">
          <div className="reg-marks inline-block">
            <h2 className="font-serif text-[clamp(2.6rem,7vw,6rem)] leading-[1.02] tracking-[-0.03em]">
              准备好把想法
              <br />
              变成<em className="italic text-brand">画面</em>了吗
            </h2>
          </div>
          <p className="mx-auto mt-8 max-w-md text-[16px] leading-relaxed text-text-muted">
            注册即送初始额度，立刻打开工作台。无需信用卡，无需等待。
          </p>
          <Link
            href="/register"
            className="group mt-10 inline-flex h-13 items-center gap-2.5 rounded-[var(--radius-md)] border border-ink bg-ink px-10 py-3.5 text-[15px] font-semibold text-background transition-colors duration-150 hover:border-brand hover:bg-brand hover:text-on-brand"
          >
            免费开始
            <ArrowRight
              size={17}
              strokeWidth={2.5}
              className="transition-transform duration-150 group-hover:translate-x-1"
            />
          </Link>
        </div>
      </section>

      {/* ── 页脚 ──────────────────────────────────────────── */}
      <footer className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-5 py-10 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="font-serif text-[28px] leading-none tracking-[-0.02em]">
            初稿<sup className="ml-0.5 font-mono text-[10px]">®</sup>
          </div>
          <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.22em] text-text-faint">
            First Draft Press · 为设计学生而印
          </p>
        </div>
        <div className="flex items-center gap-6 font-mono text-[11px] uppercase tracking-[0.16em] text-text-muted">
          <Link href="/login" className="transition-colors hover:text-foreground">
            登录
          </Link>
          <Link href="/register" className="transition-colors hover:text-foreground">
            注册
          </Link>
          <span className="text-text-faint">© 2026 Chūgǎo Studio</span>
        </div>
      </footer>
    </main>
  );
}
