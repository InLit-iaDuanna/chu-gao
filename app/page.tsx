import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { headers } from "next/headers";

import { ProductPreview } from "@/components/marketing/ProductPreview";
import { Logo } from "@/components/shared/Logo";
import { WishPoolPage } from "@/components/wish-pool/WishPoolPage";

// 纯静态内容 → 服务端组件。入场动画走 CSS（.anim-rise，见 globals.css）。
function stagger(i: number): React.CSSProperties {
  return { "--stagger": i } as React.CSSProperties;
}

const FEATURES = [
  {
    id: "01",
    title: "边聊边画",
    desc: "像和同学讨论一样描述想法，Agent 帮你把模糊的方向说清楚，再交给图像模型。",
  },
  {
    id: "02",
    title: "一条线程，反复修改",
    desc: "“再暗一点”“换成竖版”，在同一段对话里持续精修，每一版都留着。",
  },
  {
    id: "03",
    title: "主流模型，一处使用",
    desc: "统一接入海外主流图像与语言模型，通道自动回退，不用来回切换工具。",
  },
  {
    id: "04",
    title: "从提纲到整套 PPT",
    desc: "给出提纲，逐页配图自动生成，可直接导出成品。",
  },
] as const;

/** One picture, three rounds of the same conversation. */
const ITERATIONS = [
  {
    id: "v1",
    prompt: "“仰拍几栋玻璃高楼，阴天。”",
    look: "object-[18%_50%] grayscale contrast-[0.8] brightness-[1.12]",
  },
  {
    id: "v2",
    prompt: "“对称一点，让楼顶在画面中间汇合。”",
    look: "object-center grayscale contrast-[1.15]",
  },
  {
    id: "v3",
    prompt: "“保留冷灰，只让窗里透一点暖光。”",
    look: "object-center",
  },
] as const;

