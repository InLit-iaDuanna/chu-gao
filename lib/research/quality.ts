import { createHash } from "node:crypto";
import {
  validateResearchEvidenceHandoff,
  type EvidenceHandoffRange,
  type ResearchEvidenceHandoff,
} from "./evidence-handoff";
import {
  researchSearchText,
  researchSourceText,
  researchTextBlocks,
  type ResearchTextBlock,
} from "./source-text";

/**
 * These are deterministic triage rules, NOT semantic fact verification. The score
 * measures a lexical match and a few document-shape signals. It is not a
 * probability, source authority score, or reason to invent a missing fact.
 * Keep rejected candidates in the evidence archive with their reasons.
 */
export interface QualityBrief {
  question: string;
  market?: string;
  audience?: string;
  constraints?: string;
  timeRange?: string;
  competitors?: readonly string[];
  links?: readonly string[];
}

export type SourceKind =
  | "product"
  | "manual"
  | "study"
  | "review"
  | "news"
  | "aggregator"
  | "directory"
  | "corpus"
  | "feed"
  | "fiction"
  | "unknown";

export interface SearchCandidate {
  url: string;
  title?: string | null;
  excerpt?: string | null;
  /** Retained body, when available. Search snippets must not be put here. */
  content?: string | null;
}

export type EvidenceDecisionRole =
  | "product_identity"
  | "task_observation"
  | "constraint"
  | "alternative"
  | "background"
  | "design_reference"
  | "irrelevant";

/** A routing judgment is not a verified claim or source-authority judgment. */
export interface EvidenceDecisionRoute {
  evidenceId: string;
  /** Bind reviewed content to its retained version; null denotes no body hash. */
  contentHash?: string | null;
  role: EvidenceDecisionRole;
  decisionIds: string[];
  reason: string;
}

export interface EvidenceRouting {
  method: "heuristic" | "model_review";
  /** A model review keeps its source version across the runtime boundary. */
  contentHash?: string | null;
  role: EvidenceDecisionRole | "pending";
  decisionIds: string[];
  reason: string;
}

export interface CandidateAssessment {
  schemaVersion: 1;
  decision: "keep" | "review" | "reject";
  score: number;
  scoreMeaning: "lexical_triage_only";
  sourceKind: SourceKind;
  authority: "unverified";
  explicitUserSource: boolean;
  matchedTerms: string[];
  reasons: string[];
  routing?: EvidenceRouting;
}

const STOP_WORDS = new Set(
  (
    "围绕 面向 研究 调研 设计 开发 制作 做 一个 一款 一种 希望 需要 确定 明确 进一步 " +
    "优先 重点 已确认 待确认 建议 确认 目标 核心 关键 场景 人群 用户 功能 产品 定位 " +
    "机会 需求 使用 使用场景 使用流程 等 进而 以及 如何 哪些 相关 信息 分析 评估 " +
    "可接受 时间 范围 价格 市场 question market audience constraints timerange " +
    "the a an of to for in with and or is are we i this that research design " +
    "develop create make product products study market audience about how what " +
    "quick 快速 流程 竞品 核对 当前 适用性 中的 用于 适合 主要 具有 支持 " +
    "通过 进行 提供 实际 不同 需要的 现有 可能 目前 必须 应该 应当 是否 什么 以及其"
  ).split(/\s+/),
);

const segmenter = new Intl.Segmenter("zh", { granularity: "word" });
const GENERIC_OBJECT_TERMS = new Set([
  "设备",
  "产品",
  "系统",
  "平台",
  "服务",
  "市场",
  "行业",
  "品牌",
  "工具",
  "device",
  "devices",
  "equipment",
  "product",
  "products",
  "system",
  "platform",
  "service",
]);

function normalText(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/\s+/g, " ")
    .trim();
}

function terms(value: string, limit = 32): string[] {
  const words = [...segmenter.segment(normalText(value))].filter(
    (part) => part.isWordLike,
  );
  // ICU can split a Chinese product noun into a word + a one-character suffix.
  // Joining these preserves text present in the brief; it adds no new category.
  const joined: string[] = [];
  for (let i = 0; i < words.length; i++) {
    let word = words[i].segment;
    const functionChar = (value: string) =>
      /^[的和与或及于在也为对从等将把被由是到所而各每了有着以若如但并不]$/.test(
        value,
      );
    if (/^\p{Script=Han}$/u.test(word) && !functionChar(word)) {
      // Small ICU dictionaries may split 控卡/轻食机 into single characters.
      // Rejoin contiguous Han runs, stopping at grammatical words/punctuation.
      while (
        words[i + 1] &&
        /^\p{Script=Han}$/u.test(words[i + 1].segment) &&
        !functionChar(words[i + 1].segment) &&
        words[i + 1].index === words[i].index + words[i].segment.length
      ) {
        word += words[++i].segment;
      }
    }
    if (
      word.length >= 2 &&
      /^(机|器|箱|杯|架|壶|盒|柜|灯|桌|椅|室|锅|包)$/.test(
        words[i + 1]?.segment ?? "",
      ) &&
      words[i + 1].index === words[i].index + words[i].segment.length
    ) {
      word += words[++i].segment;
    }
    joined.push(word);
  }
  return [
    ...new Set(
      joined.filter(
        (word) =>
          word.length >= 2 && !STOP_WORDS.has(word) && !/^\d+$/.test(word),
      ),
    ),
  ].slice(0, limit);
}

function briefTerms(brief: QualityBrief, focus?: string) {
  return [
    ...new Set([
      ...terms(focus ?? "", 16),
      ...terms(brief.question, 24),
      ...terms(brief.market ?? "", 8),
      ...terms(brief.audience ?? "", 8),
      ...terms((brief.competitors ?? []).join(" "), 12),
      ...terms(brief.constraints ?? "", 12),
    ]),
  ].slice(0, 40);
}

function compactWords(words: readonly string[], maxChars: number) {
  let result = "";
  for (const word of words) {
    const next = result ? `${result} ${word}` : word;
    if (next.length > maxChars) break;
    result = next;
  }
  return result;
}

