export function chatTimeInstruction() {
  return `当前北京时间（Asia/Shanghai）：${new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    dateStyle: "full",
    timeStyle: "short",
    hour12: false,
  }).format(
    new Date(),
  )}。涉及今天、昨天等相对日期时以此为准；用户指定其他时区时按其时区换算，不要声称无法获知当前日期。`;
}

export function chatSystemInstructions(
  base: string,
  webSearch = false,
  includeTime = true,
): string {
  return [
    base,
    includeTime ? chatTimeInstruction() : "",
    "回答可使用 Markdown 标题、表格、列表和带语言标记的代码块。生成完整 HTML 文档时使用 html 代码块，将 CSS 写在文档内，不依赖外部 CDN，以便直接预览。",
    webSearch
      ? "本轮已启用联网工具。使用实际检索结果回答并标注来源，不编造来源链接。"
      : "本轮未启用联网工具，不要声称已联网搜索或查阅了最新资料。",
  ]
    .filter(Boolean)
    .join("\n\n");
}
