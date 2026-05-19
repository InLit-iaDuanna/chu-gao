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
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div
          className={`absolute left-1/2 top-[-220px] h-[820px] w-[820px] -translate-x-1/2 rounded-full bg-info/[0.06] blur-[180px] ${reduceMotion ? "" : "ambient-drift"}`}
        />
        <div className="absolute left-[10%] top-[40%] h-[420px] w-[420px] rounded-full bg-foreground/[0.025] blur-[140px]" />
        <div className="absolute right-[8%] top-[28%] h-[360px] w-[360px] rounded-full bg-foreground/[0.03] blur-[120px]" />
        <div className="absolute inset-0 noise-overlay" />
        <div
          className="absolute inset-0 opacity-[0.04] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]"
          style={{
            backgroundImage:
              "linear-gradient(rgb(var(--text)) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--text)) 1px, transparent 1px)",
            backgroundSize: "56px 56px",
          }}
        />
      </div>

      <header className="relative z-10 flex w-full max-w-5xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-3">
          <div className="relative flex h-7 w-7 items-center justify-center">
            <div className="absolute h-5 w-5 rounded-[3px] border border-border-strong bg-surface" />
            <div className="absolute h-3 w-3 translate-x-[3px] translate-y-[3px] rounded-[2px] bg-foreground" />
          </div>
          <span className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">
            初稿
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/register"
            className="flex h-8 items-center rounded-lg px-3.5 text-[13px] font-medium text-foreground transition-all hover:bg-surface-2 active:scale-[0.97]"
          >
            注册
          </Link>
          <Link
            href="/login"
            className="group flex h-8 items-center gap-1.5 rounded-lg border border-border px-3.5 text-[13px] font-medium text-foreground transition-all hover:border-border-strong hover:bg-surface-2 active:scale-[0.97]"
          >
            登录
            <ArrowRight
              size={13}
              strokeWidth={1.5}
              className="transition-transform duration-200 group-hover:translate-x-0.5"
            />
          </Link>
        </div>
      </header>

      <section className="relative z-10 mt-20 flex w-full max-w-3xl flex-col items-center px-6 text-center">
        <motion.div
          custom={0}
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-surface/60 px-3 py-1 backdrop-blur-sm"
        >
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inset-0 animate-ping rounded-full bg-success/60 motion-reduce:animate-none" />
            <span className="relative h-1.5 w-1.5 rounded-full bg-success" />
          </span>
          <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-text-muted">
            v3 · 公测中
          </span>
        </motion.div>

        <motion.h1
          custom={1}
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          className="text-[clamp(2.6rem,6.4vw,4.4rem)] font-semibold leading-[1.05] tracking-[-0.035em] text-foreground"
        >
          稳稳地接住
          <br />
          <span className="relative inline-flex items-baseline">
            <span className="font-serif italic text-foreground">你的</span>
            <span className="ml-1">设计灵感</span>
          </span>
        </motion.h1>

        <motion.p
          custom={2}
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          className="mt-6 max-w-xl text-[16px] leading-[1.65] text-text-muted"
        >
          初稿是一个为设计学生打造的图像生成工作台。从模糊的想法到可用的画面，
          一次对话，多轮迭代，一站完成。
        </motion.p>

        <motion.div
          custom={3}
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          className="mt-9 flex flex-wrap items-center justify-center gap-3"
        >
          <Link
            href="/register"
            className="group relative flex h-11 items-center gap-2 overflow-hidden rounded-lg border border-success/25 bg-success px-5 text-[14px] font-medium text-background shadow-[0_16px_34px_-18px_rgb(var(--success)/0.86)] transition-all hover:bg-success/90 hover:shadow-[0_18px_38px_-18px_rgb(var(--success)/0.92)] active:scale-[0.97]"
          >
            <span className="relative z-10">免费开始</span>
            <ArrowRight
              size={14}
              strokeWidth={2}
              className="relative z-10 transition-transform duration-200 group-hover:translate-x-0.5"
            />
          </Link>
          <Link
            href="/login"
            className="flex h-11 items-center gap-2 rounded-lg border border-border bg-surface/60 px-5 text-[14px] font-medium text-foreground backdrop-blur-sm transition-all hover:border-border-strong hover:bg-surface-2 active:scale-[0.97]"
          >
            已有账号
          </Link>
        </motion.div>

        <motion.p
          custom={4}
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          className="mt-6 font-mono text-[11px] text-text-faint"
        >
          注册即可获得初始额度 · 无需信用卡
        </motion.p>
      </section>

      <motion.section
        custom={5}
        variants={fadeUp}
        initial="hidden"
        animate="visible"
        className="relative z-10 mt-20 w-full max-w-5xl px-6"
      >
        <div className="relative">
          <div
            aria-hidden
            className="absolute inset-x-12 -bottom-6 h-24 rounded-full bg-info/20 blur-3xl"
          />
          <div className="relative overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-lg)]">
            <div className="flex items-center gap-2 border-b border-border bg-surface-2/60 px-4 py-2.5">
              <div className="flex gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-danger/70" />
                <span className="h-2.5 w-2.5 rounded-full bg-warning/70" />
                <span className="h-2.5 w-2.5 rounded-full bg-success/70" />
              </div>
              <div className="mx-auto flex items-center gap-1.5 rounded-md border border-border bg-background/60 px-3 py-1 font-mono text-[10.5px] text-text-faint">
                <span className="h-1.5 w-1.5 rounded-full bg-success" />
                chugao.studio / workbench
              </div>
            </div>
            <div className="grid grid-cols-[260px_1fr] divide-x divide-border">
              <div className="flex flex-col gap-3 bg-surface-2/30 p-4">
                <div className="flex items-center gap-2 rounded-md bg-foreground/[0.04] p-2">
                  <Sparkles size={12} className="text-info" strokeWidth={1.5} />
                  <span className="text-[11px] text-foreground">
                    新建对话
                  </span>
                </div>
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="flex flex-col gap-1.5 rounded-md p-2 hover:bg-surface-2/60"
                  >
                    <div
                      className="h-1.5 rounded-full bg-text-faint/30"
                      style={{ width: `${70 - i * 10}%` }}
                    />
                    <div
                      className="h-1 rounded-full bg-text-faint/20"
                      style={{ width: `${50 - i * 5}%` }}
                    />
                  </div>
                ))}
              </div>
              <div className="relative aspect-[16/10] bg-gradient-to-br from-info/10 via-surface to-warning/[0.05]">
                <div className="absolute inset-6 grid grid-cols-2 gap-3">
                  {[0, 1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="relative overflow-hidden rounded-lg border border-border bg-surface-2"
                      style={{
                        background: `linear-gradient(${135 + i * 30}deg, rgb(var(--info) / 0.${15 + i * 5}), rgb(var(--warning) / 0.${8 + i * 3}), rgb(var(--surface-2)))`,
                      }}
                    >
                      <div className="absolute bottom-2 left-2 rounded bg-background/60 px-1.5 py-0.5 font-mono text-[9px] text-foreground backdrop-blur-sm">
                        v{i + 1}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </motion.section>

      <section
        id="features"
        className="relative z-10 mt-32 w-full max-w-4xl px-6"
      >
        <motion.p
          custom={0}
          variants={fadeUp}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          className="mb-3 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-text-faint"
        >
          核心能力
        </motion.p>
        <motion.h2
          custom={1}
          variants={fadeUp}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          className="mb-12 text-center text-[28px] font-semibold leading-tight tracking-[-0.02em] text-foreground"
        >
          为<span className="font-serif italic text-foreground">表达</span>而生
        </motion.h2>

        <div className="grid gap-4 sm:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, desc }, i) => (
            <motion.div
              key={title}
              custom={i}
              variants={fadeUp}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: "-80px" }}
              className="group relative overflow-hidden rounded-2xl border border-border bg-surface/60 p-6 backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-border-strong hover:bg-surface hover:shadow-[var(--shadow-md)]"
            >
              <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-background transition-colors group-hover:border-foreground/30 group-hover:bg-foreground/[0.04]">
                <Icon size={16} strokeWidth={1.5} className="text-foreground" />
              </div>
              <h3 className="mb-2 text-[15px] font-semibold text-foreground">
                {title}
              </h3>
              <p className="text-[13px] leading-relaxed text-text-muted">
                {desc}
              </p>
              <div className="absolute inset-x-6 bottom-0 h-px scale-x-0 bg-gradient-to-r from-transparent via-foreground to-transparent transition-transform duration-500 group-hover:scale-x-100" />
            </motion.div>
          ))}
        </div>
      </section>

      <section className="relative z-10 mt-32 w-full max-w-4xl px-6">
        <motion.p
          variants={fadeUp}
          custom={0}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          className="mb-3 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-text-faint"
        >
          如何工作
        </motion.p>
        <motion.h2
          variants={fadeUp}
          custom={1}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          className="mb-14 text-center text-[28px] font-semibold leading-tight tracking-[-0.02em] text-foreground"
        >
          三步，到达你想要的画面
        </motion.h2>

        <div className="relative grid gap-6 sm:grid-cols-3">
          <div
            aria-hidden
            className="absolute left-[12%] right-[12%] top-5 hidden h-px bg-gradient-to-r from-transparent via-border-strong to-transparent sm:block"
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
              <div className="relative z-10 mb-5 flex h-10 w-10 items-center justify-center rounded-full border border-border-strong bg-background">
                <Icon size={16} strokeWidth={1.5} className="text-foreground" />
              </div>
              <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.18em] text-text-faint">
                {label}
              </div>
              <h3 className="mb-2 text-[15px] font-semibold text-foreground">
                {title}
              </h3>
              <p className="max-w-[220px] text-[13px] leading-relaxed text-text-muted">
                {desc}
              </p>
            </motion.div>
          ))}
        </div>
      </section>

      <section className="relative z-10 mt-32 mb-24 w-full max-w-3xl px-6">
        <motion.div
          variants={fadeUp}
          custom={0}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          className="relative overflow-hidden rounded-3xl border border-border bg-surface px-8 py-14 text-center"
        >
          <div
            aria-hidden
            className="absolute -left-20 -top-20 h-60 w-60 rounded-full bg-info/10 blur-3xl"
          />
          <div
            aria-hidden
            className="absolute -bottom-24 -right-16 h-60 w-60 rounded-full bg-foreground/5 blur-3xl"
          />
          <h2 className="relative text-[clamp(1.8rem,4vw,2.6rem)] font-semibold leading-tight tracking-[-0.03em] text-foreground">
            准备好把<span className="font-serif italic text-foreground">想法</span>
            变成画面了吗
          </h2>
          <p className="relative mt-4 text-[15px] leading-relaxed text-text-muted">
            注册即送初始额度，立刻打开工作台。
          </p>
          <Link
            href="/register"
            className="relative mt-7 inline-flex h-11 items-center gap-2 rounded-lg border border-success/25 bg-success px-6 text-[14px] font-medium text-background shadow-[0_16px_34px_-18px_rgb(var(--success)/0.86)] transition-all hover:bg-success/90 hover:shadow-[0_18px_38px_-18px_rgb(var(--success)/0.92)] active:scale-[0.97]"
          >
            免费开始
            <ArrowRight size={14} strokeWidth={2} />
          </Link>
        </motion.div>

        <footer className="mt-12 flex flex-col items-center gap-2 text-center">
          <p className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-text-faint">
            © Chūgǎo Studio
          </p>
        </footer>
      </section>
    </main>
  );
}