export default async function HomePage(): Promise<React.ReactElement> {
  const host = (await headers()).get("host")?.split(":")[0].toLowerCase();
  if (host === "iwish.chugao.art") {
    return <WishPoolPage />;
  }

  return (
    <main className="min-h-screen overflow-x-clip bg-background text-foreground">
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-[1240px] items-center justify-between px-5 sm:px-8">
          <Logo />
          <nav className="flex items-center gap-1.5">
            <Link
              href="/inspiration"
              className="hidden h-9 items-center rounded-lg px-3 text-sm text-text-muted transition-colors hover:text-foreground sm:flex"
            >
              灵感圈
            </Link>
            <Link
              href="/login"
              className="flex h-9 items-center rounded-lg px-3 text-sm text-text-muted transition-colors hover:text-foreground"
            >
              登录
            </Link>
            <Link href="/register" className="marketing-cta marketing-cta-primary marketing-cta-sm">
              免费开始
            </Link>
          </nav>
        </div>
      </header>

      {/* ─── Hero ─────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-[1240px] px-5 pt-20 text-center sm:px-8 sm:pt-28 lg:pt-32">
        <p
          className="anim-rise mx-auto w-fit rounded-full border border-border px-3.5 py-1 text-[13px] text-text-muted"
          style={stagger(0)}
        >
          为设计学生打造的图像生成工作台
        </p>
        <h1
          className="anim-rise mt-8 text-[clamp(3.25rem,9.5vw,8.5rem)] font-semibold leading-[1.06] tracking-[-0.055em]"
          style={stagger(1)}
        >
          稳稳地接住🫴
          <br />
          <span className="text-text-faint">你的设计</span>
        </h1>
        <p
          className="anim-rise mx-auto mt-9 max-w-[34rem] text-[17px] leading-8 text-text-muted sm:text-lg"
          style={stagger(2)}
        >
          一次对话、多轮迭代，从模糊想法到可用画面，一站完成。
        </p>
        <div
          className="anim-rise mt-10 flex flex-wrap items-center justify-center gap-3"
          style={stagger(3)}
        >
          <Link href="/register" className="marketing-cta marketing-cta-primary">
            免费开始
            <ArrowRight size={16} aria-hidden />
          </Link>
          <Link href="/login" className="marketing-cta marketing-cta-quiet">
            已有账号登录
          </Link>
        </div>
        <p className="anim-rise mt-5 text-[13px] text-text-faint" style={stagger(4)}>
          注册即送初始额度，无需信用卡
        </p>

        <div className="anim-rise relative mx-auto mt-20 max-w-[1040px] sm:mt-24" style={stagger(4)}>
          <div aria-hidden className="marketing-halo" />
          <ProductPreview className="relative text-left" />
        </div>
      </section>

      {/* ─── 一句话到一张图 ───────────────────────────────── */}
      <section className="mx-auto w-full max-w-[1240px] px-5 pt-32 sm:px-8 lg:pt-44">
        <div className="grid items-end gap-6 lg:grid-cols-[1fr_auto]">
          <h2 className="marketing-display">
            说清楚想要什么，
            <br />
            <span className="text-text-faint">剩下的交给它。</span>
          </h2>
          <p className="max-w-[22rem] text-[15px] leading-7 text-text-muted">
            每一张图都从一句话开始。你负责判断好不好，它负责一遍遍改到对。
          </p>
        </div>

        <ol className="mt-12 grid grid-cols-3 gap-x-2.5 sm:mt-16 sm:gap-x-5">
          {ITERATIONS.map((step, i) => (
            <li key={step.id} className="group">
              <div className="relative aspect-[4/5] overflow-hidden rounded-[12px] bg-surface-2 sm:rounded-[18px]">
                <Image
                  src="/studio/architecture.jpg"
                  alt={i === ITERATIONS.length - 1 ? "仰拍的玻璃幕墙高楼群，阴天" : ""}
                  fill
                  sizes="(min-width: 1240px) 400px, 33vw"
                  className={`object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03] ${step.look}`}
                />
              </div>
              <div className="mt-3 flex flex-col gap-1 sm:mt-5 sm:flex-row sm:items-baseline sm:gap-4">
                <span className="font-mono text-xs text-text-faint">{step.id}</span>
                <p className="text-xs leading-5 text-text-muted sm:text-[15px] sm:leading-7">{step.prompt}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* ─── 能力 ─────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-[1240px] px-5 pt-32 sm:px-8 lg:pt-44">
        <h2 className="marketing-display">把力气留给设计本身</h2>
        <div className="mt-16 grid gap-x-10 gap-y-14 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((feature) => (
            <div key={feature.id} className="border-t border-foreground/80 pt-6">
              <p className="font-mono text-xs text-text-faint">{feature.id}</p>
              <h3 className="mt-6 text-lg font-semibold tracking-[-0.015em]">{feature.title}</h3>
              <p className="mt-3 text-[15px] leading-7 text-text-muted">{feature.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ─── 收尾 ─────────────────────────────────────────── */}
      <section className="px-3 pb-3 pt-32 sm:px-4 sm:pb-4 lg:pt-44">
        <div className="marketing-inverse relative overflow-hidden rounded-[28px] px-6 pb-10 pt-20 sm:px-12 sm:pt-28">
          <div className="mx-auto flex max-w-[1180px] flex-col gap-10 lg:flex-row lg:items-end lg:justify-between">
            <h2 className="marketing-display text-[#f4f4f5]">
              下一张图，
              <br />
              从一句话开始。
            </h2>
            <Link href="/register" className="marketing-cta marketing-cta-light w-fit">
              免费开始
              <ArrowRight size={16} aria-hidden />
            </Link>
          </div>
          <p aria-hidden className="marketing-wordmark">
            Chūgǎo
          </p>
          <div className="mx-auto flex max-w-[1180px] items-center justify-between border-t border-white/12 pt-6 text-xs text-white/45">
            <span>© 2026 Chūgǎo Studio</span>
            <span className="flex gap-5">
              <Link href="/inspiration" className="hover:text-white/80">
                灵感圈
              </Link>
              <Link href="/login" className="hover:text-white/80">
                登录
              </Link>
            </span>
          </div>
        </div>
      </section>
    </main>
  );
}
