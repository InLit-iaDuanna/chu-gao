import { AccountMenu } from "@/components/shared/AccountMenu";
import { ThemeToggle } from "@/components/shared/ThemeToggle";

interface AppPageShellProps {
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  /** 宽版内容（如生成详情双栏）。 */
  wide?: boolean;
}

/** 用户端非工作台页面的统一骨架：细顶栏 + 内部滚动内容区。 */
export function AppPageShell({
  title,
  actions,
  children,
  wide = false,
}: AppPageShellProps): React.ReactElement {
  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
        <h1 className="truncate text-[13px] font-medium text-foreground">
          {title}
        </h1>
        <div className="flex items-center gap-1">
          {actions}
          <ThemeToggle />
          <AccountMenu compact />
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div
          className={
            wide
              ? "mx-auto w-full max-w-7xl px-4 py-6 sm:px-6"
              : "mx-auto w-full max-w-6xl px-4 py-6 sm:px-6"
          }
        >
          {children}
        </div>
      </div>
    </div>
  );
}
