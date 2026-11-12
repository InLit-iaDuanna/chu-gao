import type { Prisma } from "@prisma/client";
import { fail, ok } from "@/lib/api-response";
import { adminFailureResponse, checkSession } from "@/lib/auth";
import { serializeAdminModelCall } from "@/lib/admin-model-call";
import { db } from "@/lib/db";

export async function GET(request: Request) {
  const failure = adminFailureResponse(await checkSession(request));
  if (failure) return failure;
  const params = new URL(request.url).searchParams;
  const kind = params.get("kind");
  const source = params.get("source");
  const status = params.get("status");
  if (
    (kind && !["image", "llm"].includes(kind)) ||
    (source && !["web", "api", "agent", "system"].includes(source)) ||
    (status && !["RUNNING", "SUCCEEDED", "FAILED"].includes(status))
  ) {
    return fail("VALIDATION_ERROR", "调用记录筛选条件不正确", { status: 400 });
  }
  const rawLimit = Number(params.get("limit") ?? 50);
  const take = Number.isFinite(rawLimit)
    ? Math.min(100, Math.max(1, Math.floor(rawLimit)))
    : 50;
  let cursor: { startedAt: Date; id: string } | undefined;
  if (params.get("cursor")) {
    try {
      const value = JSON.parse(
        Buffer.from(
          params.get("cursor")!.slice(0, 1000),
          "base64url",
        ).toString(),
      );
      if (
        !Array.isArray(value) ||
        value.length !== 2 ||
        typeof value[0] !== "string" ||
        typeof value[1] !== "string" ||
        value[1].length > 200
      )
        throw new Error();
      cursor = { startedAt: new Date(value[0]), id: value[1] };
      if (!Number.isFinite(cursor.startedAt.getTime())) throw new Error();
    } catch {
      return fail("VALIDATION_ERROR", "分页位置不正确", { status: 400 });
    }
  }
  const from = params.get("from");
  const to = params.get("to");
  for (const value of [from, to]) {
    if (
      value &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        !Number.isFinite(new Date(`${value}T00:00:00+08:00`).getTime()))
    )
      return fail("VALIDATION_ERROR", "日期不正确", { status: 400 });
    if (
      value &&
      new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value
    )
      return fail("VALIDATION_ERROR", "日期不正确", { status: 400 });
  }
  try {
    const q = params.get("q")?.trim().slice(0, 200);
    const users = q
      ? await db.user.findMany({
          where: {
            OR: [
              { email: { contains: q, mode: "insensitive" } },
              { name: { contains: q, mode: "insensitive" } },
            ],
          },
          select: { id: true, email: true, name: true },
        })
      : [];
    const where: Prisma.ModelCallLogWhereInput = {
      ...(kind ? { kind } : {}),
      ...(source ? { source } : {}),
      ...(status ? { status } : {}),
      ...(params.get("generationId")
        ? { generationId: params.get("generationId")! }
        : {}),
      ...(params.get("providerId")
        ? { providerId: params.get("providerId")! }
        : {}),
      ...(params.get("modelId") ? { modelId: params.get("modelId")! } : {}),
      ...(params.get("operation")
        ? { operation: params.get("operation")! }
        : {}),
      ...(params.get("errorCategory")
        ? { errorCategory: params.get("errorCategory")! }
        : {}),
      AND: [
        ...(q
          ? [
              {
                OR: [
                  ...[
                    "id",
                    "generationId",
                    "requestId",
                    "chatAttemptId",
                    "conversationId",
                    "modelId",
                    "providerName",
                    "errorMessage",
                  ].map((key) => ({
                    [key]: { contains: q, mode: "insensitive" as const },
                  })),
                  ...(users.length
                    ? [{ userId: { in: users.map((user) => user.id) } }]
                    : []),
                ],
              },
            ]
          : []),
        ...(from || to
          ? [
              {
                startedAt: {
                  ...(from ? { gte: new Date(`${from}T00:00:00+08:00`) } : {}),
                  ...(to
                    ? {
                        lt: new Date(
                          new Date(`${to}T00:00:00+08:00`).getTime() +
                            86_400_000,
                        ),
                      }
                    : {}),
                },
              },
            ]
          : []),
        ...(cursor
          ? [
              {
                OR: [
                  { startedAt: { lt: cursor.startedAt } },
                  { startedAt: cursor.startedAt, id: { lt: cursor.id } },
                ],
              },
            ]
          : []),
      ],
    };
    const rows = await db.modelCallLog.findMany({
      where,
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      take: take + 1,
    });
    const items = rows.slice(0, take);
    const userIds = [
      ...new Set(items.flatMap((item) => (item.userId ? [item.userId] : []))),
    ];
    const usersById = new Map(
      (
        await db.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, email: true, name: true },
        })
      ).map((user) => [user.id, user]),
    );
    const last = items.at(-1);
    return ok({
      items: items.map((item) =>
        serializeAdminModelCall(
          item,
          item.userId ? (usersById.get(item.userId) ?? null) : null,
          { includeContent: false },
        ),
      ),
      nextCursor:
        rows.length > take && last
          ? Buffer.from(
              JSON.stringify([last.startedAt.toISOString(), last.id]),
            ).toString("base64url")
          : null,
    });
  } catch {
    return fail("INTERNAL_ERROR", "调用记录读取失败", { status: 500 });
  }
}
