import { randomUUID } from "node:crypto";
import { db } from "../lib/db";
import { getResearchConfig } from "../lib/research/config";
import { getChatProfile } from "../lib/chat-profiles";
import { chatCompatibleResearchResponse } from "../lib/research/gateway";
import { researchJson } from "../lib/research/errors";

async function main() {
  if (!process.argv.includes("--live-one"))
    throw Error(
      "Pass --live-one to authorize exactly one synthetic model request.",
    );
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(
      new URL(process.env.DATABASE_URL!).hostname,
    )
  )
    throw Error("This probe is local-only.");
  const profile = await getChatProfile("gpt-6.1-sol");
  if (!profile.enabled || !profile.apiKey)
    throw Error("Sol is not configured.");
  const config = await getResearchConfig();
  const user = await db.user.create({
    data: {
      email: `research-probe-${randomUUID()}@example.invalid`,
      passwordHash: randomUUID(),
      role: "ADMIN",
      credits: 0,
    },
  });
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  try {
    const project = await db.researchProject.create({
      data: { userId: user.id, title: "Synthetic gateway probe" },
    });
    const brief = await db.researchBrief.create({
      data: {
        projectId: project.id,
        revision: 1,
        content: { question: "Synthetic addition" },
      },
    });
    const task = await db.researchTask.create({
      data: {
        projectId: project.id,
        briefId: brief.id,
        userId: user.id,
        clientRequestId: randomUUID(),
        inputHash: randomUUID(),
        preset: "explore",
        scope: "exploratory",
        modelId: "gpt-6.1-sol",
        reasoningEffort: "low",
        status: "running",
        executionToken: randomUUID(),
        heartbeatAt: new Date(),
        deadlineAt: new Date(Date.now() + 150000),
        configSnapshot: researchJson({
          ...config,
          modelSnapshot: { baseUrl: profile.baseUrl, model: profile.model },
        }),
        plan: {
          limits: { llm: 1, search: 0, crawl: 0, minutes: 3 },
          stages: [],
          products: [],
        },
      },
    });
    const stage = await db.researchStage.create({
      data: {
        taskId: task.id,
        ordinal: 0,
        kind: "probe",
        engine: "gateway",
        status: "running",
      },
    });
    const attempt = await db.researchAttempt.create({
      data: { stageId: stage.id, ordinal: 1, status: "running" },
    });
    await db.researchStage.update({
      where: { id: stage.id },
      data: { activeAttemptId: attempt.id },
    });
    heartbeat = setInterval(() => {
      void db.researchTask
        .update({ where: { id: task.id }, data: { heartbeatAt: new Date() } })
        .catch(() => {});
    }, 4000);
    const started = Date.now();
    const response = await chatCompatibleResearchResponse(
      attempt.id,
      {
        model: "gpt-6.1-sol",
        stream: true,
        stream_options: { include_usage: true },
        messages: [
          {
            role: "user",
            content:
              "Compute 2 + 3 and call deliver_probe exactly once. Set answer to ok and sum to 5. Do not search.",
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "deliver_probe",
              description: "Return the synthetic protocol check.",
              strict: true,
              parameters: {
                type: "object",
                properties: {
                  answer: { type: "string" },
                  sum: { type: "integer" },
                },
                required: ["answer", "sum"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "deliver_probe" } },
        max_completion_tokens: 1500,
      },
      AbortSignal.timeout(150000),
    );
    const wire = await response.text();
    let args = "";
    let name = "";
    let chunks = 0;
    for (const frame of wire.split("\n\n")) {
      const data = frame
        .split("\n")
        .find((line) => line.startsWith("data: "))
        ?.slice(6);
      if (!data || data === "[DONE]") continue;
      const value = JSON.parse(data);
      if (value.error) throw Error(JSON.stringify(value.error));
      for (const tool of value.choices?.[0]?.delta?.tool_calls ?? []) {
        name ||= tool.function?.name ?? "";
        args += tool.function?.arguments ?? "";
        chunks++;
      }
    }
    const value = JSON.parse(args);
    if (
      name !== "deliver_probe" ||
      value.answer !== "ok" ||
      value.sum !== 5 ||
      !wire.includes("[DONE]")
    )
      throw Error(
        "The actual streamed function response did not match the schema.",
      );
    const calls = await db.researchCall.findMany({
      where: { taskId: task.id },
      select: { status: true, usage: true, costBasis: true },
    });
    console.log(
      JSON.stringify(
        { ok: true, elapsedMs: Date.now() - started, chunks, calls },
        null,
        2,
      ),
    );
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    const taskWhere = { task: { userId: user.id } };
    await db.researchCall.deleteMany({ where: taskWhere });
    await db.researchEvent.deleteMany({ where: taskWhere });
    await db.researchArtifact.deleteMany({ where: taskWhere });
    await db.researchEvidence.deleteMany({ where: taskWhere });
    await db.researchAttempt.deleteMany({
      where: { stage: { task: { userId: user.id } } },
    });
    await db.researchStage.deleteMany({ where: taskWhere });
    await db.researchTask.deleteMany({ where: { userId: user.id } });
    await db.researchBrief.deleteMany({
      where: { project: { userId: user.id } },
    });
    await db.researchProject.deleteMany({ where: { userId: user.id } });
    await db.user.delete({ where: { id: user.id } });
  }
}
main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
