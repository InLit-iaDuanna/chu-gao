import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Logo } from "@/components/shared/Logo";

const CAPABILITIES = [
  {
    title: "对话式生成",
    description:
      "连续描述、补充和修改，系统会把上下文整理成适合 image2 的出图指令。",
  },
  {
    title: "1K / 2K / 4K",
    description: "用页面尺度表达输出规格，适合课程作业、排版测试和最终打样。",
  },
  {
    title: "视觉档案",
    description: "每次生成都沉淀到对话和画廊，方便继续编辑、回看和复用。",
  },
];

export default function MarketingPage() {
  return (
    <main className="page-shell flex min-h-screen flex-col justify-between py-8">
      <header className="flex items-center justify-between gap-4">
        <Logo />
        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="font-mono text-xs uppercase tracking-[0.12em] text-text-muted transition-colors hover:text-foreground"
          >
            登录
          </Link>
          <Link href="/app" className="tool-button h-9 text-text-muted">
            进入工作台
            <ArrowRight className="h-4 w-4 stroke-[1.5]" />
          </Link>
        </div>
      </header>

      <section className="py-20 lg:py-28">
        <div className="max-w-6xl">
          <p className="eyebrow">AI 图像生成工具</p>
          <h1 className="mt-6 max-w-5xl text-[48px] leading-[1.03] sm:text-[72px] lg:text-[96px]">
            稳稳地🫴接住你的设计
          </h1>
          <p className="mt-8 max-w-2xl text-base leading-8 text-text-muted sm:text-lg">
            祝你设计愉快：）
          </p>
        </div>

        <div className="mt-16 divide-y divide-border border-y border-border">
          {CAPABILITIES.map((item) => (
            <div
              key={item.title}
              className="grid gap-3 py-5 md:grid-cols-[220px_minmax(0,1fr)]"
            >
              <h2 className="font-sans text-lg font-medium leading-snug">
                {item.title}
              </h2>
              <p className="max-w-2xl text-sm leading-6 text-text-muted">
                {item.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      <footer className="flex items-center justify-between border-t border-border pt-6 font-mono text-xs uppercase tracking-[0.12em] text-text-faint">
        <span>Chūgǎo Studio</span>
        <span>image2 · 中文工作流</span>
      </footer>
    </main>
  );
}
