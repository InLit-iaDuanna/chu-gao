"use client";

import { motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import {
  ArrowRight,
  Layers,
  Sparkles,
  Wand2,
  Zap,
  MessageSquare,
  ImageIcon,
  Download,
} from "lucide-react";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: EASE, delay: i * 0.07 },
  }),
};

const slideInFromRight = {
  hidden: { opacity: 0, x: 40 },
  visible: (i: number) => ({
    opacity: 1,
    x: 0,
    transition: { duration: 0.7, ease: EASE, delay: 0.3 + i * 0.1 },
  }),
};

interface Feature {
  icon: typeof Wand2;
  title: string;
  desc: string;
}

const FEATURES: Feature[] = [
  {
    icon: Wand2,
    title: "智能生成",
    desc: "从一句话到完整草稿，AI 理解你的创作意图。",
  },
  {
    icon: Layers,
    title: "多轮迭代",
    desc: "保留每个版本，随时回溯，精炼到满意为止。",
  },
  {
    icon: Zap,
    title: "即时预览",
    desc: "所见即所得，编辑与预览同步，减少切换成本。",
  },
];

interface Step {
  icon: typeof MessageSquare;
  label: string;
  title: string;
  desc: string;
}

const STEPS: Step[] = [
  {
    icon: MessageSquare,
    label: "01",
    title: "描述想法",
    desc: "用自然语言告诉模型你想要的画面，或上传参考图。",
  },
  {
    icon: ImageIcon,
    label: "02",
    title: "实时生成",
    desc: "内置多通道与回退策略，等待感更短、稳定性更高。",
  },
  {
    icon: Download,
    label: "03",
    title: "导出与迭代",
    desc: "满意即可下载；不满意继续对话，保留全部历史版本。",
  },
];

