export function researchSourceText(content: string) {
  // Images remain in evidence storage; encoded file payloads are not text evidence.
  return content.replace(
    /data:[a-z0-9.+-]+\/[a-z0-9.+-]+(?:;[a-z0-9=.+-]+)*;base64,[a-z0-9+/=]+/gi,
    "[内嵌文件已留档]",
  );
}

export interface ResearchTextBlock {
  /** UTF-16 offsets in researchSourceText(body), never in a rewritten string. */
  start: number;
  end: number;
  section: number;
  kind: "heading" | "paragraph" | "table" | "disclosure";
  searchText: string;
}

/** Only used for ranking. The evidence output always uses the original ranges. */
export function researchSearchText(text: string) {
  return text
    .replace(/!\[[^\]\n]*\]\([^\n]*?\)/g, "")
    .replace(/\[([^\]\n]*)\]\([^\s)]*(?:\s+"[^"]*")?\)/g, "$1")
    .replace(/https?:\/\/[^\s)>]+/g, "")
    .replace(/[*_`>#|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isResearchDisclosure(text: string) {
  return /(?:商品|产品|样品).{0,35}(?:由.{0,20}提供|免费提供|赠送)|(?:提供|获赠).{0,25}(?:样品|产品).{0,30}(?:评测|评价)|(?:邀请|受邀).{0,30}(?:评测|撰写)|赞助|利益冲突|付费合作|广告声明|sponsor(?:ed|ship)?|(?:product|sample).{0,35}(?:provided|supplied|gifted)|(?:provided|received).{0,35}(?:free|review)|conflicts? of interest|affiliate|funding\s*:/i.test(
    researchSearchText(text),
  );
}

/**
 * Keep complete paragraphs, steps and table rows. Image/link-only navigation is
 * left in the archive, not in the model's scarce text allowance. No DOM or
 * content is synthesized here: every block points into the retained text.
 */
export function researchTextBlocks(
  content: string,
  options: { userProvided?: boolean } = {},
): ResearchTextBlock[] {
  const blocks: ResearchTextBlock[] = [];
  let section = 0;
  let inRelated = false;
  let offset = 0;
  for (const rawLine of content.split(/(?<=\n)/)) {
    const start = offset;
    offset += rawLine.length;
    const line = rawLine.replace(/[\r\n]+$/, "");
    const trimmed = line.trim();
    if (!trimmed) continue;
    const heading = /^\s*#{1,6}\s+(.+)/.exec(line);
    if (heading) {
      section++;
      inRelated =
        /^(?:相关文章推荐|相关文章|更多推荐|猜你喜欢|相关内容|相关产品|related (?:articles|posts|products)|recommended (?:articles|products))(?:$|\s|[:：])/i.test(
          heading[1],
        );
    }
    if (inRelated && !options.userProvided) continue;
    if (/^\s*(?:\[?!)\[/.test(line)) continue;
    const searchText = researchSearchText(line);
    if (!searchText || /^[\s:|\-_=+()[\]]+$/.test(searchText)) continue;
    const isLinkList =
      /^\s*(?:[-*+]\s+)?\[/.test(line) &&
      (line.match(/\]\(/g)?.length ?? 0) > 0;
    if (
      !options.userProvided &&
      isLinkList &&
      (searchText.length < 35 || (line.match(/\]\(/g)?.length ?? 0) > 3)
    )
      continue;
    // A disclosure inside a table belongs to the same indivisible table.
    const kind: ResearchTextBlock["kind"] = /^\s*\|/.test(line)
      ? "table"
      : isResearchDisclosure(line)
        ? "disclosure"
        : heading
          ? "heading"
          : "paragraph";
    // Extremely long scraped lines are split at sentence ends when possible.
    // This also keeps a long navigation paragraph from displacing a later fact.
    let partStart = 0;
    while (partStart < line.length) {
      let partEnd = Math.min(line.length, partStart + 1600);
      if (partEnd < line.length) {
        const segment = line.slice(partStart, partEnd);
        const boundaries = [
          ...segment.matchAll(/[。！？；.!?;](?:\s|$)|[。！？；]/g),
        ];
        const boundary = boundaries.at(-1);
        if (boundary && boundary.index > 400)
          partEnd = partStart + boundary.index + boundary[0].length;
        if (/[\uD800-\uDBFF]/.test(line[partEnd - 1] ?? "")) partEnd--;
      }
      const part = line.slice(partStart, partEnd);
      blocks.push({
        start: start + partStart,
        end: start + partEnd,
        section,
        kind,
        searchText: researchSearchText(part),
      });
      partStart = partEnd;
    }
  }
  const grouped: ResearchTextBlock[] = [];
  for (const block of blocks) {
    const previous = grouped.at(-1);
    if (
      previous?.kind === "table" &&
      block.kind === "table" &&
      previous.section === block.section &&
      /^[\s|:-]*$/.test(content.slice(previous.end, block.start))
    ) {
      previous.end = block.end;
      previous.searchText += " " + block.searchText;
    } else grouped.push({ ...block });
  }
  return grouped;
}