function subject(brief: QualityBrief) {
  const words = terms(brief.question, 28);
  const nouns = words.filter(
    (word) =>
      !GENERIC_OBJECT_TERMS.has(word) &&
      /(?:机|器|箱|杯|架|壶|盒|柜|灯|桌|椅|包|锅|软件|平台|系统|服务)$/.test(
        word,
      ),
  );
  const clauses = brief.question
    .split(/[，,。；;\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
  const target =
    clauses.find((part) => nouns.some((noun) => part.includes(noun))) ??
    clauses.find((part) => /设备|工具|软件|平台|系统|服务/.test(part)) ??
    clauses[0] ??
    brief.question;
  let phrase = target
    .replace(/^为.+?(?:设计|开发|研究|比较)/, "")
    .replace(/^(?:(?:研究|调研|设计|开发|比较|分析|围绕|关于|探索)\s*)+/u, "")
    .replace(/^(?:面向|针对).+?的(?=.+(?:机|器|包|椅|设备|工具))/, "")
    .replace(
      /^(?:research|design|develop|compare|study|explore)\s+(?:a\s+|an\s+|the\s+)?/i,
      "",
    )
    .replace(/(?:市场|市场研究|市场调研)$/, "")
    .trim();
  const market = (brief.market ?? "").trim();
  if (market && phrase.startsWith(market) && phrase.length > market.length)
    phrase = phrase.slice(market.length).trim();
  // Preserve the actual compound phrase (e.g. a modifier + 设备), instead of
  // treating the first ICU word or a generic industry noun as the whole object.
  return (
    phrase.slice(0, 96) ||
    compactWords(nouns.length ? nouns : words, 96) ||
    brief.question.trim().slice(0, 96)
  );
}

export interface SearchQueryPlan {
  id: string;
  purpose:
    | "identify_products"
    | "compare_alternatives"
    | "understand_use"
    | "test_constraints"
    | "named_competitor";
  query: string;
  question: string;
  provenance: "heuristic";
}

/** A bounded starting plan; an engine should refine it when results are poor. */
export function buildSearchQueries(
  brief: QualityBrief,
  options: { maxQueries?: number } = {},
): SearchQueryPlan[] {
  const core = subject(brief);
  const english = !/\p{Script=Han}/u.test(brief.question);
  const named = (brief.competitors ?? [])
    .map((name) => name.trim().replace(/\s+/g, " ").slice(0, 96))
    .filter(Boolean);
  const primary = named[0] ?? core;
  const market = (brief.market ?? "").trim().replace(/\s+/g, " ");
  const contextWords =
    market && !primary.includes(market) ? [market.slice(0, 64)] : [];
  const audienceWords = terms(brief.audience ?? "", 10)
    .filter(
      (word) =>
        !primary.includes(word) &&
        !contextWords.some((part) => part.includes(word)),
    )
    .slice(0, 2);
  const bases = [
    compactWords([primary, ...contextWords], 125),
    named.length > 1
      ? compactWords([...named.slice(0, 2), ...contextWords], 125)
      : compactWords([primary, ...contextWords], 125),
    compactWords([primary, ...contextWords, ...audienceWords], 125),
    compactWords([primary, ...contextWords, ...audienceWords], 125),
  ];
  const suffixes = english
    ? [
        "specifications manual",
        "alternatives comparison",
        "use experience review",
        "limitations user feedback",
      ]
    : ["参数 说明书", "替代方案 对比", "使用体验 评测", "限制 用户反馈"];
  const purposes: SearchQueryPlan["purpose"][] = [
    "identify_products",
    "compare_alternatives",
    "understand_use",
    "test_constraints",
  ];
  const questions = [
    "寻找可识别的产品型号与原始参数；搜索命中不等于事实已核验。",
    "比较完成同一任务的不同路径，避免预设唯一产品路线。",
    "寻找实际操作、清洁与使用限制的材料。",
    "查找与用户约束有关的反例和限制；不把建议当成已确认需求。",
  ];
  const planned = purposes.map((purpose, i) => ({
    id: `query_${i + 1}`,
    purpose,
    query: `${bases[i]} ${suffixes[i]}`.slice(0, 160),
    question: questions[i],
    provenance: "heuristic" as const,
  }));
  for (const competitor of (brief.competitors ?? []).slice(0, 3)) {
    if (!competitor.trim()) continue;
    planned.push({
      id: `query_${planned.length + 1}`,
      purpose: "named_competitor",
      query: `${compactWords([competitor.trim().replace(/\s+/g, " ").slice(0, 96), ...contextWords], 125)} ${suffixes[0]}`,
      question:
        "核对用户指定竞品的身份、型号和参数；品牌主页不能替代型号证据。",
      provenance: "heuristic",
    });
  }
  const count = Math.max(1, Math.min(8, Math.floor(options.maxQueries ?? 6)));
  return planned.slice(0, count);
}

/** Preserve normal short search syntax; never send the entire project brief as q. */
export function normalizeResearchSearchQuery(
  query: string,
  brief: QualityBrief,
) {
  const normalized = query.replace(/\s+/g, " ").trim();
  if (!normalized)
    return { query: "", changed: false, reason: "empty_query" as const };
  const labels =
    normalized.match(
      /(?:问题|目标|市场|人群|受众|约束|限制|竞品|question|audience|constraints|market)\s*[:：]/gi,
    ) ?? [];
  const isBrief =
    labels.length >= 2 ||
    (normalized.length > 160 && normalized.includes(brief.question.trim()));
  if (isBrief)
    return {
      query: buildSearchQueries(brief)[0].query,
      changed: true,
      reason: "brief_detected" as const,
    };
  const marketOnly = (brief.market ?? "").trim().replace(/\s+/g, " ");
  const genericTail =
    /^(?:参数\s+说明书|替代方案\s+对比|使用体验\s+评测|限制\s+用户反馈|specifications\s+manual|alternatives\s+comparison|use\s+experience\s+review|limitations\s+user\s+feedback)$/i;
  const withoutMarket =
    marketOnly && normalized.startsWith(`${marketOnly} `)
      ? normalized.slice(marketOnly.length).trim()
      : normalized;
  if (genericTail.test(withoutMarket))
    return {
      query: buildSearchQueries(brief)[0].query,
      changed: true,
      reason: "missing_subject" as const,
    };
  if (normalized.length <= 180)
    return {
      query: normalized,
      changed: normalized !== query,
      reason: "unchanged" as const,
    };
  // Keep explicit site operators if a framework builds a long focused query.
  const operators =
    normalized
      .match(/(?:^|\s)(?:site|filetype):[^\s]+/gi)
      ?.map((value) => value.trim())
      .slice(0, 2) ?? [];
  const core = subject(brief);
  const anchors = [core, marketOnly].filter(
    (part) => part && normalized.includes(part),
  );
  const compact = compactWords(
    [...new Set([...operators, ...anchors, ...terms(normalized, 12)])],
    150,
  );
  return {
    query: compact || buildSearchQueries(brief)[0].query,
    changed: true,
    reason: "query_compacted" as const,
  };
}

function canonicalUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.hash = "";
    for (const name of [...url.searchParams.keys()]) {
      if (/^(?:utm_|gclid$|fbclid$)/i.test(name)) url.searchParams.delete(name);
    }
    url.searchParams.sort();
    return url.toString();
  } catch {
    return null;
  }
}

function isAttachmentUrl(value: string) {
  return /^attachment:[a-zA-Z0-9_-]{1,120}$/.test(value);
}

/** `provided` is persisted by our attachment intake, not trusted search metadata. */
function isProvidedAttachment(row: {
  status: string;
  url?: string;
  originalUrl?: string;
}) {
  return (
    row.status === "provided" &&
    isAttachmentUrl(row.url ?? row.originalUrl ?? "")
  );
}

