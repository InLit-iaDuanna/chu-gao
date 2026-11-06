import { ok } from "@/lib/api-response";
import { audit } from "@/lib/audit";
import {
  researchAdmin,
  researchBody,
  researchFailure,
} from "@/lib/research/http";
import { researchHealth } from "@/lib/research/health";
import { researchConfigSchema, setResearchConfig } from "@/lib/research/config";
import { db } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const auth = await researchAdmin(request);
  if (auth.response) return auth.response;
  try {
    const health = await researchHealth();
    const tasks = await db.researchTask.findMany({
      orderBy: { createdAt: "desc" },
      take: 30,
      select: {
        id: true,
        projectId: true,
        preset: true,
        status: true,
        modelId: true,
        llmCalls: true,
        searchCalls: true,
        crawlCalls: true,
        createdAt: true,
        finishedAt: true,
        project: { select: { title: true } },
        calls: {
          select: {
            kind: true,
            costUsd: true,
            costBasis: true,
            status: true,
            startedAt: true,
            finishedAt: true,
          },
        },
      },
    });
    return ok({ ...health, tasks });
  } catch (error) {
    return researchFailure(error);
  }
}
export async function PATCH(request: Request) {
  const auth = await researchAdmin(request);
  if (auth.response) return auth.response;
  try {
    const config = await setResearchConfig(
      await researchBody(request, researchConfigSchema),
    );
    await audit({
      actorId: auth.userId!,
      action: "admin.research.update",
      target: "research.config",
      diff: config,
      request,
    });
    return ok(config);
  } catch (error) {
    return researchFailure(error);
  }
}
