import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { db } from "../lib/db";
import { writeResearchFile } from "../lib/research/storage";
import { researchBriefSchema } from "../lib/research/types";

async function main() {
  if (!process.argv.includes("--local-preview-fixture"))
    throw Error("Explicit local preview fixture flag required");
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(
      new URL(process.env.DATABASE_URL!).hostname,
    )
  )
    throw Error("Local database required");
  const userId = process.argv[process.argv.indexOf("--user-id") + 1];
  if (!(await db.user.findFirst({ where: { id: userId, role: "ADMIN" } })))
    throw Error("Local administrator required");
  const requests: Array<{ url?: string; method?: string }> = [];
  const server = createServer((request, response) => {
    requests.push({ url: request.url, method: request.method });
    response.writeHead(200, { "Content-Type": "text/css" });
    response.end("body{color:red}");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(19998, "127.0.0.1", resolve);
  });
  const project = await db.researchProject.create({
    data: { userId, title: "浏览器预览验收夹具（非模型研究）" },
  });
  const brief = await db.researchBrief.create({
    data: {
      projectId: project.id,
      revision: 1,
      content: researchBriefSchema.parse({
        question: "浏览器预览验收夹具，不是模型生成结果",
      }),
    },
  });
  const task = await db.researchTask.create({
    data: {
      projectId: project.id,
      briefId: brief.id,
      userId,
      clientRequestId: randomUUID(),
      inputHash: "browser-fixture",
      preset: "research",
      scope: "exploratory",
      modelId: "offline-browser-fixture",
      reasoningEffort: "medium",
      plan: {
        preset: "research",
        reason: "离线浏览器验收",
        stages: [{ kind: "synthesize", engine: "fixture" }],
        limits: { llm: 0, search: 0, crawl: 0, minutes: 0 },
        products: ["html"],
      },
      configSnapshot: { retentionDays: 30 },
      status: "completed",
      finishedAt: new Date(),
    },
  });
  await db.researchStage.create({
    data: {
      taskId: task.id,
      kind: "synthesize",
      engine: "fixture",
      ordinal: 0,
      status: "completed",
      text: "# 浏览器预览验收夹具\n\n非模型研究，仅用于预览隔离验收。",
    },
  });
  const body = `<!doctype html><html><head><title>研究预览验收夹具</title><meta http-equiv="refresh" content="0;url=http://127.0.0.1:19998/navigation"><base href="http://127.0.0.1:19998/"><style>@import url('http://127.0.0.1:19998/style');body{font:16px/1.7 system-ui;margin:20px;color:#222}.table-wrap{overflow-x:auto}table{min-width:680px;border-collapse:collapse}td,th{padding:10px;border:1px solid #ccc}h1{font-size:24px}</style><script>fetch('http://127.0.0.1:19998/script')</script></head><body onload="fetch('http://127.0.0.1:19998/event')"><h1>研究预览验收夹具</h1><p>此页是离线浏览器验收资料，不是新研究结论。</p><a href="#source">材料记录</a><a href="javascript:fetch('http://127.0.0.1:19998/link')">脚本链接</a><div class="table-wrap"><table><tr><th>资料</th><th>用途</th><th>状态</th></tr><tr><td>自建文字样例</td><td>正文、表格、选择与复制</td><td>离线夹具</td></tr></table></div><section id="source"><h2>材料记录</h2><p>来源与结果均为自建浏览器测试内容。</p></section><form action="http://127.0.0.1:19998/form"><input value="fixture"></form><iframe src="http://127.0.0.1:19998/frame"></iframe></body></html>`;
  const saved = await writeResearchFile(task.id, "preview-fixture.html", body);
  await db.researchArtifact.create({
    data: {
      projectId: project.id,
      taskId: task.id,
      basisTaskId: task.id,
      briefId: brief.id,
      filename: "preview-fixture.html",
      title: "研究预览验收夹具",
      kind: "html",
      mimeType: "text/html; charset=utf-8",
      storageKey: saved.key,
      sizeBytes: saved.sizeBytes,
      sha256: saved.sha256,
      evidenceIds: [],
    },
  });
  console.log(
    JSON.stringify({
      taskId: task.id,
      url: `http://127.0.0.1:3000/app/research?task=${task.id}`,
      probe: "http://127.0.0.1:19998",
      synthetic: true,
    }),
  );
  await new Promise<void>((resolve) => {
    const stop = () => {
      clearTimeout(timer);
      server.close(() => resolve());
    };
    const timer = setTimeout(stop, 300000);
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  await mkdir("output/research-v2-integration", { recursive: true });
  const result = {
    taskId: task.id,
    requests,
    networkRequestsObserved: requests.length,
    checkedAt: new Date().toISOString(),
    synthetic: true,
  };
  await writeFile(
    "output/research-v2-integration/browser-network-probe.json",
    JSON.stringify(result, null, 2),
  );
  await db.researchProject.update({
    where: { id: project.id },
    data: { archivedAt: new Date() },
  });
  console.log(JSON.stringify(result));
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