function sourceKind(candidate: SearchCandidate): SourceKind {
  let decoded = candidate.url;
  try {
    decoded = decodeURIComponent(candidate.url);
  } catch {
    /* leave invalid escapes visible */
  }
  const metadata = normalText(`${candidate.title ?? ""} ${decoded}`);
  const excerpt = normalText((candidate.excerpt ?? "").slice(0, 1800));
  if (
    /corpus|corpora|词频|词表|词汇表|vocabulary|word[-_ ]?list|hsk[\s._/-]*[0-9]?|chinese-computing|pinyin\.cin|\.ipynb(?:\?|$)/i.test(
      metadata,
    )
  )
    return "corpus";
  if (
    /站点地图|sitemap|热门标签|all articles|\/tags\/?(?:[?#]|$)|\/all\/?(?:[?#]|$)|供应链.*(?:目录|平台)/.test(
      metadata,
    ) ||
    (/供应链|supply chain/.test(metadata) &&
      /交易平台|批发市场|热门标签|supplier directory/.test(excerpt))
  )
    return "directory";
  if (
    /\brss\b|\/feeds?\/|<!\[cdata\[|podcast feed/.test(metadata) ||
    (/\.xml(?:\?|$)/.test(metadata) &&
      /episodic|<rss|<channel|<item|<itunes/.test(excerpt))
  )
    return "feed";
  if (/对话合集|剧情|同人|小说|fanfiction|fictional dialogue/.test(metadata))
    return "fiction";
  if (
    /说明书|使用手册|用户手册|user manual|instruction manual|\/manuals?\//.test(
      metadata,
    )
  )
    return "manual";
  if (
    /商城.*第\d+页|购物商城|\/shops\/.*\/page\/|热点资讯|滚动新闻|\/news\/index\./.test(
      metadata,
    )
  )
    return "aggregator";
  if (
    /白皮书|实验|调查报告|研究报告|systematic review|research paper|arxiv\.org|doi\.org|pubmed\./.test(
      metadata,
    )
  )
    return "study";
  if (
    /评测|测评|使用体验|简单体验|体验报告|实测|test report|hands[- ]on|review/.test(
      metadata,
    )
  )
    return "review";
  if (
    /型号|规格|产品详情|productdetail|\/products?\/|specifications|\bsku\b/.test(
      metadata,
    ) ||
    (/参数|型号|额定功率/.test(excerpt) &&
      /电|机|器|盒|device|appliance/i.test(metadata))
  )
    return "product";
  if (/新闻|news|资讯|报道/.test(metadata)) return "news";
  return "unknown";
}

// Positive vocabulary for common adjacent solutions. These are candidate leads,
// not equivalence claims. A model-reviewed route can admit any other category.
const OBJECT_FAMILIES = [
  [
    "轻食机",
    "三明治机",
    "电饭锅",
    "电饭煲",
    "电热饭盒",
    "加热饭盒",
    "蒸煮饭盒",
    "早餐机",
    "电饼铛",
    "微波炉",
    "sandwich maker",
    "rice cooker",
    "heated lunchbox",
  ],
  ["相机包", "摄影包", "相机背包", "camera bag", "camera backpack"],
  ["办公椅", "人体工学椅", "电脑椅", "office chair", "ergonomic chair"],
];

function sourceSubjectRouting(
  candidate: SearchCandidate,
  brief: QualityBrief,
  focus: string | undefined,
  kind: SourceKind,
): EvidenceRouting {
  const question = normalText(
    `${brief.question} ${(brief.competitors ?? []).join(" ")}`,
  );
  const named = (brief.competitors ?? []).map(normalText);
  const objectWords = terms(question, 40).filter(
    (word) =>
      (!GENERIC_OBJECT_TERMS.has(word) &&
        /(?:机|器|箱|杯|架|壶|盒|柜|灯|椅|包|锅|软件|平台|系统|服务)$/.test(
          word,
        )) ||
      /[a-z].*\d|\d.*[a-z]/i.test(word),
  );
  const allTerms = briefTerms(brief, focus);
  const anchors = [...new Set([...named, ...objectWords])];
  if (!anchors.length) {
    const context = new Set(
      terms(`${brief.market ?? ""} ${brief.audience ?? ""}`),
    );
    anchors.push(
      ...terms(brief.question, 24)
        .filter((word) => !context.has(word) && !GENERIC_OBJECT_TERMS.has(word))
        .slice(0, 6),
    );
  }
  const bodyText = candidate.content
    ? researchTextBlocks(researchSourceText(candidate.content))
        .map((block) => block.searchText)
        .join("\n")
        .slice(0, 18000)
    : "";
  const visible = normalText(
    `${candidate.title ?? ""} ${researchSearchText(candidate.excerpt ?? "")} ${bodyText}`,
  );
  const title = normalText(researchSearchText(candidate.title ?? ""));
  const namedTitleObject = terms(title, 40).some((word) =>
    /(?:机|器|箱|杯|架|壶|盒|柜|灯|椅|包|锅|软件|平台|系统|服务)$/.test(word),
  );
  // A review about an explicitly named different device may merely mention a
  // cooker/bag/chair in passing or in related links. It remains a reviewable
  // lead, but that incidental body match cannot establish the page's object.
  // Generic brand/homepage titles still need their retained body to identify a SKU.
  const bodyMayIdentifyObject =
    !namedTitleObject ||
    /官方|官网|首页|品牌主页|official|home\s?page/.test(title);
  const matchesObject = (word: string) =>
    title.includes(word) || (bodyMayIdentifyObject && visible.includes(word));
  const objectMatch = anchors.some(
    (word) => word.length >= 2 && matchesObject(word),
  );
  const activeFamilies = OBJECT_FAMILIES.filter((family) =>
    family.some((word) => question.includes(word)),
  );
  const alternativeMatch = activeFamilies.some((family) =>
    family.some(matchesObject),
  );
  const focused = focus
    ? terms(focus, 16)
        .filter(
          (word) =>
            /(?:机|器|箱|杯|壶|盒|柜|灯|椅|包|锅)$/.test(word) ||
            /[a-z].*\d|\d.*[a-z]/i.test(word),
        )
        .some(matchesObject)
    : false;
  const websiteExample =
    /网站案例|网页设计|website example|website template|web design case/.test(
      normalText(`${candidate.title ?? ""} ${candidate.url}`),
    );
  const asksWebsite = /网站|网页|web design|website/.test(question);
  let role: EvidenceRouting["role"] = "pending";
  let reason = "尚不能确认来源对哪项产品或用户任务决策有用；需要语义分流。";
  if (websiteExample && !asksWebsite) {
    role = "design_reference";
    reason =
      "页面对象是网站设计示例；仅可作为明确选定的设计参考，不能按场景词当作产品或用户证据。";
  } else if (objectMatch || focused) {
    role =
      kind === "review"
        ? "task_observation"
        : kind === "product" || kind === "manual"
          ? "product_identity"
          : /(?:限制|禁止|风险|注意事项|safety|limitation|constraint)/i.test(
                visible,
              )
            ? "constraint"
            : "task_observation";
    reason =
      "标题或可读正文命中研究对象；属于待审查候选，未验证事实或决策支持关系。";
  } else if (alternativeMatch) {
    role = "alternative";
    reason =
      "命中同一任务的相邻解决方案词汇；保留作替代或反证候选，适用条件仍需审查。";
  } else if (allTerms.some((word) => visible.includes(word))) {
    role = "background";
    reason =
      "仅命中受众、场景或一般约束词，尚未建立与研究对象或具体决策的联系。";
  }
  return { method: "heuristic", role, decisionIds: [], reason };
}

const DECISION_ROLES = new Set<EvidenceDecisionRole>([
  "product_identity",
  "task_observation",
  "constraint",
  "alternative",
]);

export function validateEvidenceDecisionRoutes(
  value: unknown,
  allowedEvidenceIds: Iterable<string>,
  allowedDecisionIds?: Iterable<string>,
): EvidenceDecisionRoute[] {
  if (!Array.isArray(value) || value.length > 200)
    throw new Error("Invalid evidence decision routes");
  const evidenceIds = new Set(allowedEvidenceIds);
  const decisionIds = allowedDecisionIds ? new Set(allowedDecisionIds) : null;
  const seen = new Set<string>();
  const roles = new Set<string>([
    ...DECISION_ROLES,
    "background",
    "design_reference",
    "irrelevant",
  ]);
  return value.map((input) => {
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new Error("Invalid evidence decision route");
    const route = input as Record<string, unknown>;
    if (
      typeof route.evidenceId !== "string" ||
      !evidenceIds.has(route.evidenceId) ||
      seen.has(route.evidenceId)
    )
      throw new Error("Unknown or duplicate routed evidence id");
    if (
      typeof route.role !== "string" ||
      !roles.has(route.role) ||
      typeof route.reason !== "string" ||
      !route.reason.trim() ||
      route.reason.length > 800 ||
      !Array.isArray(route.decisionIds) ||
      route.decisionIds.length > 12 ||
      route.decisionIds.some(
        (id) =>
          typeof id !== "string" ||
          !id ||
          id.length > 100 ||
          (decisionIds && !decisionIds.has(id)),
      ) ||
      new Set(route.decisionIds).size !== route.decisionIds.length ||
      (DECISION_ROLES.has(route.role as EvidenceDecisionRole) &&
        !route.decisionIds.length) ||
      (route.contentHash !== undefined &&
        route.contentHash !== null &&
        (typeof route.contentHash !== "string" ||
          !/^[a-f0-9]{64}$/.test(route.contentHash)))
    )
      throw new Error(
        "Invalid role, decision, reason or content version in evidence route",
      );
    seen.add(route.evidenceId);
    return {
      evidenceId: route.evidenceId,
      role: route.role as EvidenceDecisionRole,
      decisionIds: route.decisionIds as string[],
      reason: route.reason,
      ...(route.contentHash === undefined
        ? {}
        : { contentHash: route.contentHash as string | null }),
    };
  });
}

function withDecisionRoute(
  assessment: CandidateAssessment,
  route: EvidenceDecisionRoute | undefined,
  contentHash: string | null | undefined,
): CandidateAssessment {
  if (!route) return assessment;
  if (assessment.reasons.includes("invalid_http_url")) return assessment;
  if (!route.contentHash)
    return {
      ...assessment,
      decision: "review",
      routing: {
        method: "heuristic",
        role: "pending",
        decisionIds: [],
        reason: "旧语义分流缺少可绑定的正文版本，需要按当前原文重新审查。",
      },
      reasons: [...assessment.reasons, "unversioned_decision_route"],
    };
  if (route.contentHash !== (contentHash ?? null))
    return {
      ...assessment,
      decision: "review",
      routing: {
        method: "heuristic",
        role: "pending",
        decisionIds: [],
        reason: "原文版本改变，先前语义分流已失效。",
      },
      reasons: [...assessment.reasons, "stale_decision_route"],
    };
  const decision =
    route.role === "irrelevant"
      ? assessment.explicitUserSource
        ? "review"
        : "reject"
      : DECISION_ROLES.has(route.role)
        ? "keep"
        : "review";
  return {
    ...assessment,
    decision,
    routing: {
      method: "model_review",
      contentHash: route.contentHash,
      role: route.role,
      decisionIds: route.decisionIds,
      reason: route.reason,
    },
    reasons: [...assessment.reasons, "decision_route_is_not_fact_verification"],
  };
}

/** A source named by the user remains visible, even when it looks irrelevant. */
export function assessCandidate(
  candidate: SearchCandidate,
  brief: QualityBrief,
  options: {
    focus?: string;
    /** Only derive this from a persisted `provided` evidence row, never a search response. */
    userProvided?: boolean;
  } = {},
): CandidateAssessment {
  const canonical = canonicalUrl(candidate.url);
  const provided =
    options.userProvided === true && isAttachmentUrl(candidate.url);
  const explicitUserSource = Boolean(
    provided ||
    (canonical &&
      (brief.links ?? []).some((url) => canonicalUrl(url) === canonical)),
  );
  const kind = sourceKind(candidate);
  const haystack = normalText(
    `${candidate.title ?? ""} ${candidate.url} ${(candidate.excerpt ?? "").slice(0, 2400)}`,
  );
  const matchedTerms = briefTerms(brief, options.focus).filter((term) =>
    haystack.includes(term),
  );
  const titleTerms = briefTerms(brief, options.focus).filter((term) =>
    normalText(candidate.title ?? "").includes(term),
  );
  const reasons: string[] = [];
  const structuralNoise = ["corpus", "directory", "feed", "fiction"].includes(
    kind,
  );
  const requestedKind = terms(
    `${brief.question} ${options.focus ?? ""}`,
    50,
  ).some((term) =>
    (
      ({
        corpus: /语料|词频|词汇|corpus|corpora|vocab|词典/,
        directory: /目录|站点地图|sitemap|directory/,
        feed: /播客|rss|feed|podcast/,
        fiction: /小说|剧情|对话|fanfiction|fiction/,
      }) as Partial<Record<SourceKind, RegExp>>
    )[kind]?.test(term),
  );
  let score = Math.min(80, matchedTerms.length * 9 + titleTerms.length * 8);
  if (
    ["manual", "product", "study", "review"].includes(kind) &&
    matchedTerms.length > 0
  )
    score = Math.min(100, score + 12);
  if (structuralNoise && !requestedKind) {
    score = Math.max(0, score - 40);
    reasons.push(`document_shape:${kind}`);
  }
  if (kind === "aggregator") {
    score = Math.max(0, score - 12);
    reasons.push("aggregation_is_a_lead_not_a_primary_product_source");
  }
  if (!matchedTerms.length) reasons.push("no_brief_term_match");
  else reasons.push("lexical_match_requires_semantic_review");
  if (explicitUserSource) reasons.push("user_selected_source_preserved");
  if (provided)
    reasons.push(
      "user_provided_attachment",
      "not_an_external_independent_source",
    );
  if (!canonical && !provided) reasons.push("invalid_http_url");
  const routing = sourceSubjectRouting(candidate, brief, options.focus, kind);
  if (DECISION_ROLES.has(routing.role as EvidenceDecisionRole)) {
    // Object/body matching corrects generic brand-page titles and synonyms.
    score = Math.min(100, score + 24);
    reasons.push("object_or_task_candidate_requires_review");
  } else {
    score = Math.min(score, routing.role === "background" ? 12 : 6);
    reasons.push("no_decision_role_confirmed");
  }
  const decision: CandidateAssessment["decision"] =
    !canonical && !provided
      ? "reject"
      : explicitUserSource && (structuralNoise || score < 24)
        ? "review"
        : structuralNoise && !requestedKind
          ? "reject"
          : score >= 24 &&
              DECISION_ROLES.has(routing.role as EvidenceDecisionRole)
            ? "keep"
            : "review";
  return {
    schemaVersion: 1,
    decision,
    score,
    scoreMeaning: "lexical_triage_only",
    sourceKind: kind,
    authority: "unverified",
    explicitUserSource,
    matchedTerms,
    reasons,
    routing,
  };
}

export type EvidenceAvailability =
  | "captured"
  | "captured_empty"
  | "fetch_failed"
  | "not_fetched"
  | "unavailable"
  | "purged";
export interface EvidenceContextRow {
  id: string;
  url?: string;
  originalUrl?: string;
  title?: string | null;
  excerpt?: string | null;
  /** Only fetched body or extracted attachment text. Never put a search/image placeholder excerpt here. */
  content?: string | null;
  status: string;
  contentHash?: string | null;
  originUrl?: string | null;
  fetchedAt?: string | Date | null;
  purgedAt?: string | Date | null;
}

export interface ContextManifestSource {
  evidenceId: string;
  url: string;
  title: string;
  status: string;
  availability: EvidenceAvailability;
  contentHash: string | null;
  fetchedAt: string | null;
  capturedChars: number | null;
  includedChars: number;
  truncated: boolean;
  omittedReason:
    | "low_relevance"
    | "budget"
    | "source_limit"
    | "duplicate"
    | "unavailable"
    | "empty_body"
    | "pending_decision_route"
    | null;
  duplicateOf?: string;
  assessment: CandidateAssessment;
  selectionPriority?: "prior_research_basis" | "verification_question";
  handoff?: {
    decisionIds: string[];
    requestedRanges: EvidenceHandoffRange[];
    requestedChars: number;
    includedRequestedChars: number;
    omittedRanges: EvidenceHandoffRange[];
    status: "included" | "partial" | "omitted";
  };
}

export interface PackedEvidenceSource {
  id: string;
  url: string;
  title: string;
  status: string;
  originUrl: string | null;
  contentHash: string | null;
  /** Fetch time is not the source publication date or the product observation date. */
  fetchedAt: string | null;
  sourceAvailability: EvidenceAvailability;
  contextInclusion: "full" | "excerpt";
  contentKind: "captured_text" | "search_excerpt" | "user_provided_text";
  sourceKind: SourceKind;
  authority: "unverified";
  warnings: string[];
  capturedChars: number | null;
  includedChars: number;
  truncated: boolean;
  /** UTF-16 offsets in researchSourceText(body), not in an upstream wire response. */
  contentRanges: Array<{ start: number; end: number }>;
  content: string;
  routing?: EvidenceRouting;
}

function availability(row: EvidenceContextRow): EvidenceAvailability {
  if (row.purgedAt || row.status === "purged") return "purged";
  if (typeof row.content === "string")
    return row.content.trim() ? "captured" : "captured_empty";
  if (row.status === "fetch_failed") return "fetch_failed";
  if (row.status === "link_only" || row.status === "pending")
    return "not_fetched";
  return "unavailable";
}

function contentFingerprint(content: string) {
  return createHash("sha256")
    .update(content.replace(/\s+/g, " ").trim())
    .digest("hex");
}

function safeSlice(text: string, start: number, end: number) {
  if (start > 0 && /[\uDC00-\uDFFF]/.test(text[start] ?? "")) start++;
  if (end > 0 && /[\uD800-\uDBFF]/.test(text[end - 1] ?? "")) end--;
  return { text: text.slice(start, end), start, end };
}

interface Passage extends ResearchTextBlock {
  score: number;
  pivot: number;
}
function rankedPassages(
  content: string,
  keywords: readonly string[],
  userProvided = false,
): Passage[] {
  const blocks = researchTextBlocks(content, { userProvided });
  const words = [...new Set(keywords)];
  const occurrences = new Map(
    words.map((word) => [
      word,
      blocks.filter((block) => normalText(block.searchText).includes(word))
        .length,
    ]),
  );
  const passages: Passage[] = blocks.map((block) => {
    const visible = normalText(block.searchText);
    const matches = words.filter((word) => visible.includes(word));
    let score = matches.reduce(
      (sum, word) =>
        sum +
        Math.min(5, word.length) *
          (1 +
            Math.log(1 + blocks.length / (1 + (occurrences.get(word) ?? 0)))),
      0,
    );
    const time =
      /(?:\d+(?:\.\d+)?|[一二三四五六七八九十两半]+)\s*(?:分钟|小时|秒钟|秒|minutes?|mins?|hours?|seconds?)/i.test(
        visible,
      );
    if (time) score += 10;
    if (
      time &&
      /前后|合计|总(?:共|计|耗时|时长)|全(?:部|程)|至此|overall|in total|altogether/i.test(
        visible,
      )
    )
      score += 22;
    if (
      /预热|准备|切.{0,6}(?:食材|肉|菜)|烹饪|加热|取出|清洗|收纳|preheat|prepar|clean|cook/i.test(
        visible,
      )
    )
      score += matches.length ? 5 : 1;
    if (
      /不能|不足|不够|不理想|可惜|遗憾|however|did not|too (?:small|large)/i.test(
        visible,
      )
    )
      score += matches.length ? 8 : 1;
    if (block.kind === "heading") score *= 0.25;
    if (userProvided) score = Math.max(1, score);
    const strongest = matches.sort((a, b) => b.length - a.length)[0];
    const original = content
      .slice(block.start, block.end)
      .toLocaleLowerCase("en-US");
    const matchAt = strongest ? original.indexOf(strongest) : -1;
    return {
      ...block,
      score,
      pivot: matchAt < 0 ? block.start : block.start + matchAt,
    };
  });
  // Adjacent paragraphs in the same section often contain the outcome or
  // counterexample while using pronouns instead of repeating the product name.
  // Propagate once from the original score; never let a long document cascade.
  const baseScores = passages.map((passage) => passage.score);
  for (let index = 0; index < passages.length; index++) {
    const passage = passages[index];
    if (passage.kind !== "paragraph") continue;
    for (const nextIndex of [index - 1, index + 1]) {
      const neighbour = passages[nextIndex];
      if (neighbour?.section === passage.section && baseScores[nextIndex] >= 20)
        passage.score = Math.max(passage.score, baseScores[nextIndex] * 0.8);
    }
  }
  return passages.sort((a, b) => b.score - a.score || a.start - b.start);
}

function excerptFromPassages(
  content: string,
  ranked: readonly Passage[],
  limit: number,
  priorRanges: readonly EvidenceHandoffRange[] = [],
) {
  const marker = "\n[…省略原文…]\n";
  const selected: Array<{ start: number; end: number }> = [];
  const render = (input: typeof selected) => {
    const ranges: typeof selected = [];
    for (const range of [...input].sort((a, b) => a.start - b.start)) {
      const last = ranges.at(-1);
      if (
        last &&
        range.start <= last.end + 2 &&
        /^\s*$/.test(content.slice(last.end, range.start))
      )
        last.end = Math.max(last.end, range.end);
      else ranges.push({ ...range });
    }
    return {
      ranges,
      content: ranges
        .map(
          (range, index) =>
            (index || range.start > 0 ? marker : "") +
            content.slice(range.start, range.end),
        )
        .join(""),
    };
  };
  const add = (passage: { start: number; end: number }) => {
    if (
      selected.some(
        (range) => range.start === passage.start && range.end === passage.end,
      )
    )
      return true;
    if (render([...selected, passage]).content.length > limit) return false;
    selected.push({ start: passage.start, end: passage.end });
    return true;
  };
  // Reading continuity is a range request, not a new relevance judgment. Keep
  // exact previous passages first; expose any budget omission in the manifest.
  for (const range of priorRanges) {
    const complete = { start: range.start, end: range.end };
    for (const block of ranked) {
      if (
        block.kind === "table" &&
        block.start < range.end &&
        block.end > range.start
      ) {
        complete.start = Math.min(complete.start, block.start);
        complete.end = Math.max(complete.end, block.end);
      }
    }
    add(complete);
  }
  // Bias/commission disclosures travel with excerpts, rather than being lost
  // because they appear after the product test. They do not count as support.
  for (const passage of ranked
    .filter((block) => block.kind === "disclosure")
    .slice(0, 3))
    if (passage.end - passage.start <= Math.min(800, limit / 3)) add(passage);
  const usable = ranked.filter((block) => block.kind !== "disclosure");
  for (const passage of usable) {
    if (passage.score <= 0 && selected.length) continue;
    add(passage);
  }
  if (!selected.length && usable.length) {
    // A clipped table can detach a number from its column/header. If the full
    // table cannot fit, leave it in the archive instead of inventing a row view.
    const best = usable.find((passage) => passage.kind !== "table");
    if (!best) return render(selected);
    const room = Math.max(0, limit - marker.length);
    const start = Math.max(
      best.start,
      Math.min(best.pivot - Math.floor(room / 2), best.end - room),
    );
    const fragment = safeSlice(
      content,
      start,
      Math.min(best.end, start + room),
    );
    if (fragment.text)
      selected.push({ start: fragment.start, end: fragment.end });
  }
  return render(selected);
}

export interface EvidenceContextManifest {
  schemaVersion: 1;
  sources: ContextManifestSource[];
  handoffIssues?: ResearchEvidenceHandoff["issues"];
}

/** Carry selection identity only while the retained body version is unchanged. */
export function researchBasisEvidenceIds(
  rows: readonly EvidenceContextRow[],
  results: readonly unknown[],
) {
  const retained = new Map(
    rows
      .filter(
        (row) =>
          row.content?.trim() &&
          !row.purgedAt &&
          availability(row) === "captured",
      )
      .map((row) => [row.id, row.contentHash]),
  );
  const ids = new Set<string>();
  for (const result of results) {
    const manifest = (
      result as { writerContextManifest?: { sources?: unknown[] } } | null
    )?.writerContextManifest;
    for (const item of Array.isArray(manifest?.sources)
      ? manifest.sources
      : []) {
      if (!item || typeof item !== "object") continue;
      const source = item as {
        id?: string;
        contentHash?: string;
        includedChars?: number;
      };
      if (
        typeof source.id === "string" &&
        typeof source.contentHash === "string" &&
        /^[a-f0-9]{64}$/.test(source.contentHash) &&
        Number(source.includedChars) > 0 &&
        retained.get(source.id) === source.contentHash
      )
        ids.add(source.id);
    }
  }
  return [...ids];
}

/**
 * maxChars is a hard limit on JSON.stringify({sources, diagnostics}).length.
 * The complete manifest is for persistent auditing, not unbounded model input.
 * This is a character budget, NOT a token or model-window claim.
 */
export function packEvidenceContext(
  rows: readonly EvidenceContextRow[],
  brief: QualityBrief,
  options: {
    maxChars?: number;
    perSourceChars?: number;
    maxSources?: number;
    focus?: string;
    decisionRoutes?: readonly EvidenceDecisionRoute[];
    requireDecisionRoutes?: boolean;
    /** Selection continuity, not a claim of relevance or verified facts. */
    preferredEvidenceIds?: readonly string[];
    /** Review may read unrouted candidates; synthesis still obeys its route gate. */
    purpose?: "review" | "synthesis";
    handoff?: ResearchEvidenceHandoff;
  } = {},
) {
  const maxChars = Math.floor(options.maxChars ?? 32000);
  const perSourceChars = Math.max(
    128,
    Math.floor(options.perSourceChars ?? 4000),
  );
  const maxSources = Math.max(1, Math.floor(options.maxSources ?? 20));
  if (!Number.isFinite(maxChars) || maxChars < 1024)
    throw new RangeError("Evidence context maxChars must be at least 1024");
  if (!Number.isFinite(perSourceChars) || !Number.isFinite(maxSources))
    throw new RangeError("Evidence context limits must be finite");
  if (new Set(rows.map((row) => row.id)).size !== rows.length)
    throw new Error("Duplicate evidence id in context input");
  const keywords = [
    ...new Set([
      ...briefTerms(brief, options.focus),
      ...OBJECT_FAMILIES.filter((family) =>
        family.some((word) =>
          normalText(`${brief.question} ${options.focus ?? ""}`).includes(word),
        ),
      ).flat(),
    ]),
  ];
  const routes = new Map(
    validateEvidenceDecisionRoutes(
      options.decisionRoutes ?? [],
      rows.map((row) => row.id),
    ).map((route) => [route.evidenceId, route]),
  );
  const manifests = new Map<string, ContextManifestSource>();
  const preferred = new Set(options.preferredEvidenceIds ?? []);
  const handoff = validateResearchEvidenceHandoff(rows, options.handoff);
  const handoffById = new Map(
    handoff.selections.map((selection) => [selection.evidenceId, selection]),
  );
  const prepared = rows
    .map((row) => {
      const url = row.url ?? row.originalUrl ?? "";
      const userProvided = isProvidedAttachment(row);
      const state = availability(row);
      const captured = state === "captured" || state === "captured_empty";
      const cleaned = captured ? researchSourceText(row.content ?? "") : "";
      const body = captured
        ? cleaned
        : state === "purged" || userProvided
          ? ""
          : researchSourceText(row.excerpt ?? "");
      const assessment = withDecisionRoute(
        assessCandidate(
          {
            url,
            title: row.title,
            excerpt: row.excerpt,
            content: captured ? row.content : undefined,
          },
          brief,
          { focus: options.focus, userProvided },
        ),
        routes.get(row.id),
        row.contentHash,
      );
      const passages =
        assessment.decision === "reject"
          ? []
          : rankedPassages(body, keywords, userProvided);
      const relevantRole = DECISION_ROLES.has(
        assessment.routing?.role as EvidenceDecisionRole,
      );
      const rank =
        assessment.score +
        (relevantRole ? 60 : -40) +
        (captured && relevantRole ? 20 : 0) +
        (assessment.explicitUserSource ? 60 : 0) +
        Math.min(20, passages[0]?.score ?? 0);
      const selection = handoffById.get(row.id);
      const entry: ContextManifestSource = {
        evidenceId: row.id,
        url,
        title: row.title ?? "",
        status: row.status,
        availability: state,
        contentHash: row.contentHash ?? null,
        fetchedAt:
          row.fetchedAt instanceof Date
            ? row.fetchedAt.toISOString()
            : (row.fetchedAt ?? null),
        capturedChars: captured ? cleaned.length : null,
        includedChars: 0,
        truncated: false,
        omittedReason: null,
        assessment,
        ...(selection
          ? {
              selectionPriority: selection.reason,
              handoff: {
                decisionIds: selection.decisionIds,
                requestedRanges: selection.ranges,
                requestedChars: selection.ranges.reduce(
                  (sum, range) => sum + range.end - range.start,
                  0,
                ),
                includedRequestedChars: 0,
                omittedRanges: selection.ranges,
                status: "omitted" as const,
              },
            }
          : captured && preferred.has(row.id)
            ? { selectionPriority: "prior_research_basis" as const }
            : {}),
      };
      manifests.set(row.id, entry);
      return {
        row,
        url,
        state,
        userProvided,
        captured,
        body,
        passages,
        assessment,
        rank,
        selection,
        entry,
      };
    })
    .sort(
      (a, b) =>
        Number(b.selection?.reason === "verification_question") -
          Number(a.selection?.reason === "verification_question") ||
        Number(Boolean(b.selection)) - Number(Boolean(a.selection)) ||
        Number(b.captured && preferred.has(b.row.id)) -
          Number(a.captured && preferred.has(a.row.id)) ||
        (options.purpose === "review"
          ? Number(b.captured) - Number(a.captured)
          : 0) ||
        b.rank - a.rank ||
        a.url.localeCompare(b.url, "en") ||
        a.row.id.localeCompare(b.row.id, "en"),
    );
  const sources: PackedEvidenceSource[] = [];
  const seenUrls = new Map<string, string>();
  const seenContent = new Map<string, string>();
  const diagnostics = () => {
    const counts: Record<string, number> = {};
    for (const entry of manifests.values())
      if (entry.omittedReason)
        counts[entry.omittedReason] = (counts[entry.omittedReason] ?? 0) + 1;
    return {
      schemaVersion: 1 as const,
      budgetUnit: "utf16_json_chars" as const,
      note: "content 可能是原文节选或搜索摘要，见 contentKind/contentRanges。未列入 sources 的来源未在本次上下文中阅读，不能据此断言原网页为空。来源类型与分数仅供分流，事实仍需核验。",
      totalSources: rows.length,
      includedSources: sources.length,
      omittedByReason: counts,
      truncatedSources: sources.filter((source) => source.truncated).length,
      ...(options.handoff
        ? {
            handoffRequestedSources: handoff.selections.length,
            handoffIncludedSources: sources.filter((source) =>
              handoffById.has(source.id),
            ).length,
            handoffRejectedBindings: handoff.issues.length,
          }
        : {}),
    };
  };
  const used = () =>
    JSON.stringify({ sources, diagnostics: diagnostics() }).length;
  for (const item of prepared) {
    const { row, url, entry, assessment, body } = item;
    if (assessment.decision === "reject") {
      entry.omittedReason = "low_relevance";
      continue;
    }
    if (!body.trim()) {
      entry.omittedReason =
        item.state === "captured_empty" ? "empty_body" : "unavailable";
      continue;
    }
    if (
      options.requireDecisionRoutes &&
      assessment.routing?.method !== "model_review" &&
      !assessment.explicitUserSource
    ) {
      entry.omittedReason = "pending_decision_route";
      continue;
    }
    const canonical = canonicalUrl(url);
    const fingerprint = item.captured ? contentFingerprint(body) : null;
    const duplicateOf =
      (canonical ? seenUrls.get(canonical) : null) ??
      (fingerprint ? seenContent.get(fingerprint) : null);
    if (duplicateOf) {
      entry.omittedReason = "duplicate";
      entry.duplicateOf = duplicateOf;
      continue;
    }
    if (sources.length >= maxSources) {
      entry.omittedReason = "source_limit";
      continue;
    }
    const cap = Math.min(
      perSourceChars,
      item.captured
        ? options.purpose === "review" && item.selection
          ? item.selection.ranges.length
            ? // Reserve exact prior passages across the selected set before
              // spending the same budget on additional text from early sources.
              Math.max(
                384,
                item.selection.ranges.reduce(
                  (sum, range) =>
                    sum + range.end - range.start + "\n[…省略原文…]\n".length,
                  0,
                ),
              )
            : Math.min(perSourceChars, 2400)
          : options.purpose === "review"
            ? Math.min(perSourceChars, 1400)
            : assessment.explicitUserSource ||
                DECISION_ROLES.has(
                  assessment.routing?.role as EvidenceDecisionRole,
                )
              ? perSourceChars
              : assessment.routing?.role === "background"
                ? 900
                : 500
        : 700,
      body.length,
    );
    const makeSource = (limit: number): PackedEvidenceSource => {
      const excerpt = excerptFromPassages(
        body,
        item.passages,
        limit,
        item.selection?.ranges,
      );
      const actualChars = excerpt.ranges.reduce(
        (sum, range) => sum + range.end - range.start,
        0,
      );
      return {
        // A truncated URL can silently identify a different document or break a
        // citation. Keep identity intact; omit a source if metadata cannot fit.
        id: row.id,
        url,
        title: (row.title ?? "").slice(0, 240),
        status: row.status,
        originUrl: row.originUrl ?? null,
        contentHash: row.contentHash ?? null,
        fetchedAt: item.userProvided ? null : entry.fetchedAt,
        sourceAvailability: item.state,
        contextInclusion: actualChars < body.length ? "excerpt" : "full",
        contentKind: item.userProvided
          ? "user_provided_text"
          : item.captured
            ? "captured_text"
            : "search_excerpt",
        sourceKind: assessment.sourceKind,
        authority: "unverified",
        warnings: [
          ...assessment.reasons,
          ...(options.purpose === "review" &&
          assessment.routing?.method !== "model_review"
            ? ["candidate_read_for_review_not_decision_evidence"]
            : []),
          ...(item.captured ? [] : ["not_full_page_text"]),
        ],
        capturedChars: entry.capturedChars,
        includedChars: actualChars,
        truncated: actualChars < body.length,
        contentRanges: excerpt.ranges,
        content: excerpt.content,
        routing: assessment.routing,
      };
    };
    let low = Math.min(120, cap);
    let high = cap;
    let accepted: PackedEvidenceSource | null = null;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const candidate = makeSource(mid);
      sources.push(candidate);
      const fits = used() <= maxChars - 128; // Reserve for final omission-reason counters.
      sources.pop();
      if (fits) {
        accepted = candidate;
        low = mid + 1;
      } else high = mid - 1;
    }
    if (!accepted || !accepted.content.trim()) {
      entry.omittedReason = "budget";
      continue;
    }
    sources.push(accepted);
    entry.includedChars = accepted.includedChars;
    entry.truncated = accepted.truncated;
    if (canonical) seenUrls.set(canonical, row.id);
    if (fingerprint) seenContent.set(fingerprint, row.id);
  }
  // A final exact check also covers unusually large counter digit lengths.
  while (used() > maxChars && sources.length) {
    const removed = sources.pop()!;
    const entry = manifests.get(removed.id)!;
    entry.includedChars = 0;
    entry.truncated = false;
    entry.omittedReason = "budget";
  }
  const includedById = new Map(sources.map((source) => [source.id, source]));
  for (const entry of manifests.values()) {
    if (!entry.handoff) continue;
    const included = includedById.get(entry.evidenceId);
    const contains = (range: EvidenceHandoffRange) =>
      included?.contentRanges.some(
        (current) => current.start <= range.start && current.end >= range.end,
      );
    entry.handoff.omittedRanges = entry.handoff.requestedRanges.filter(
      (range) => !contains(range),
    );
    entry.handoff.includedRequestedChars = entry.handoff.requestedRanges
      .filter(contains)
      .reduce((sum, range) => sum + range.end - range.start, 0);
    entry.handoff.status = !included
      ? "omitted"
      : entry.handoff.omittedRanges.length
        ? "partial"
        : "included";
  }
  const finalDiagnostics = diagnostics();
  const manifest: EvidenceContextManifest = {
    schemaVersion: 1,
    sources: rows.map((row) => manifests.get(row.id)!),
    ...(options.handoff ? { handoffIssues: handoff.issues } : {}),
  };
  return {
    sources,
    diagnostics: finalDiagnostics,
    manifest,
    usedChars: JSON.stringify({ sources, diagnostics: finalDiagnostics })
      .length,
    maxChars,
  };
}

function citationProse(text: string) {
  let fence: { char: string; length: number } | null = null;
  let previousBlank = true;
  let indentedCode = false;
  let listOpen = false;
  const lines = text.split("\n").map((line) => {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (
        marker &&
        marker[1][0] === fence.char &&
        marker[1].length >= fence.length &&
        !marker[2].trim()
      )
        fence = null;
      return "";
    }
    if (marker) {
      fence = { char: marker[1][0], length: marker[1].length };
      previousBlank = true;
      return "";
    }
    const blank = !line.trim();
    const indented = /^(?: {4}|\t)/.test(line);
    if (/^ {0,3}(?:[-+*]|\d+[.)])\s+/.test(line)) listOpen = true;
    else if (!blank && !indented) listOpen = false;
    // An indented continuation inside a list or directly after prose is not
    // automatically a code block. Hiding it would hide real report citations.
    if (indented && !listOpen && (previousBlank || indentedCode)) {
      indentedCode = true;
      previousBlank = false;
      return "";
    }
    if (!blank) indentedCode = false;
    previousBlank = blank;
    return line;
  });
  const prose = lines.join("\n");
  let output = "";
  for (let cursor = 0; cursor < prose.length; ) {
    if (prose[cursor] !== "`" || prose[cursor - 1] === "\\") {
      output += prose[cursor++];
      continue;
    }
    let end = cursor;
    while (prose[end] === "`") end++;
    const delimiter = prose.slice(cursor, end);
    let close = prose.indexOf(delimiter, end);
    while (
      close >= 0 &&
      (prose[close - 1] === "`" || prose[close + delimiter.length] === "`")
    )
      close = prose.indexOf(delimiter, close + delimiter.length);
    if (close < 0) {
      output += delimiter;
      cursor = end;
    } else {
      output += " ";
      cursor = close + delimiter.length;
    }
  }
  return output;
}

