"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { ArrowRight, Layers, Wand2, Zap } from "lucide-react";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.55, ease: EASE, delay: i * 0.08 },
  }),
};

const FEATURES = [
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

export default function HomePage() {
  return (
    <main className="relative flex min-h-screen flex-col items-center overflow-hidden bg-background">
      {/* Ambient background glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 flex justify-center"
      >
        <div className="mt-[-120px] h-[700px] w-[700px] rounded-full bg-foreground/[0.035] blur-[160px]" />
      </div>

      {/* Nav */}
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
            className="flex h-8 items-center rounded-lg px-3.5 text-[13px] font-medium text-foreground transition-colors hover:bg-surface-2"
          >
            注册
          </Link>
          <Link
            href="/login"
            className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-3.5 text-[13px] font-medium text-foreground transition-colors hover:bg-surface-2"
          >
            登录
            <ArrowRight size={13} strokeWidth={1.5} />
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="relative z-10 mt-24 flex w-full max-w-3xl flex-col items-center px-6 text-center">
        <motion.div
          custom={0}
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          className="mb-3 text-3xl leading-none"
          aria-hidden="true"
        >
          🫴
        </motion.div>
        <motion.p
          custom={1}
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          className="mb-4 font-mono text-[11px] uppercase tracking-[0.18em] text-text-faint"
        >
          你的创作工作台
        </motion.p>

        <motion.h1
          custom={2}
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          className="text-[clamp(2.4rem,6vw,4rem)] font-semibold leading-[1.1] tracking-[-0.03em] text-foreground"
        >
          稳稳地接住<span className="text-info">你的设计</span>
        </motion.h1>

        <motion.p
          custom={3}
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          className="mt-5 max-w-lg text-[17px] leading-relaxed text-text-faint"
        >
          初稿帮你把想法变成可用内容。从灵感到成稿，一站完成。
        </motion.p>

        <motion.div
          custom={4}
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          className="mt-8 flex flex-wrap items-center justify-center gap-3"
        >
          <Link
            href="/register"
            className="flex h-10 items-center gap-2 rounded-lg bg-info px-5 text-[14px] font-medium text-white shadow-[var(--shadow-sm)] transition-colors hover:bg-info/90"
          >
            免费注册
            <ArrowRight size={14} strokeWidth={1.5} />
          </Link>
        </motion.div>
      </section>

      {/* Features grid */}
      <section
        id="features"
        className="relative z-10 mt-28 w-full max-w-4xl px-6 pb-24"
      >
        <motion.p
          custom={5}
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          className="mb-10 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-text-faint"
        >
          核心能力
        </motion.p>

        <div className="grid gap-4 sm:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, desc }, i) => (
            <motion.div
              key={title}
              custom={6 + i}
              variants={fadeUp}
              initial="hidden"
              animate="visible"
              className="group relative rounded-2xl border border-border bg-surface p-6 transition-colors hover:border-border-strong"
            >
              <div className="mb-4 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-background">
                <Icon size={16} strokeWidth={1.5} className="text-foreground" />
              </div>
              <h3 className="mb-2 text-[15px] font-semibold text-foreground">
                {title}
              </h3>
              <p className="text-[13px] leading-relaxed text-text-faint">
                {desc}
              </p>
              {/* Hover accent line */}
              <div className="absolute inset-x-6 bottom-0 h-px scale-x-0 bg-foreground transition-transform duration-300 group-hover:scale-x-100" />
            </motion.div>
          ))}
        </div>
      </section>
    </main>
  );
}
