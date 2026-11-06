import { z } from "zod";
import { db } from "@/lib/db";
import { encrypt, decrypt } from "@/lib/crypto";
import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import type { ResearchPlanInput, ResearchPlan, ResearchLimits } from "./types";

const localUrl = z.url().refine((value) => {
  const url = new URL(value);
  return (
    ["http:", "https:"].includes(url.protocol) &&
    !url.username &&
    !url.password &&
    /^(localhost|127\.0\.0\.1|\[::1\]|host\.docker\.internal|[a-z][a-z0-9-]*)$/i.test(
      url.hostname,
    )
  );
}, "服务地址必须是本地地址或内部服务名");
const limit = z.object({
  llm: z.number().int().min(1).max(200),
  search: z.number().int().min(1).max(200),
  crawl: z.number().int().min(1).max(200),
  minutes: z.number().int().min(1).max(120),
});
export const researchConfigSchema = z.object({
  enabled: z.boolean().default(true),
  searxUrl: localUrl.default("http://127.0.0.1:18080"),
  crawlUrl: localUrl.default("http://127.0.0.1:18081"),
  embeddingUrl: localUrl.default("http://127.0.0.1:18082"),
  gptrUrl: localUrl.default("http://127.0.0.1:18083"),
  vaneUrl: localUrl.default("http://127.0.0.1:18084"),
  deerflowUrl: localUrl.default("http://127.0.0.1:18085"),
  gatewayUrl: localUrl.default(
    "http://research-gateway:8080/api/research/internal",
  ),
  retentionDays: z.number().int().min(1).max(365).default(30),
  inputUsdPerMillion: z.number().nonnegative().nullable().default(null),
  outputUsdPerMillion: z.number().nonnegative().nullable().default(null),
  limits: z
    .object({
      exploratory: limit.default({
        llm: 12,
        search: 8,
        crawl: 12,
        minutes: 10,
      }),
      standard: limit.default({ llm: 30, search: 20, crawl: 30, minutes: 25 }),
      deep: limit.default({ llm: 60, search: 40, crawl: 60, minutes: 45 }),
    })
    .default({
      exploratory: { llm: 12, search: 8, crawl: 12, minutes: 10 },
      standard: { llm: 30, search: 20, crawl: 30, minutes: 25 },
      deep: { llm: 60, search: 40, crawl: 60, minutes: 45 },
    }),
});
export type ResearchConfig = z.infer<typeof researchConfigSchema>;
export async function getResearchConfig(): Promise<ResearchConfig> {
  const row = await db.systemConfig.findUnique({
    where: { key: "research.config" },
  });
  return researchConfigSchema.parse(row?.value ?? {});
}
export async function setResearchConfig(value: unknown) {
  const config = researchConfigSchema.parse(value);
  await db.systemConfig.upsert({
    where: { key: "research.config" },
    create: { key: "research.config", value: config },
    update: { value: config },
  });
  return config;
}
async function signingSecret() {
  const key = "research.signingKeyEnc";
  let row = await db.systemConfig.findUnique({ where: { key } });
  if (!row)
    row = await db.systemConfig.upsert({
      where: { key },
      create: { key, value: encrypt(randomBytes(32).toString("hex")) },
      update: {},
    });
  return decrypt(String(row.value));
}
export async function researchToken(attemptId: string) {
  return `${attemptId}.${createHmac("sha256", await signingSecret())
    .update(`research:v1:${attemptId}`)
    .digest("hex")}`;
}
export async function verifyResearchToken(value: string) {
  const attemptId = value.split(".")[0];
  if (!attemptId || value.length > 200) return null;
  const expected = await researchToken(attemptId);
  return value.length === expected.length &&
    timingSafeEqual(Buffer.from(value), Buffer.from(expected))
    ? attemptId
    : null;
}
export function makeResearchPlan(
  input: ResearchPlanInput,
  limits: ResearchLimits,
): ResearchPlan {
  const needsFiles = input.products.some((product) =>
    ["pptx", "docx", "html"].includes(product),
  );
  const preset =
    input.preset === "auto"
      ? needsFiles ||
        /提案|演示稿|PPT|落地页|制作网页/i.test(input.brief.question)
        ? "proposal"
        : /系统|市场|竞品|比较|报告|调研|分析/.test(input.brief.question)
          ? "research"
          : "explore"
      : input.preset;
  const stages: ResearchPlan["stages"] = [];
  if (!input.sourceTaskId)
    stages.push(
      preset === "explore"
        ? { kind: "explore", engine: "vane" }
        : { kind: "research", engine: "gpt-researcher" },
    );
  if (input.collectVisuals && !input.sourceTaskId)
    stages.push({ kind: "capture", engine: "crawl4ai" });
  if (input.verify && !input.sourceTaskId)
    stages.push({ kind: "verify", engine: "chugao" });
  if (!input.sourceTaskId || input.sourceMode === "refresh")
    stages.push({ kind: "synthesize", engine: "chugao" });
  if (preset === "proposal" || needsFiles || input.sourceTaskId)
    stages.push({ kind: "produce", engine: "deerflow" });
  return {
    preset,
    reason: input.sourceTaskId
      ? input.sourceMode === "refresh"
        ? "只用选定版本的报告与留档重新整理并制作，不重新搜索或采集"
        : "使用选定研究版本制作新产物"
      : input.preset === "auto"
        ? preset === "proposal"
          ? "需求包含提案或文件交付"
          : preset === "research"
            ? "需求包含系统比较或研究报告"
            : "先探索资料，再逐步明确方向"
        : "按你选择的模式执行",
    stages,
    limits,
    products: input.products,
  };
}
