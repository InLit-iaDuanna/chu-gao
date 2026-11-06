// Explicit offline contract examples. These are not production assistant replies.
import {
  researchIntakeResultSchema,
  researchPlanInputSchema,
  type ResearchIntakeView,
  type ResearchTaskView,
} from "@/lib/research/types";
import { task } from "./ResearchWorkspace.fixture";

export const intakeInput = () =>
  researchPlanInputSchema.parse({
    brief: { question: "研究一款便携饮料的包装设计" },
  });
export const emptyIntakeView = (): ResearchIntakeView => ({
  task: null,
  messages: [],
  result: null,
  resultTaskId: null,
  latestClientRequestId: null,
  settings: null,
});
export function intakeView({
  id = "intake-1",
  projectId = "project-1",
  status = "completed",
  answer = "我想研究一款便携饮料的包装设计。",
  reply = "我会围绕包装设计展开。你最希望这次研究帮助决定什么？",
  ready = false,
  summary = "研究便携饮料的包装设计。",
  previous = emptyIntakeView(),
  market = "",
  unknowns = [],
  suggestions = [],
  clientRequestId,
}: {
  id?: string;
  projectId?: string;
  status?: string;
  answer?: string;
  reply?: string;
  ready?: boolean;
  summary?: string;
  previous?: ResearchIntakeView;
  market?: string;
  unknowns?: string[];
  suggestions?: string[];
  clientRequestId?: string;
} = {}): ResearchIntakeView {
  const input = intakeInput();
  input.brief.market = market;
  const result = researchIntakeResultSchema.parse({
    contractVersion: "intake-dialogue-v1",
    nextQuestion: ready ? null : reply.slice(reply.indexOf("。") + 1),
    confirmedRequirements: [answer],
    unknowns,
    reply,
    suggestions,
    ready,
    summary,
    products: input.products,
    brief: input.brief,
  });
  const saved = task();
  const intakeTask: ResearchTaskView = {
    ...saved,
    id,
    projectId,
    status,
    preset: "intake",
    plan: {
      ...saved.plan,
      limits: { llm: 3, search: 0, crawl: 0, minutes: 4 },
    },
    brief: input.brief,
    stages: [
      {
        id: `${id}-stage`,
        kind: "intake",
        engine: "chugao",
        status,
        text: status === "completed" ? result.reply : "",
        result: status === "completed" ? result : null,
        activeAttemptId: `${id}-attempt`,
        attempts: [{ id: `${id}-attempt`, ordinal: 1, status, error: null }],
      },
    ],
    artifacts: [],
    evidence: [],
    error: status === "failed" ? { message: "整理暂时失败" } : null,
  };
  return {
    task: intakeTask,
    messages: [
      ...previous.messages,
      { id: `${id}-user`, role: "user", content: answer },
      ...(status === "completed"
        ? [{ id, role: "assistant" as const, content: result.reply }]
        : []),
    ],
    result: status === "completed" ? result : previous.result,
    resultTaskId: status === "completed" ? id : previous.resultTaskId,
    latestClientRequestId: clientRequestId ?? null,
    settings: null,
  };
}