/** Validates IDs only. It does not establish whether cited text supports a claim. */
export function validateEvidenceIds(
  text: string,
  allowedIds: Iterable<string>,
) {
  const allowed = new Set(allowedIds);
  const ids = new Set<string>();
  const prose = citationProse(text);
  for (const match of prose.matchAll(/\bc[a-z0-9]{24,31}\b/g))
    ids.add(match[0]);
  for (const match of prose.matchAll(
    /\[(?:来源|证据|evidence|source)\s*[:：#]\s*([^\]\n]{1,1000})\]/gi,
  )) {
    for (const id of match[1].split(/[,，;；、\s]+/)) {
      if (/^[a-zA-Z0-9_-]+$/.test(id)) ids.add(id);
    }
  }
  for (const match of prose.matchAll(
    /\]\((?:evidence:|#source-)([a-zA-Z0-9_-]+)\)/g,
  ))
    ids.add(match[1]);
  for (const match of prose.matchAll(
    /\[(?:\^)?((?:ev|src)[_-][a-zA-Z0-9_-]+)\]/g,
  ))
    ids.add(match[1]);
  for (const id of allowed) {
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\[(?:\\^)?${escaped}\\]`).test(prose)) ids.add(id);
  }
  const unmappedCitationLabels = new Set<string>();
  for (const match of prose.matchAll(
    /\[(?:\^)?((?:[ES]?\d+)(?:\s*[,，;；、]\s*[ES]?\d+)*)\]/gi,
  )) {
    for (const label of match[1].split(/\s*[,，;；、]\s*/)) {
      ids.add(label);
      if (!allowed.has(label)) unmappedCitationLabels.add(label);
    }
  }
  const referencedIds = [...ids];
  const unknownIds = referencedIds.filter((id) => !allowed.has(id));
  return {
    valid: unknownIds.length === 0,
    referencedIds,
    unknownIds,
    unmappedCitationLabels: [...unmappedCitationLabels],
    scope: "id_membership_only" as const,
  };
}

export interface QualityIssue {
  code: string;
  severity: "warning" | "error";
  message: string;
}

export function assessResearchQuality(input: {
  evidence: readonly EvidenceContextRow[];
  brief: QualityBrief;
  reportText?: string;
  allowedEvidenceIds?: Iterable<string>;
  unresolvedQuestions?: readonly unknown[] | number;
  executionCompleted?: boolean;
  thresholds?: { minRelevantCaptured?: number; minDistinctHosts?: number };
  decisionRoutes?: readonly EvidenceDecisionRoute[];
  requireDecisionRoutes?: boolean;
}) {
  const routes = new Map(
    validateEvidenceDecisionRoutes(
      input.decisionRoutes ?? [],
      input.evidence.map((row) => row.id),
    ).map((route) => [route.evidenceId, route]),
  );
  const rows = input.evidence.map((row) => ({
    row,
    state: availability(row),
    userProvided: isProvidedAttachment(row),
    assessment: withDecisionRoute(
      assessCandidate(
        {
          url: row.url ?? row.originalUrl ?? "",
          title: row.title,
          excerpt: row.excerpt,
          content: availability(row) === "captured" ? row.content : undefined,
        },
        input.brief,
        { userProvided: isProvidedAttachment(row) },
      ),
      routes.get(row.id),
      row.contentHash,
    ),
  }));
  const substantive = new Set([
    "product",
    "manual",
    "study",
    "review",
    "news",
    "unknown",
  ]);
  const relevant = rows.filter(
    (item) =>
      item.state === "captured" &&
      item.assessment.decision === "keep" &&
      DECISION_ROLES.has(
        item.assessment.routing?.role as EvidenceDecisionRole,
      ) &&
      (!input.requireDecisionRoutes ||
        item.assessment.routing?.method === "model_review") &&
      substantive.has(item.assessment.sourceKind),
  );
  const unique = new Map<string, (typeof relevant)[number]>();
  for (const item of relevant)
    unique.set(
      contentFingerprint(researchSourceText(item.row.content ?? "")),
      item,
    );
  const relevantCaptured = [...unique.values()];
  const providedText = rows.filter(
    (item) => item.userProvided && item.state === "captured",
  );
  const unreadProvided = rows.filter(
    (item) => item.userProvided && item.state !== "captured",
  );
  const externalRelevant = relevantCaptured.filter(
    (item) => !item.userProvided,
  );
  const hosts = new Set(
    externalRelevant
      .map((item) => {
        try {
          return new URL(
            item.row.url ?? item.row.originalUrl ?? "",
          ).hostname.replace(/^www\./, "");
        } catch {
          return "";
        }
      })
      .filter(Boolean),
  );
  const allowed =
    input.allowedEvidenceIds ?? input.evidence.map((row) => row.id);
  const citations = validateEvidenceIds(input.reportText ?? "", allowed);
  const unresolved = Array.isArray(input.unresolvedQuestions)
    ? input.unresolvedQuestions.length
    : Number(input.unresolvedQuestions ?? 0);
  const minRelevantCaptured = Math.max(
    1,
    input.thresholds?.minRelevantCaptured ?? 3,
  );
  const minDistinctHosts = Math.max(1, input.thresholds?.minDistinctHosts ?? 2);
  const issues: QualityIssue[] = [];
  if (!relevantCaptured.length && !providedText.length)
    issues.push({
      code: "NO_SUBSTANTIVE_CAPTURED_EVIDENCE",
      severity: "error",
      message:
        "尚无通过相关性分流的非聚合全文材料；已有链接、目录或摘录不能证明调研完成。",
    });
  else if (relevantCaptured.length < minRelevantCaptured)
    issues.push({
      code: "LIMITED_CAPTURED_COVERAGE",
      severity: "warning",
      message: `相关全文材料 ${relevantCaptured.length} 份，未达到本轮自动材料门槛 ${minRelevantCaptured} 份。`,
    });
  if (hosts.size < minDistinctHosts)
    issues.push({
      code: "LIMITED_SOURCE_DIVERSITY",
      severity: "warning",
      message: `相关外部全文来源主机 ${hosts.size} 个，少于本轮门槛 ${minDistinctHosts}；用户附件不计为外部来源，不同域名也不自动代表独立证据。`,
    });
  if (providedText.length && !externalRelevant.length)
    issues.push({
      code: "USER_PROVIDED_MATERIAL_ONLY",
      severity: "warning",
      message: `已读取 ${providedText.length} 份用户附件文本；相关性和内容真实性仍需核验，尚无满足自动门槛的外部全文证据。`,
    });
  if (unreadProvided.length)
    issues.push({
      code: "USER_ATTACHMENTS_WITHOUT_READABLE_TEXT",
      severity: "warning",
      message: `${unreadProvided.length} 份用户附件尚无可读抽取全文；图片留档不代表已经完成视觉分析。`,
    });
  if (citations.unknownIds.length)
    issues.push({
      code: "UNKNOWN_EVIDENCE_ID",
      severity: "error",
      message: `存在未在许可上下文中的引用 ID：${citations.unknownIds.join("、")}。`,
    });
  if (input.reportText !== undefined && !citations.referencedIds.length)
    issues.push({
      code: "NO_STRUCTURED_CITATIONS",
      severity: "warning",
      message: "报告没有可校验的来源 ID；不能由来源总数推定观点已被支持。",
    });
  if (unresolved > 0)
    issues.push({
      code: "UNRESOLVED_QUESTIONS",
      severity: "warning",
      message: `${unresolved} 项关键核验仍未解决。`,
    });
  if (input.reportText === undefined)
    issues.push({
      code: "REPORT_NOT_ASSESSED",
      severity: "warning",
      message: "尚未对最终报告的引用与核验缺口执行检查。",
    });
  const status = issues.some((issue) => issue.severity === "error")
    ? ("insufficient" as const)
    : issues.length
      ? ("draft" as const)
      : ("supported" as const);
  return {
    schemaVersion: 1 as const,
    status,
    label:
      status === "supported"
        ? "自动材料门槛满足，结论仍需核验"
        : status === "insufficient"
          ? "材料不足，不能作为完成的调研结论"
          : "研究草稿，存在待核验项",
    executionCompleted: input.executionCompleted ?? false,
    evidenceStatus: status,
    assessmentScope: "material_gate_not_fact_verification" as const,
    issues,
    metrics: {
      totalSources: rows.length,
      capturedSources: rows.filter((item) => item.state === "captured").length,
      providedTextSources: providedText.length,
      unreadProvidedSources: unreadProvided.length,
      externalRelevantCapturedSources: externalRelevant.length,
      relevantCapturedSources: relevantCaptured.length,
      distinctRelevantHosts: hosts.size,
      failedSources: rows.filter((item) => item.state === "fetch_failed")
        .length,
      linkOnlySources: rows.filter((item) => item.state === "not_fetched")
        .length,
      rejectedSources: rows.filter(
        (item) => item.assessment.decision === "reject",
      ).length,
      citedSources: citations.referencedIds.length,
      unknownCitationIds: citations.unknownIds.length,
      unresolvedQuestions: unresolved,
    },
    thresholds: { minRelevantCaptured, minDistinctHosts },
  };
}

