"use client";

import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";

const starters = [
  {
    title: "建筑与空间",
    detail: "结构 · 材质 · 光影",
    image: "/studio/architecture.jpg",
    alt: "仰视玻璃幕墙建筑的对称构图",
    prompt:
      "现代建筑摄影，仰视构图，清晰的几何结构与玻璃幕墙，天空映射在立面上，克制的冷灰色调，自然光，真实的材质细节。",
  },
  {
    title: "产品与静物",
    detail: "质感 · 构图 · 色彩",
    image: "/studio/product.jpg",
    alt: "浅蓝色背景中的玻璃香水瓶特写",
    prompt:
      "一张香水产品静物摄影，透明玻璃瓶与浅琥珀色液体，浅蓝色纯净背景，正面构图，柔和的棚拍光线，细腻的玻璃折射，极简排版，不添加文字。",
  },
  {
    title: "自然与风景",
    detail: "山野 · 水面 · 氛围",
    image: "/studio/landscape.jpg",
    alt: "群山与森林环绕的湖面和木屋",
    prompt:
      "高山湖泊风景摄影，远处的山峰被薄雾环绕，深绿色森林倒映在平静的湖面，岸边一座朴素木屋，自然柔和的晨光，开阔构图，真实细节。",
  },
];

export function CreationStarters({
  onSelect,
  disabled,
}: {
  onSelect: (prompt: string) => void;
  disabled: boolean;
}) {
  return (
    <section
      aria-label="创作灵感"
      className="mx-auto w-full max-w-[52rem] pb-6 pt-3 tracking-normal"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-xs font-medium text-text-muted">灵感起点</h2>
        <Link
          href="/app/inspiration"
          className="inline-flex min-h-11 items-center gap-2 rounded-md px-2 text-sm text-text-muted transition-colors hover:bg-surface-2 hover:text-foreground sm:min-h-9"
        >
          灵感圈 <ArrowUpRight size={13} />
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {starters.map((starter) => (
          <button
            key={starter.title}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(starter.prompt)}
            aria-label={`使用${starter.title}提示词`}
            title={`使用${starter.title}提示词`}
            className="group flex min-w-0 overflow-hidden rounded-lg border border-border bg-surface text-left transition-colors hover:border-border-strong hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50 sm:flex-col"
          >
            <div className="aspect-square w-20 shrink-0 overflow-hidden bg-surface-2 sm:aspect-[2/1] sm:w-full">
              {/* Local photography references, not generated-output claims. */}
              <img
                src={starter.image}
                alt={starter.alt}
                width={720}
                height={420}
                className="h-full w-full object-cover"
              />
            </div>
            <div className="flex w-full min-w-0 items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium leading-5 text-foreground">
                  {starter.title}
                </p>
                <p className="mt-1 text-xs leading-5 text-text-muted">
                  {starter.detail}
                </p>
              </div>
              <ArrowRight
                size={15}
                className="shrink-0 text-text-muted transition-colors group-hover:text-foreground"
              />
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
