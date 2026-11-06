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
      className="mx-auto w-full max-w-[52rem] pb-6 pt-2 sm:pt-3"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-xs font-medium text-text-muted">灵感起点</h2>
        <Link
          href="/app/inspiration"
          className="inline-flex min-h-8 items-center gap-1.5 text-xs text-text-muted transition-colors hover:text-foreground"
        >
          灵感圈 <ArrowUpRight size={13} />
        </Link>
      </div>
      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        {starters.map((starter) => (
          <button
            key={starter.title}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(starter.prompt)}
            aria-label={`使用${starter.title}提示词`}
            title={`使用${starter.title}提示词`}
            className="studio-starter group min-w-0 overflow-hidden text-left disabled:cursor-not-allowed disabled:opacity-50"
          >
            <div className="aspect-[2/1] overflow-hidden bg-surface-2">
              {/* Local photography references, not generated-output claims. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={starter.image}
                alt={starter.alt}
                width={720}
                height={420}
                className="h-full w-full object-cover"
              />
            </div>
            <div className="flex min-w-0 items-center justify-between gap-2 px-2.5 py-3 sm:px-3.5">
              <div className="min-w-0">
                <p className="text-xs font-medium leading-5 text-foreground sm:text-[13px]">
                  {starter.title}
                </p>
                <p className="mt-0.5 hidden text-[11px] text-text-faint sm:block">
                  {starter.detail}
                </p>
              </div>
              <ArrowRight
                size={15}
                className="hidden shrink-0 text-text-faint transition-colors group-hover:text-foreground sm:block"
              />
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