export default function HomePage(): React.ReactElement {
  const reduceMotion = useReducedMotion();

  return (
    <main className="relative flex min-h-screen flex-col items-center overflow-hidden bg-background">
      {/* Stronger atmospheric background */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        {/* Primary glow - much stronger */}
        <div
          className={`absolute left-1/2 top-[-180px] h-[920px] w-[920px] -translate-x-1/2 rounded-full bg-info/[0.15] blur-[200px] ${reduceMotion ? "" : "ambient-drift"}`}
        />
        {/* Secondary glows with more presence */}
        <div className="absolute left-[8%] top-[35%] h-[520px] w-[520px] rounded-full bg-success/[0.08] blur-[160px]" />
        <div className="absolute right-[5%] top-[25%] h-[460px] w-[460px] rounded-full bg-warning/[0.1] blur-[140px]" />
        {/* Stronger noise overlay */}
        <div className="absolute inset-0 noise-overlay opacity-[0.35]" />
        {/* Grid with better visibility */}
        <div
          className="absolute inset-0 opacity-[0.08] [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)]"
          style={{
            backgroundImage:
              "linear-gradient(rgb(var(--text)) 1.5px, transparent 1.5px), linear-gradient(90deg, rgb(var(--text)) 1.5px, transparent 1.5px)",
            backgroundSize: "64px 64px",
          }}
        />
      </div>

      {/* Header - cleaner, stronger hierarchy */}
      <header className="relative z-10 flex w-full max-w-7xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-3">
          <div className="relative flex h-8 w-8 items-center justify-center">
            <div className="absolute h-6 w-6 rounded-[4px] border-2 border-foreground bg-surface" />
            <div className="absolute h-3.5 w-3.5 translate-x-[4px] translate-y-[4px] rounded-[2.5px] bg-foreground" />
          </div>
          <span className="text-[17px] font-bold tracking-[-0.02em] text-foreground">
            初稿
          </span>
        </div>
        <div className="flex items-center gap-2.5">
          <Link
            href="/register"
            className="flex h-9 items-center rounded-md px-4 text-[14px] font-medium text-foreground transition-all hover:bg-surface-2 active:scale-[0.96]"
          >
            注册
          </Link>
          <Link
            href="/login"
            className="group flex h-9 items-center gap-1.5 rounded-md border-2 border-border-strong bg-foreground px-4 text-[14px] font-semibold text-background transition-all hover:border-foreground hover:bg-foreground/90 active:scale-[0.96]"
          >
            登录
            <ArrowRight
              size={14}
              strokeWidth={2.5}
              className="transition-transform duration-200 group-hover:translate-x-0.5"
            />
          </Link>
        </div>
      </header>

      {/* Hero - Editorial layout with asymmetry */}
      <section className="relative z-10 mt-12 flex w-full max-w-7xl flex-col px-6">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-12">
          {/* Left column - Hero text */}
          <div className="flex flex-col lg:col-span-7">
            <motion.div
              custom={0}
              variants={fadeUp}
              initial="hidden"
              animate="visible"
              className="mb-6 inline-flex w-fit items-center gap-2.5 rounded-full border-2 border-success/30 bg-success/10 px-4 py-1.5 backdrop-blur-sm"
            >
              <span className="relative flex h-2 w-2">
                <span className="absolute inset-0 animate-ping rounded-full bg-success motion-reduce:animate-none" />
                <span className="relative h-2 w-2 rounded-full bg-success" />
              </span>
              <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-success">
                v3 · 公测中
              </span>
            </motion.div>

            <motion.h1
              custom={1}
              variants={fadeUp}
              initial="hidden"
              animate="visible"
              className="mb-8 text-[clamp(3rem,7vw,5.5rem)] font-bold leading-[0.95] tracking-[-0.04em] text-foreground"
            >
              稳稳地接住
              <br />
              <span className="relative inline-flex items-baseline gap-3">
                <span className="font-serif italic text-info">你的</span>
                <span className="relative">
                  设计灵感
                  <svg
                    className="absolute -bottom-2 left-0 w-full text-info/40"
                    height="8"
                    viewBox="0 0 200 8"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M2 6C40 2 80 1 120 3C160 5 180 6 198 5"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>
              </span>
            </motion.h1>

            <motion.p
              custom={2}
              variants={fadeUp}
              initial="hidden"
              animate="visible"
              className="mb-10 max-w-xl text-[18px] leading-[1.7] text-text-muted"
            >
              初稿是一个为设计学生打造的图像生成工作台。从模糊的想法到可用的画面，
              一次对话，多轮迭代，一站完成。
            </motion.p>

            <motion.div
              custom={3}
              variants={fadeUp}
              initial="hidden"
              animate="visible"
              className="flex flex-wrap items-center gap-4"
            >
              <Link
                href="/register"
                className="group relative flex h-[52px] items-center gap-2.5 overflow-hidden rounded-lg border-2 border-success bg-success px-6 text-[15px] font-bold text-background shadow-[0_20px_40px_-20px_rgb(var(--success)/0.9)] transition-all hover:scale-[1.02] hover:border-success hover:shadow-[0_24px_48px_-20px_rgb(var(--success)/1)] active:scale-[0.98]"
              >
                <span className="relative z-10">免费开始</span>
                <ArrowRight
                  size={16}
                  strokeWidth={2.5}
                  className="relative z-10 transition-transform duration-200 group-hover:translate-x-1"
                />
                <div className="absolute inset-0 bg-gradient-to-r from-success/0 via-white/20 to-success/0 opacity-0 transition-opacity group-hover:opacity-100" />
              </Link>
              <Link
                href="/login"
                className="flex h-[52px] items-center gap-2.5 rounded-lg border-2 border-border-strong bg-surface/80 px-6 text-[15px] font-semibold text-foreground backdrop-blur-sm transition-all hover:border-foreground hover:bg-surface active:scale-[0.98]"
              >
                已有账号
              </Link>
            </motion.div>

            <motion.p
              custom={4}
              variants={fadeUp}
              initial="hidden"
              animate="visible"
              className="mt-8 font-mono text-[12px] font-medium text-text-faint"
            >
              注册即可获得初始额度 · 无需信用卡
            </motion.p>
          </div>

          {/* Right column - Visual preview with depth */}
          <motion.div
            custom={5}
            variants={slideInFromRight}
            initial="hidden"
            animate="visible"
            className="relative lg:col-span-5"
          >
            <div className="relative">
              {/* Background glow */}
              <div
                aria-hidden
                className="absolute -inset-4 rounded-2xl bg-info/20 blur-3xl"
              />

              {/* Preview container with stronger borders */}
              <div className="relative overflow-hidden rounded-2xl border-2 border-border-strong bg-surface shadow-[0_24px_64px_-12px_rgba(0,0,0,0.4)]">
                {/* Window chrome with stronger presence */}
                <div className="flex items-center gap-2.5 border-b-2 border-border bg-surface-2 px-5 py-3.5">
                  <div className="flex gap-2">
                    <span className="h-3 w-3 rounded-full bg-danger" />
                    <span className="h-3 w-3 rounded-full bg-warning" />
                    <span className="h-3 w-3 rounded-full bg-success" />
                  </div>
                  <div className="mx-auto flex items-center gap-2 rounded-md border border-border bg-background/80 px-3.5 py-1.5 font-mono text-[11px] font-medium text-text-faint">
                    <span className="h-1.5 w-1.5 rounded-full bg-success" />
                    chugao.studio / workbench
                  </div>
                </div>

                {/* Bento-style content grid */}
                <div className="grid grid-cols-[220px_1fr] divide-x-2 divide-border">
                  {/* Sidebar */}
                  <div className="flex flex-col gap-3 bg-surface-2/40 p-4">
                    <div className="flex items-center gap-2.5 rounded-lg border border-info/30 bg-info/10 p-2.5">
                      <Sparkles
                        size={14}
                        className="text-info"
                        strokeWidth={2}
                      />
                      <span className="text-[12px] font-semibold text-foreground">
                        新建对话
                      </span>
                    </div>
                    {[1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className="flex flex-col gap-2 rounded-lg border border-transparent p-2.5 transition-colors hover:border-border hover:bg-surface-2"
                      >
                        <div
                          className="h-2 rounded-full bg-text-faint/40"
                          style={{ width: `${75 - i * 12}%` }}
                        />
                        <div
                          className="h-1.5 rounded-full bg-text-faint/25"
                          style={{ width: `${55 - i * 8}%` }}
                        />
                      </div>
                    ))}
                  </div>

                  {/* Canvas area with overlapping cards */}
                  <div className="relative aspect-[14/9] overflow-hidden bg-gradient-to-br from-info/8 via-surface to-warning/[0.06]">
                    <div className="absolute inset-0 p-5">
                      {/* Staggered card layout for depth */}
                      <div className="relative h-full">
                        {/* Back cards */}
                        <div
                          className="absolute left-[8%] top-[8%] h-[38%] w-[38%] origin-top-left rotate-[-2deg] rounded-xl border-2 border-border bg-surface-2 shadow-lg"
                          style={{
                            background: `linear-gradient(145deg, rgb(var(--info) / 0.12), rgb(var(--surface-2)))`,
                          }}
                        >
                          <div className="absolute bottom-2 left-2 rounded-md bg-background/70 px-2 py-1 font-mono text-[10px] font-semibold text-foreground backdrop-blur-sm">
                            v1
                          </div>
                        </div>

                        <div
                          className="absolute right-[10%] top-[6%] h-[36%] w-[36%] origin-top-right rotate-[3deg] rounded-xl border-2 border-border bg-surface shadow-lg"
                          style={{
                            background: `linear-gradient(165deg, rgb(var(--warning) / 0.1), rgb(var(--surface)))`,
                          }}
                        >
                          <div className="absolute bottom-2 left-2 rounded-md bg-background/70 px-2 py-1 font-mono text-[10px] font-semibold text-foreground backdrop-blur-sm">
                            v2
                          </div>
                        </div>

                        {/* Front cards with more prominence */}
                        <div
                          className="absolute bottom-[12%] left-[12%] h-[42%] w-[42%] origin-bottom-left rotate-[-1deg] rounded-xl border-2 border-info/40 bg-surface shadow-2xl"
                          style={{
                            background: `linear-gradient(135deg, rgb(var(--info) / 0.18), rgb(var(--success) / 0.08), rgb(var(--surface)))`,
                          }}
                        >
                          <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-md border border-info/30 bg-info/20 px-2 py-1 font-mono text-[10px] font-bold text-info backdrop-blur-sm">
                            <Sparkles size={10} strokeWidth={2.5} />
                            v3
                          </div>
                        </div>

                        <div
                          className="absolute bottom-[8%] right-[8%] h-[40%] w-[40%] origin-bottom-right rotate-[2deg] rounded-xl border-2 border-success/40 bg-surface-2 shadow-2xl"
                          style={{
                            background: `linear-gradient(155deg, rgb(var(--success) / 0.15), rgb(var(--surface-2)))`,
                          }}
                        >
                          <div className="absolute bottom-2 left-2 rounded-md bg-background/70 px-2 py-1 font-mono text-[10px] font-semibold text-foreground backdrop-blur-sm">
                            v4
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Features - Bento grid layout */}
      <section
        id="features"
        className="relative z-10 mt-32 w-full max-w-7xl px-6"
      >
        <motion.div
          custom={0}
          variants={fadeUp}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          className="mb-4 font-mono text-[12px] font-bold uppercase tracking-[0.2em] text-text-faint"
        >
          核心能力
        </motion.div>
        <motion.h2
          custom={1}
          variants={fadeUp}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          className="mb-16 text-[clamp(2rem,4.5vw,3.2rem)] font-bold leading-[1.1] tracking-[-0.03em] text-foreground"
        >
          为<span className="font-serif italic text-info">表达</span>而生
        </motion.h2>

        {/* Asymmetric bento grid */}
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, desc }, i) => (
            <motion.div
              key={title}
              custom={i}
              variants={fadeUp}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: "-80px" }}
              className={`group relative overflow-hidden rounded-2xl border-2 border-border bg-surface p-8 transition-all duration-300 hover:-translate-y-1 hover:border-foreground/30 hover:shadow-[0_24px_48px_-12px_rgba(0,0,0,0.3)] ${
                i === 0 ? "sm:col-span-2 lg:col-span-1" : ""
              }`}
            >
              {/* Decorative corner accent */}
              <div className="absolute right-0 top-0 h-20 w-20 bg-gradient-to-br from-info/10 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />

              <div className="relative">
                <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-xl border-2 border-border-strong bg-background transition-all group-hover:border-foreground group-hover:bg-foreground group-hover:text-background">
                  <Icon size={20} strokeWidth={2} />
                </div>
                <h3 className="mb-3 text-[17px] font-bold tracking-[-0.01em] text-foreground">
                  {title}
                </h3>
                <p className="text-[14px] leading-relaxed text-text-muted">
                  {desc}
                </p>
              </div>

              {/* Bottom accent line */}
              <div className="absolute inset-x-0 bottom-0 h-1 scale-x-0 bg-gradient-to-r from-info via-success to-warning transition-transform duration-500 group-hover:scale-x-100" />
            </motion.div>
          ))}
        </div>
      </section>

      {/* Steps - Linear flow with connection lines */}
      <section className="relative z-10 mt-32 w-full max-w-7xl px-6">
        <motion.div
          variants={fadeUp}
          custom={0}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          className="mb-4 font-mono text-[12px] font-bold uppercase tracking-[0.2em] text-text-faint"
        >
          如何工作
        </motion.div>
        <motion.h2
          variants={fadeUp}
          custom={1}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          className="mb-20 text-[clamp(2rem,4.5vw,3.2rem)] font-bold leading-[1.1] tracking-[-0.03em] text-foreground"
        >
          三步，到达你想要的画面
        </motion.h2>

        <div className="relative grid gap-8 sm:grid-cols-3">
          {/* Connection line */}
          <div
            aria-hidden
            className="absolute left-[10%] right-[10%] top-6 hidden h-0.5 bg-gradient-to-r from-border-strong via-foreground/20 to-border-strong sm:block"
          />

          {STEPS.map(({ icon: Icon, label, title, desc }, i) => (
            <motion.div
              key={label}
              variants={fadeUp}
              custom={i + 2}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: "-80px" }}
              className="relative flex flex-col items-center text-center"
            >
              <div className="relative z-10 mb-6 flex h-12 w-12 items-center justify-center rounded-full border-2 border-foreground bg-background shadow-[0_8px_24px_-8px_rgba(0,0,0,0.3)]">
                <Icon size={20} strokeWidth={2} className="text-foreground" />
              </div>
              <div className="mb-3 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-text-faint">
                {label}
              </div>
              <h3 className="mb-3 text-[17px] font-bold tracking-[-0.01em] text-foreground">
                {title}
              </h3>
              <p className="max-w-[240px] text-[14px] leading-relaxed text-text-muted">
                {desc}
              </p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* CTA - Bold, elevated treatment */}
      <section className="relative z-10 mb-24 mt-32 w-full max-w-5xl px-6">
        <motion.div
          variants={fadeUp}
          custom={0}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          className="relative overflow-hidden rounded-3xl border-2 border-border-strong bg-surface px-10 py-16 text-center shadow-[0_32px_64px_-16px_rgba(0,0,0,0.4)]"
        >
          {/* Stronger atmosphere */}
          <div
            aria-hidden
            className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-info/15 blur-3xl"
          />
          <div
            aria-hidden
            className="absolute -bottom-32 -right-20 h-72 w-72 rounded-full bg-success/12 blur-3xl"
          />

          <h2 className="relative mb-5 text-[clamp(2rem,5vw,3.2rem)] font-bold leading-[1.05] tracking-[-0.04em] text-foreground">
            准备好把
            <span className="font-serif italic text-info">想法</span>
            变成画面了吗
          </h2>
          <p className="relative mb-8 text-[16px] leading-relaxed text-text-muted">
            注册即送初始额度，立刻打开工作台。
          </p>
          <Link
            href="/register"
            className="relative inline-flex h-[56px] items-center gap-2.5 rounded-xl border-2 border-success bg-success px-8 text-[16px] font-bold text-background shadow-[0_24px_48px_-20px_rgb(var(--success)/0.9)] transition-all hover:scale-[1.03] hover:shadow-[0_28px_56px_-20px_rgb(var(--success)/1)] active:scale-[0.98]"
          >
            免费开始
            <ArrowRight size={18} strokeWidth={2.5} />
          </Link>
        </motion.div>

        <footer className="mt-16 flex flex-col items-center gap-3 text-center">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-text-faint">
            © Chūgǎo Studio
          </p>
        </footer>
      </section>
    </main>
  );
}
