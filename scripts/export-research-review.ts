import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { db } from "../lib/db";
import { decrypt } from "../lib/crypto";
import { readResearchFile } from "../lib/research/storage";

const root = process.cwd();
const output = path.join(root, "output/chugao-research-v2-pro-review-20261019");
const taskId = "cmve7lhmx00053yo8vp7619en";
const controlId = "cmve6fjd600093yxp6bu0o4as";
const originalId = "cmvdzgia800c93yyzsuyfbr75";
const candidate =
  "/Users/isduanna/Downloads/Chugao_Research_Quality_V2_20261018/source";
const secrets = Object.entries(process.env)
  .filter(
    ([key, value]) =>
      /KEY|TOKEN|PASSWORD|SECRET/.test(key) && value && value.length >= 8,
  )
  .map(([, value]) => value!);
const redactions = new Map<string, number>();
function clean(value: string, file: string) {
  let result = value;
  for (const secret of secrets)
    result = result.split(secret).join("[REDACTED]");
  result = result.replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, "[REDACTED_API_KEY]");
  result = result.replace(/Bearer\s+[A-Za-z0-9._-]{24,}/g, "Bearer [REDACTED]");
  if (result !== value) redactions.set(file, (redactions.get(file) ?? 0) + 1);
  return result;
}
const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
async function save(relative: string, value: string | Buffer) {
  const file = path.join(output, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    typeof value === "string" ? clean(value, relative) : value,
  );
}
async function saveJson(relative: string, value: unknown) {
  await save(relative, json(value));
}
async function list(folder: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (
      entry.isSymbolicLink() ||
      ["node_modules", ".git", "__pycache__", ".pytest_cache"].includes(
        entry.name,
      )
    )
      continue;
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) result.push(...(await list(file)));
    else if (entry.isFile()) result.push(file);
  }
  return result;
}
async function recordCase(
  id: string,
  destination: string,
  withSources: boolean,
) {
  const task = await db.researchTask.findUniqueOrThrow({
    where: { id },
    include: {
      brief: true,
      stages: {
        orderBy: { ordinal: "asc" },
        include: { attempts: { orderBy: { ordinal: "asc" } } },
      },
      evidence: { orderBy: { createdAt: "asc" } },
      artifacts: true,
      calls: { orderBy: { startedAt: "asc" } },
      events: { orderBy: { seq: "asc" } },
    },
  });
  await saveJson(`${destination}/task-summary.json`, {
    id: task.id,
    projectId: task.projectId,
    briefId: task.briefId,
    sourceTaskId: task.sourceTaskId,
    status: task.status,
    preset: task.preset,
    scope: task.scope,
    modelId: task.modelId,
    reasoningEffort: task.reasoningEffort,
    llmCalls: task.llmCalls,
    searchCalls: task.searchCalls,
    crawlCalls: task.crawlCalls,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
    expiresAt: task.expiresAt,
    error: task.error,
  });
  await saveJson(`${destination}/brief.json`, task.brief);
  await saveJson(`${destination}/plan.json`, task.plan);
  await save(
    `${destination}/events.jsonl`,
    task.events
      .map((row) =>
        JSON.stringify({
          seq: row.seq,
          type: row.type,
          payload: row.payload,
          createdAt: row.createdAt,
        }),
      )
      .join("\n") + "\n",
  );
  const timeline = [
    "# 可见执行时间线",
    "",
    ...task.events.flatMap((row) => {
      if (/delta/.test(row.type)) return [];
      const data = row.payload as Record<string, unknown>;
      return [
        `- ${row.createdAt.toISOString()} · ${row.type} · ${String(data.message ?? data.query ?? data.kind ?? data.stageId ?? "")}`,
      ];
    }),
  ];
  await save(`${destination}/timeline.md`, timeline.join("\n") + "\n");
  for (const stage of task.stages) {
    await save(`${destination}/stages/${stage.kind}/final.md`, stage.text);
    await saveJson(
      `${destination}/stages/${stage.kind}/result.json`,
      stage.result,
    );
    await saveJson(
      `${destination}/stages/${stage.kind}/attempts.json`,
      stage.attempts,
    );
    for (const attempt of stage.attempts)
      await save(
        `${destination}/stages/${stage.kind}/attempt-${attempt.ordinal}.md`,
        attempt.text,
      );
  }
  await saveJson(
    `${destination}/model-calls.json`,
    task.calls.map((call) => ({
      id: call.id,
      taskId: call.taskId,
      attemptId: call.attemptId,
      kind: call.kind,
      requestHash: call.requestHash,
      status: call.status,
      usage: call.usage,
      costUsd: call.costUsd?.toString() ?? null,
      costBasis: call.costBasis,
      errorCode: call.errorCode,
      startedAt: call.startedAt,
      finishedAt: call.finishedAt,
    })),
  );
  const publicOutputs = task.calls.flatMap((call) => {
    if (!call.continuationEnc) return [];
    const value = JSON.parse(decrypt(call.continuationEnc));
    const outputs = (value.output ?? []).filter((item: { type?: string }) =>
      ["message", "function_call"].includes(String(item.type)),
    );
    return [{ callId: call.id, attemptId: call.attemptId, outputs }];
  });
  await save(
    `${destination}/model-public-outputs.jsonl`,
    publicOutputs.map((row) => JSON.stringify(row)).join("\n") + "\n",
  );
  const proposalInputs = [];
  for (const row of publicOutputs)
    for (const item of row.outputs) {
      if (
        item.type === "function_call" &&
        item.name === "chugao_create_proposal"
      )
        proposalInputs.push({
          callId: row.callId,
          attemptId: row.attemptId,
          arguments: JSON.parse(item.arguments),
        });
    }
  await saveJson(`${destination}/proposal-tool-inputs.json`, proposalInputs);
  await saveJson(
    `${destination}/evidence/index.json`,
    task.evidence.map(({ contentKey, screenshotKey, ...row }) => ({
      ...row,
      bodyFile: contentKey ? `${row.id}/source.md` : null,
      screenshotFile: screenshotKey ? `${row.id}/screenshot.png` : null,
    })),
  );
  if (withSources)
    for (const row of task.evidence) {
      if (row.contentKey && !row.purgedAt)
        await save(
          `${destination}/evidence/${row.id}/source.md`,
          (await readResearchFile(row.contentKey)).toString("utf8"),
        );
      if (row.screenshotKey && !row.purgedAt)
        await save(
          `${destination}/evidence/${row.id}/screenshot.png`,
          await readResearchFile(row.screenshotKey),
        );
    }
  const lineage = [];
  for (const file of task.artifacts) {
    const bytes = await readResearchFile(file.storageKey);
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== file.sha256 || bytes.length !== file.sizeBytes)
      throw Error(`Artifact integrity failed: ${file.filename}`);
    await save(`${destination}/results/${path.basename(file.filename)}`, bytes);
    lineage.push({
      id: file.id,
      filename: file.filename,
      title: file.title,
      kind: file.kind,
      basisTaskId: file.basisTaskId,
      briefId: file.briefId,
      evidenceIds: file.evidenceIds,
      sha256: digest,
      sizeBytes: bytes.length,
      integrity: "passed",
    });
  }
  await saveJson(`${destination}/artifact-lineage.json`, lineage);
  for (const stage of task.stages) {
    if (!["gpt-researcher", "deerflow"].includes(stage.engine)) continue;
    for (const attempt of stage.attempts) {
      const runId = attempt.remoteRunId ?? attempt.id;
      if (!/^[a-zA-Z0-9_-]+$/.test(runId)) continue;
      const reader = `import json,pathlib\np=pathlib.Path('/work/runs/${runId}')\nout={}\nfor name in ('state.json','events.jsonl','stderr.log'):\n f=p/name\n if f.is_file():out[name]=f.read_text()\nf=p/'input.json'\nif f.is_file():\n v=json.loads(f.read_text());out['engine-input.json']={k:v[k] for k in ('query','scope','brief','context','evidence','searchPlan','products','research','finalResearchPackage') if k in v}\nprint(json.dumps(out,ensure_ascii=False))`;
      const result = spawnSync(
        "docker",
        [
          "compose",
          "-f",
          "docker-compose.research.yml",
          "exec",
          "-T",
          stage.engine,
          "python",
          "-c",
          reader,
        ],
        { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
      );
      if (result.status !== 0) continue;
      const files = JSON.parse(result.stdout) as Record<string, unknown>;
      for (const [name, data] of Object.entries(files)) {
        if (typeof data === "string")
          await save(`${destination}/runtime/${runId}/${name}`, data);
        else await saveJson(`${destination}/runtime/${runId}/${name}`, data);
      }
    }
  }
  return {
    id: task.id,
    status: task.status,
    llmCalls: task.llmCalls,
    evidence: task.evidence.length,
    files: lineage.length,
  };
}
async function main() {
  if (
    !process.argv.includes("--local-review-export") ||
    !["127.0.0.1", "localhost", "[::1]"].includes(
      new URL(process.env.DATABASE_URL!).hostname,
    )
  )
    throw Error("Explicit local review export only.");
  const primary = await recordCase(taskId, "case", true);
  const control = await recordCase(controlId, "control-synthetic-20", false);
  const extraction = spawnSync(
    "docker",
    [
      "run",
      "--rm",
      "--network",
      "none",
      "--read-only",
      "--cap-drop",
      "ALL",
      "--tmpfs",
      "/tmp",
      "-v",
      `${output}/case/results:/files:ro`,
      "--entrypoint",
      "python",
      "chugao-research-deerflow",
      "-c",
      `from pathlib import Path
from pptx import Presentation
from docx import Document
from docx.text.paragraph import Paragraph
from docx.table import Table
print('# 实际 Office 文件文字抽取\\n\\n只读解析，不含新增模型解释；顺序按文件与页面。')
for file in sorted(Path('/files').glob('*.pptx')):
 print('\\n# '+file.name)
 for index,slide in enumerate(Presentation(file).slides,1):
  print('\\n## 第 '+str(index)+' 页')
  for shape in slide.shapes:
   if shape.has_text_frame:print(shape.text)
   if shape.has_table:
    for row in shape.table.rows:print(' | '.join(cell.text.replace('\\n',' / ') for cell in row.cells))
for file in sorted(Path('/files').glob('*.docx')):
 print('\\n# '+file.name)
 doc=Document(file)
 for element in doc.element.body.iterchildren():
  if element.tag.endswith('}p'):print(Paragraph(element,doc).text)
  elif element.tag.endswith('}tbl'):
   for row in Table(element,doc).rows:print(' | '.join(cell.text.replace('\\n',' / ') for cell in row.cells))`,
    ],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  if (extraction.status !== 0) throw Error("Office text extraction failed");
  await save("case/deliverable-text.md", extraction.stdout);
  const original = await db.researchTask.findUniqueOrThrow({
    where: { id: originalId },
    include: { brief: true },
  });
  await saveJson("comparison/original-task.json", {
    id: original.id,
    status: original.status,
    brief: original.brief,
    plan: original.plan,
  });
  const briefs = await db.researchBrief.findMany({
    where: { projectId: original.projectId },
    orderBy: { revision: "asc" },
  });
  await saveJson("comparison/original-brief-versions.json", briefs);
  const intake = await db.researchTask.findMany({
    where: { projectId: original.projectId, preset: "intake" },
    orderBy: { createdAt: "asc" },
    include: { stages: true, brief: true },
  });
  await saveJson(
    "comparison/original-intake.json",
    intake.map((t) => ({
      id: t.id,
      createdAt: t.createdAt,
      brief: t.brief,
      stages: t.stages.map((s) => ({
        kind: s.kind,
        text: s.text,
        result: s.result,
      })),
    })),
  );
  const archive = spawnSync(
    "unzip",
    [
      "-p",
      "output/chugao-case-pro-review-20261019.zip",
      "case/OUTPUT_LINEAGE.md",
    ],
    { encoding: "utf8" },
  );
  if (archive.status === 0)
    await save("comparison/previous-case-lineage.md", archive.stdout);
  const previousNames = spawnSync(
    "unzip",
    ["-Z1", "output/chugao-case-pro-review-20261019.zip"],
    { encoding: "utf8" },
  );
  for (const name of previousNames.stdout
    .split("\n")
    .filter((value) => /^results\/[^/]+$/.test(value))) {
    const result = spawnSync(
      "unzip",
      ["-p", "output/chugao-case-pro-review-20261019.zip", name],
      { maxBuffer: 16 * 1024 * 1024 },
    );
    if (result.status === 0)
      await save(`comparison/previous-${name}`, result.stdout);
  }
  const topFiles = [
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "next-env.d.ts",
    "start.sh",
    "next.config.ts",
    "next.config.mjs",
    "tsconfig.json",
    "postcss.config.mjs",
    "eslint.config.mjs",
    "middleware.ts",
    ".env.example",
    ".gitignore",
    ".dockerignore",
    "Dockerfile",
    "Dockerfile.worker",
    "Caddyfile",
    "docker-compose.yml",
    "docker-compose.research.yml",
    "README.md",
    "CODEX_ADAPTATION.md",
    "docs/RESEARCH_WORKSPACE.md",
    "docs/CHAT_RUNTIME.md",
    "vitest.config.ts",
    "vitest.research.config.ts",
    "vitest.chat.config.ts",
  ];
  const sourceFiles = [];
  for (const folder of [
    "app",
    "components",
    "lib",
    "prisma",
    "scripts",
    "services",
    "deploy",
    "styles",
    "workers",
    "public/studio",
    "validation",
  ]) {
    try {
      sourceFiles.push(...(await list(path.join(root, folder))));
    } catch {
      /* Optional folder. */
    }
  }
  for (const file of topFiles) {
    try {
      await readFile(file);
      sourceFiles.push(path.join(root, file));
    } catch {
      /* Optional configuration. */
    }
  }
  sourceFiles.push(path.join(root, "docs/RESEARCH_QUALITY_V2_INTEGRATION.md"));
  const changes = [];
  let patch = "";
  for (const file of [...new Set(sourceFiles)].sort()) {
    const relative = path.relative(root, file);
    if (
      /\.(log|pyc|pdf|zip|sqlite|db)$/.test(relative) ||
      (/(^|\/)\.env($|\.)/.test(relative) && relative !== ".env.example")
    )
      continue;
    const bytes = await readFile(file);
    const textual = !/\.(png|jpg|jpeg|gif|webp|ttc|woff2?)$/i.test(file);
    await save(`source/${relative}`, textual ? bytes.toString("utf8") : bytes);
    let baseline: Buffer | null = null;
    try {
      baseline = await readFile(path.join(candidate, relative));
    } catch {
      /* New local file. */
    }
    if (!baseline?.equals(bytes)) {
      changes.push({
        path: relative,
        status: baseline ? "modified" : "added",
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
      if (textual) {
        const result = spawnSync(
          "diff",
          [
            "-u",
            "-L",
            baseline ? `a/${relative}` : "/dev/null",
            "-L",
            `b/${relative}`,
            baseline ? path.join(candidate, relative) : "/dev/null",
            file,
          ],
          { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
        );
        if (result.status === 1) patch += result.stdout + "\n";
      }
    }
  }
  await save("changes/local-adaptation.patch", patch);
  await saveJson("changes/comparison-to-pro-candidate.json", changes);
  for (const file of await list(
    path.join(root, "output/research-v2-integration"),
  )) {
    const relative = path.relative(
      path.join(root, "output/research-v2-integration"),
      file,
    );
    if (
      !/^(qa\/original-|research-(desktop-completed|mobile-completed|preview-verified)\.png$|browser-(network-probe|completion-checks)\.json$|baseline-comparison\.json$|injected-production-failure\.json$|quality-evidence-fixture-replay\.json$|cross-language\/cross-language-proposal-result\.json$)/.test(
        relative,
      )
    )
      continue;
    await save(`validation/${relative}`, await readFile(file));
  }
  await saveJson(
    "validation/acceptance-state.json",
    JSON.parse(
      await readFile(".data/research/acceptance-v2-original.json", "utf8"),
    ),
  );
  await saveJson("validation/review-snapshot.json", {
    createdAt: new Date().toISOString(),
    primary,
    control,
    originalTaskId: originalId,
    latestExporterVersion: "2.0.3",
    actualTaskExporterVersion: "2.0.2 with adaptive status-column layout",
    boundaries: [
      "No raw upstream HTTP wire capture was stored.",
      "Reasoning items, encrypted continuations, credentials and unrelated user data are excluded.",
      "Engine inputs are allowlisted; gateway token and uploaded binary payloads are excluded.",
      "Public model outputs and tool arguments are real retained records, not reconstructed hidden reasoning.",
      "Pipeline success does not establish market research correctness; final quality is draft.",
    ],
  });
  const runtime = spawnSync(
    "docker",
    ["compose", "-f", "docker-compose.research.yml", "ps"],
    { encoding: "utf8" },
  );
  await save("validation/docker-status.txt", runtime.stdout);
  await saveJson("REDACTIONS.json", {
    files: [...redactions].map(([file, passes]) => ({ file, passes })),
    excluded: [
      ".env",
      "private storage outside these two cases",
      "database dumps",
      "gateway tokens",
      "continuationEnc",
      "reasoning items",
      "node_modules",
      "build output",
    ],
  });
  const manifest = [];
  for (const file of await list(output)) {
    const relative = path.relative(output, file);
    if (relative === "MANIFEST.json") continue;
    const bytes = await readFile(file);
    const text =
      /\.(md|json|jsonl|ts|tsx|js|mjs|py|yaml|yml|toml|patch|txt|conf|sql)$/.test(
        relative,
      )
        ? bytes.toString("utf8")
        : "";
    if (
      /\bsk-[A-Za-z0-9_-]{20,}\b/.test(text) ||
      secrets.some((secret) => text.includes(secret))
    )
      throw Error(`Sensitive value remained in ${relative}`);
    manifest.push({
      path: relative,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  await saveJson("MANIFEST.json", manifest);
  console.log(
    JSON.stringify(
      {
        output,
        files: manifest.length,
        primary,
        control,
        sourceChanges: changes.length,
        redactedFiles: redactions.size,
      },
      null,
      2,
    ),
  );
}
main().finally(() => db.$disconnect());
