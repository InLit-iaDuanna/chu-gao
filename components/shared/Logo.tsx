import { cn } from "@/lib/utils";

interface LogoProps {
  size?: "sm" | "md";
  className?: string;
}

/**
 * 初稿 Logo — 喜茶式极简字标
 * md: 汉字「初稿」+ 小号拼音「Chūgǎo」竖向叠排
 * sm: 仅显示汉字「初」字方块
 */
export function Logo({
  size = "md",
  className,
}: LogoProps): React.ReactElement {
  const compact = size === "sm";

  return (
    <div className={cn("flex min-w-0 shrink-0 items-center", className)}>
      {compact ? (
        /* 紧凑版：单字方块 */
        <span
          aria-label="初稿"
          className="inline-flex h-7 w-7 items-center justify-center rounded-[5px] bg-foreground text-[13px] font-bold leading-none text-background"
          style={{ fontFamily: "var(--font-stack-sans)", letterSpacing: 0 }}
        >
          初
        </span>
      ) : (
        /* 标准版：字标 */
        <span
          aria-label="初稿 Chūgǎo"
          className="logo-wordmark inline-flex flex-col items-start leading-none"
        >
          <span
            className="logo-hanzi block text-[17px] font-semibold tracking-[0.05em] text-foreground"
            style={{ fontFamily: "var(--font-stack-sans)" }}
          >
            初稿
          </span>
          <span
            className="logo-pinyin block text-[8.5px] font-normal tracking-[0.22em] text-text-muted"
            style={{ fontFamily: "var(--font-stack-sans)", marginTop: "1px" }}
          >
            CHŪGǍO
          </span>
        </span>
      )}
    </div>
  );
}
