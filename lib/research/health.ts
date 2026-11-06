import { db } from "@/lib/db";
import { getChatProfile } from "@/lib/chat-profiles";
import { getResearchConfig } from "./config";

export async function researchHealth() {
  const config = await getResearchConfig();
  const entries = [
    ["searxng", "搜索", `${config.searxUrl}/`],
    ["crawl4ai", "网页采集", `${config.crawlUrl}/health`],
    ["embedding", "本地向量", `${config.embeddingUrl}/health`],
    ["gpt-researcher", "系统调研", `${config.gptrUrl}/health`],
    ["vane", "资料探索", `${config.vaneUrl}/api/providers`],
    ["deerflow", "提案制作", `${config.deerflowUrl}/health`],
  ];
  const services = await Promise.all(
    entries.map(async ([id, label, url]) => {
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(4000),
          cache: "no-store",
        });
        return {
          id,
          label,
          ready: response.ok,
          status: response.ok ? "就绪" : `HTTP ${response.status}`,
        };
      } catch {
        return { id, label, ready: false, status: "未连接" };
      }
    }),
  );
  const heartbeat = await db.systemConfig.findUnique({
    where: { key: "research.worker.heartbeat" },
  });
  const workerState = heartbeat?.value as { at?: string } | null;
  const workerReady =
    !!workerState?.at &&
    Date.now() - new Date(workerState.at).getTime() < 25000;
  let modelReady = false;
  try {
    const model = await getChatProfile("gpt-6.1-sol");
    modelReady = !!model.enabled && !!model.apiKey;
  } catch {
    /* An absent model is an explicit readiness failure. */
  }
  return {
    config,
    services,
    workerReady,
    modelReady,
    ready:
      config.enabled &&
      workerReady &&
      modelReady &&
      services.every((service) => service.ready),
    activeTasks: await db.researchTask.count({
      where: { status: { in: ["running", "queued"] } },
    }),
    modelCapability: "以实际研究任务的调用结果为准",
  };
}
