import { fail, ok } from "@/lib/api-response";
import { adminFailureResponse, checkSession } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  GENERATION_STATUSES,
  isGenerationStatus,
} from "@/lib/generations";

function msBetween(start: Date | null, end: Date | null) {
  if (!start) {
    return null;
  }

  return (end ?? new Date()).getTime() - start.getTime();
}

export async function GET(request: Request) {
  const sessionResult = await checkSession(request);
  const failure = adminFailureResponse(sessionResult);

  if (failure) {
    return failure;
  }

  if (!process.env.DATABASE_URL) {
    return fail("SERVICE_UNAVAILABLE", "生成服务未配置数据库", { status: 503 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const statuses = searchParams
      .getAll("status")
      .flatMap((value) => value.split(","))
      .filter(isGenerationStatus);
    const userId = searchParams.get("userId");
    const q = searchParams.get("q")?.trim();
    const modelId = searchParams.get("modelId")?.trim();
    const providerId = searchParams.get("providerId")?.trim();
    const providerAccountId = searchParams.get("providerAccountId")?.trim();
    const errorCode = searchParams.get("errorCode")?.trim();
    const activeOnly = searchParams.get("active") === "true";
    const limit = Math.min(
      Math.max(Number(searchParams.get("limit") ?? 100), 1),
      200,
    );
    const generations = await db.generation.findMany({
      where: {
        ...(statuses.length
          ? { status: { in: statuses } }
          : activeOnly
            ? { status: { in: ["PENDING", "RUNNING"] } }
            : {}),
        ...(userId ? { userId } : {}),
        ...(modelId ? { modelId } : {}),
        ...(providerId ? { providerId } : {}),
        ...(providerAccountId ? { providerAccountId } : {}),
        ...(errorCode ? { errorCode } : {}),
        ...(q
          ? {
              OR: [
                { prompt: { contains: q, mode: "insensitive" as const } },
                { id: { contains: q, mode: "insensitive" as const } },
                {
                  user: {
                    OR: [
                      { email: { contains: q, mode: "insensitive" as const } },
                      { name: { contains: q, mode: "insensitive" as const } },
                    ],
                  },
                },
              ],
            }
          : {}),
      },
      include: {
        images: true,
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
        provider: {
          select: {
            id: true,
            name: true,
          },
        },
        providerAccount: {
          select: {
            id: true,
            name: true,
            baseUrl: true,
            health: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return ok({
      items: generations.map((generation) => ({
        id: generation.id,
        userId: generation.userId,
        user: generation.user,
        modelId: generation.modelId,
        prompt: generation.prompt,
        status: generation.status,
        provider: generation.provider,
        providerId: generation.providerId,
        providerAccount: generation.providerAccount,
        providerAccountId: generation.providerAccountId,
        jobId: generation.jobId,
        costCredits: generation.costCredits,
        attempts: generation.attempts,
        createdAt: generation.createdAt,
        startedAt: generation.startedAt,
        finishedAt: generation.finishedAt,
        queueMs: msBetween(generation.createdAt, generation.startedAt),
        runMs: msBetween(generation.startedAt, generation.finishedAt),
        totalMs: msBetween(generation.createdAt, generation.finishedAt),
        errorCode: generation.errorCode,
        errorMessage: generation.errorMessage,
        aspectRatio: generation.aspectRatio,
        resolution: generation.resolution,
        n: generation.n,
        outputFormat: generation.outputFormat,
        imageCount: generation.images.length,
        isStuck:
          (generation.status === "PENDING" &&
            Date.now() - generation.createdAt.getTime() > 10 * 60_000) ||
          (generation.status === "RUNNING" &&
            generation.startedAt !== null &&
            Date.now() - generation.startedAt.getTime() > 10 * 60_000),
      })),
      statuses: GENERATION_STATUSES,
    });
  } catch (error) {
    return fail("INTERNAL_ERROR", "任务列表读取失败", {
      status: 500,
      details: error instanceof Error ? error.message : "unknown",
    });
  }
}
