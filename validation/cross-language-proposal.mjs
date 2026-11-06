/**
 * Actual offline TS -> Python -> TS contract replay, without a model or database.
 * Run from the project root:
 *   node --import tsx validation/cross-language-proposal.mjs
 * Python needs the sidecar's langchain-core/httpx/fastapi and Office dependencies.
 * Optional: CHUGAO_REPLAY_PYTHON and CHUGAO_REPLAY_EXTRA_PYTHONPATH (path-separated).
 * The latter appends existing dependency folders; it installs/modifies nothing.
 * All evidence, requirements and hypotheses are explicitly synthetic fixtures.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const load = async (name) => {
  const module = await import(name);
  return module.default ?? module;
};
const { packEvidenceContext, assessResearchQuality } = await load(
  "../lib/research/quality.ts",
);
const {
  createFinalResearchPackage,
  readFinalResearchPackage,
  researchDeliverablesSchemaV2,
} = await load("../lib/research/workflow-quality.ts");
const { validateRemoteProposal, validateRemoteArtifactBytes } = await load(
  "../lib/research/artifact-contract.ts",
);

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.resolve(
  root,
  process.env.CHUGAO_REPLAY_OUTPUT ??
    "output/research-v2-integration/cross-language",
);
const resultPath = path.join(output, "cross-language-proposal-result.json");
const checks = [];
const check = (name, action) => {
  action();
  checks.push(name);
};
const json = async (name) => JSON.parse(await fs.readFile(name, "utf8"));
const writeJson = async (name, value) =>
  fs.writeFile(name, JSON.stringify(value, null, 2) + "\n");

// The replay does not call fetch or start a service. Fail if later edits add fetch.
globalThis.fetch = () => {
  throw new Error("Network is disabled in this offline replay");
};

async function main() {
  await fs.mkdir(output, { recursive: true });
  const fixtures = path.join(root, "services/research-runtime/tests/fixtures");
  const originalInput = await json(
    path.join(fixtures, "proposal_v2_input.json"),
  );
  const proposal = await json(path.join(fixtures, "proposal_v2.json"));
  const externalUrl = "https://example.com/fixture/office-lunch";
  const fetchedAt = "2000-01-01T00:00:00.000Z";
  const attachmentId = "fixture-user-text";
  const attachmentClaim =
    "这段用户材料仅用于跨语言合同验收，不能作为独立市场证据。";
  const requirements =
    originalInput.finalResearchPackage.finalBrief.confirmedRequirements;
  const brief = {
    question: "比较办公室轻食设备、分量容器与加热设备；离线跨语言合同验收",
    audience: "离线格式测试，不代表真实用户调研",
    constraints: "仅验证证据与产物合同；不得宣称完成新市场研究",
    links: [externalUrl],
  };
  const rows = [
    {
      id: "fixture-01",
      originalUrl: externalUrl,
      title: "离线合同夹具：办公室轻食设备（非真实调研证据）",
      status: "captured",
      fetchedAt,
      excerpt: "办公室轻食设备与分量容器的离线测试资料。",
      content:
        "办公室轻食设备与分量容器：离线跨语言合同夹具。\n" +
        "这条内容只验证来源编号、超链接与证据版本能否正确导出。\n" +
        "本段不是实际网页抓取内容，不证明真实产品性能或市场需求。" +
        "fetchedAt 是模拟时间，仅用于验证字段传递与准确标签。",
    },
    {
      id: attachmentId,
      originalUrl: "attachment:fixture_document_contract",
      title: "离线用户材料夹具.txt",
      status: "provided",
      fetchedAt: null,
      excerpt: "办公室午餐需求与分量管理的合成用户材料。",
      content:
        attachmentClaim + "\n这是合成测试输入，不是用户实际上传的新材料。",
    },
  ];
  const packed = packEvidenceContext(rows, brief, {
    maxChars: 32000,
    perSourceChars: 4000,
    focus: "办公室轻食设备 分量容器 用户材料 合同验收",
  });
  check("both actual TS packed source kinds retained", () => {
    assert.equal(packed.sources.length, 2);
    const external = packed.sources.find((item) => item.id === "fixture-01");
    const provided = packed.sources.find((item) => item.id === attachmentId);
    assert.equal(external.contentKind, "captured_text");
    assert.equal(external.sourceAvailability, "captured");
    assert.equal(external.fetchedAt, fetchedAt);
    assert.equal(provided.contentKind, "user_provided_text");
    assert.equal(provided.sourceAvailability, "captured");
    assert.equal(provided.fetchedAt, null);
  });
  const report =
    "# 离线跨语言合同验收\n\n这不是新完成的市场调研。" +
    "\n外部链接仅为保留域名夹具 [source:fixture-01]。" +
    `\n合成用户文本 [source:${attachmentId}] 不是独立市场证据。`;
  const quality = assessResearchQuality({
    evidence: rows,
    brief,
    reportText: report,
    allowedEvidenceIds: packed.sources.map((item) => item.id),
    executionCompleted: true,
    unresolvedQuestions: 1,
  });
  check("actual quality gate preserves draft limitation", () =>
    assert.notEqual(quality.status, "supported"),
  );
  const metadata = researchDeliverablesSchemaV2.parse({
    finalBrief: {
      goal: "验证办公室轻食设备离线提案的跨语言合同",
      scope: "合成来源与需求；不执行市场调研、用户访谈或性能测试",
      alternatives: [],
      acceptanceCriteria: ["所有文件保留证据编号、来源类型、版本与使用限制"],
      openQuestions: ["真实市场需求与产品性能不属于此次回放的验收范围"],
    },
    hypotheses: originalInput.finalResearchPackage.hypotheses,
    caveats: [
      "这是离线跨语言合同夹具，不是新完成的市场调研。",
      "外部链接、用户材料和时间字段均为合成测试输入，不代表实际采集。",
    ],
    competitors: [],
  });
  // Mirrors the worker's bounded, automatic caveat merge before package creation.
  metadata.caveats = [
    ...new Set([
      ...metadata.caveats,
      ...quality.issues.map((item) => item.message),
    ]),
  ];
  const finalPackage = createFinalResearchPackage({
    taskId: "fixture-cross-language-task",
    briefId: "fixture-cross-language-brief",
    stageId: "fixture-cross-language-synthesis",
    attemptId: "fixture-cross-language-attempt",
    report,
    metadata,
    confirmedRequirements: requirements,
    quality,
    evidenceManifest: packed.manifest,
    evidence: packed.sources,
    generatedAt: "2000-01-02T00:00:00.000Z",
  });
  check("genuine TS content hash and strict package reader roundtrip", () => {
    assert.match(finalPackage.version, /^[a-f0-9]{64}$/);
    assert.deepEqual(
      readFinalResearchPackage(JSON.parse(JSON.stringify(finalPackage))),
      finalPackage,
    );
  });
  check("changed timestamp retains package version", () => {
    assert.deepEqual(
      readFinalResearchPackage({
        ...finalPackage,
        generatedAt: "2000-01-03T00:00:00.000Z",
      })?.version,
      finalPackage.version,
    );
  });
  check("changed source behind old version rejected", () => {
    const changed = structuredClone(finalPackage);
    changed.evidence[0].fetchedAt = "2000-01-04T00:00:00.000Z";
    assert.equal(readFinalResearchPackage(changed), null);
  });
  proposal.package_version = finalPackage.version;
  proposal.title = "离线跨语言合同验收：办公室轻食设备";
  proposal.subtitle =
    "真实运行 TS 打包、Python 导出与 TS 文件导入校验；来源与市场内容均为合成夹具。";
  proposal.slides.at(-1).claims.push({
    text: attachmentClaim,
    status: "observed",
    evidence_ids: [attachmentId],
  });
  proposal.caveats = metadata.caveats.slice(0, 2);
  const input = {
    runId: "fixture-cross-language-export",
    products: ["pptx", "docx", "html"],
    research: finalPackage.report.text,
    brief: finalPackage.finalBrief,
    evidence: finalPackage.evidence,
    finalResearchPackage: finalPackage,
    files: [],
  };
  await writeJson(path.join(output, "source-rows.json"), rows);
  await writeJson(path.join(output, "input.json"), input);
  await writeJson(path.join(output, "proposal.json"), proposal);
  const python =
    process.env.CHUGAO_REPLAY_PYTHON ??
    process.env.CODEX_PRIMARY_RUNTIME_PYTHON ??
    "python";
  const child = spawnSync(
    python,
    [path.join(root, "validation/cross-language-proposal.py"), output],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 90000,
      maxBuffer: 1024 * 1024,
      env: {
        ...process.env,
        LANGSMITH_TRACING: "false",
        LANGCHAIN_TRACING_V2: "false",
        OTEL_SDK_DISABLED: "true",
      },
    },
  );
  await fs.writeFile(
    path.join(output, "python-replay.log"),
    child.stdout + child.stderr,
  );
  if (child.error) throw child.error;
  assert.equal(
    child.status,
    0,
    `Python replay failed: ${child.stderr.slice(-5000)}`,
  );
  const pythonResult = await json(path.join(output, "python-result.json"));
  checks.push(...pythonResult.checks);
  const remote = await json(path.join(output, "remote-response.json"));
  const importInput = {
    result: remote.result,
    files: remote.files,
    packageVersion: finalPackage.version,
    evidenceIds: finalPackage.evidence.map((item) => item.id),
    requestedFormats: input.products,
  };
  const validated = validateRemoteProposal(importInput);
  check("actual sidecar manifest/listing accepted by TS importer", () => {
    assert.equal(remote.status, "completed");
    assert.equal(validated.files.length, 3);
    assert.deepEqual(
      new Set(validated.evidenceIds),
      new Set(["fixture-01", attachmentId]),
    );
  });
  const bytes = new Map();
  for (const entry of validated.files) {
    const data = await fs.readFile(
      path.join(output, "sidecar-runs", input.runId, "outputs", entry.name),
    );
    validateRemoteArtifactBytes(entry, data);
    bytes.set(entry.name, data);
    checks.push(
      `actual ${entry.format} download bytes match manifest SHA-256 and byte length`,
    );
  }
  check("actual artifact with same-size changed bytes rejected", () => {
    const entry = validated.files[0];
    const changed = Buffer.from(bytes.get(entry.name));
    changed[0] ^= 1;
    assert.throws(
      () => validateRemoteArtifactBytes(entry, changed),
      /原子清单/,
    );
  });
  check("different final package version rejected by TS importer", () => {
    const changed = structuredClone(importInput);
    changed.result.packageVersion =
      (finalPackage.version[0] === "a" ? "b" : "a") +
      finalPackage.version.slice(1);
    assert.throws(() => validateRemoteProposal(changed), /终稿版本/);
  });
  check("source outside retained final package rejected by TS importer", () => {
    const changed = structuredClone(importInput);
    changed.result.evidenceIds.push("fixture-unretained-source");
    assert.throws(() => validateRemoteProposal(changed), /终稿包以外/);
  });
  check("missing requested format rejected by TS importer", () => {
    const changed = structuredClone(importInput);
    changed.files.pop();
    assert.throws(() => validateRemoteProposal(changed), /所需格式/);
  });
  const result = {
    schemaVersion: 1,
    status: "passed",
    checksPassed: checks.length,
    checks,
    boundary:
      "Offline actual-code contract replay using synthetic inputs; no new market research, model calls, database access, HTTP server, browser rendering or production deployment.",
    calls: { model: 0, database: 0, externalNetwork: 0 },
    packageVersion: finalPackage.version,
    reportHash: finalPackage.report.hash,
    exporterVersion: pythonResult.exporterVersion,
    exportHash: pythonResult.exportHash,
    sourceProjection: packed.sources.map(
      ({ id, contentKind, sourceAvailability, fetchedAt }) => ({
        id,
        contentKind,
        sourceAvailability,
        fetchedAt,
      }),
    ),
    qualityStatus: finalPackage.quality.status,
    actualPythonEntryPoint: pythonResult.entryPoint,
    actualSidecarReader: "runtime_contracts.load_proposal_bundle + app.get_run",
    sidecarResultBoundary:
      "Engine final result shape constructed from the actual validated manifest; DeerFlow planning and astream_events are not invoked.",
    artifactManifest: validated.files,
    structures: pythonResult.structures,
    outputDirectory: path.relative(root, output),
  };
  await writeJson(resultPath, result);
  console.log(
    JSON.stringify(
      {
        status: result.status,
        checksPassed: result.checksPassed,
        packageVersion: result.packageVersion,
        exportHash: result.exportHash,
        result: path.relative(root, resultPath),
      },
      null,
      2,
    ),
  );
}

await main().catch(async (error) => {
  await writeJson(resultPath, {
    schemaVersion: 1,
    status: "failed",
    checksPassed: checks.length,
    checks,
    error: String(error),
    boundary: "Offline contract replay; no production changes.",
  });
  console.error(error);
  process.exitCode = 1;
});
