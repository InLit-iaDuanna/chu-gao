/**
 * 协议链接：站内公开页面，用新窗口打开，安卓壳会把它放进内置浏览器
 * （target=_blank 由 WebView 的 shouldOverrideUrlLoading 处理）。
 */
export function LegalLinks({
  className,
  separator,
}: {
  className?: string;
  separator?: string;
}): React.ReactElement {
  const linkClass =
    "text-foreground underline decoration-[rgb(var(--border-strong))] underline-offset-2 transition-colors hover:decoration-foreground";

  return (
    <span className={className}>
      <a
        href="/legal/terms"
        target="_blank"
        rel="noreferrer"
        className={linkClass}
      >
        《用户协议》
      </a>
      {separator ? <span className="text-text-faint">{separator}</span> : null}
      <a
        href="/legal/privacy"
        target="_blank"
        rel="noreferrer"
        className={linkClass}
      >
        《隐私政策》
      </a>
    </span>
  );
}
