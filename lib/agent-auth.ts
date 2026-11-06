import { createHash, randomBytes } from "node:crypto";
import type { AgentAuthorization, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { fail } from "@/lib/api-response";
import { getClientIp } from "@/lib/network";
import { checkUserActionRateLimit } from "@/lib/rate-limit";

export const AGENT_CLIENT_ID = "chugao-skill";
export const AGENT_SCOPE = "images:generate images:read images:upload";
export const DEVICE_CODE_SECONDS = 600;
export const MAX_AUTHORIZATION_HOURS = 30 * 24;

export class AgentAuthError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 401,
  ) {
    super(message);
  }
}

export function secretHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizeUserCode(value: string): string {
  const code = value.replace(/[-\s]/g, "").toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code))
    throw new AgentAuthError("INVALID_CODE", "授权码无效", 400);
  return code;
}

export function authorizationExpiry(
  mode: string,
  durationHours?: number,
  now = new Date(),
) {
  if (mode !== "single" && mode !== "timed")
    throw new AgentAuthError("VALIDATION_ERROR", "请选择授权方式", 400);
  const hours = mode === "single" ? 24 : durationHours;
  if (
    hours === undefined ||
    !Number.isInteger(hours) ||
    hours < 1 ||
    hours > MAX_AUTHORIZATION_HOURS
  )
    throw new AgentAuthError(
      "VALIDATION_ERROR",
      "授权时间必须为 1 小时至 30 天",
      400,
    );
  return new Date(now.getTime() + hours * 3_600_000);
}

function verificationOrigin(request: Request) {
  const url = new URL(request.url);
  if (process.env.NODE_ENV !== "production") return url.origin;
  const hostname = process.env.AUTH_CANONICAL_HOST || "chugao.art";
  return `https://${hostname}`;
}

export async function agentIpRateLimit(
  request: Request,
  action: string,
  limit: number,
) {
  const decision = await checkUserActionRateLimit(
    `agent-ip:${getClientIp(request.headers) ?? "unknown"}`,
    action,
    limit,
  );
  if (!decision.allowed)
    throw new AgentAuthError("RATE_LIMITED", "请求过于频繁，请稍后重试", 429);
}

export async function createDeviceAuthorization(
  request: Request,
  clientName: string,
) {
  const deviceCode = randomBytes(32).toString("base64url");
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const raw = [...randomBytes(8)]
    .map((byte) => alphabet[byte % alphabet.length])
    .join("");
  const userCode = `${raw.slice(0, 4)}-${raw.slice(4)}`;
  await db.agentDeviceAuthorization.create({
    data: {
      deviceCodeHash: secretHash(deviceCode),
      userCodeHash: secretHash(raw),
      clientName,
      expiresAt: new Date(Date.now() + DEVICE_CODE_SECONDS * 1000),
    },
  });
  const verificationUri = `${verificationOrigin(request)}/app/agent/authorize`;
  return {
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: verificationUri,
    verification_uri_complete: `${verificationUri}?user_code=${userCode}`,
    expires_in: DEVICE_CODE_SECONDS,
    interval: 5,
  };
}

export async function findDeviceAuthorization(userCode: string) {
  const row = await db.agentDeviceAuthorization.findUnique({
    where: { userCodeHash: secretHash(normalizeUserCode(userCode)) },
  });
  if (!row)
    throw new AgentAuthError("INVALID_CODE", "授权码不存在或已失效", 404);
  return row;
}

export async function decideDeviceAuthorization(input: {
  userCode: string;
  userId: string;
  sessionVersion: number;
  decision: "approve" | "deny";
  mode?: string;
  durationHours?: number;
}) {
  const codeHash = secretHash(normalizeUserCode(input.userCode));
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`agent-device:${codeHash}`})::bigint)`;
    const row = await tx.agentDeviceAuthorization.findUnique({
      where: { userCodeHash: codeHash },
    });
    if (!row || row.expiresAt.getTime() <= Date.now())
      throw new AgentAuthError(
        "EXPIRED_CODE",
        "授权码已过期，请在 Agent 中重新发起授权",
        410,
      );
    if (row.status !== "pending")
      throw new AgentAuthError("CODE_ALREADY_USED", "这次授权请求已处理", 409);
    const user = await tx.user.findUnique({
      where: { id: input.userId },
      select: { status: true, sessionVersion: true },
    });
    if (!user || user.status !== "ACTIVE")
      throw new AgentAuthError("UNAUTHORIZED", "账户不可用");
    if (user.sessionVersion !== input.sessionVersion)
      throw new AgentAuthError(
        "UNAUTHORIZED",
        "登录状态已失效，请重新登录后授权",
      );
    if (input.decision === "deny") {
      await tx.agentDeviceAuthorization.update({
        where: { id: row.id },
        data: { status: "denied" },
      });
      return { status: "denied" as const };
    }
    const expiresAt = authorizationExpiry(
      input.mode ?? "timed",
      input.durationHours,
    );
    const grant = await tx.agentAuthorization.create({
      data: {
        userId: input.userId,
        clientName: row.clientName,
        mode: input.mode ?? "timed",
        sessionVersion: input.sessionVersion,
        expiresAt,
      },
    });
    await tx.agentDeviceAuthorization.update({
      where: { id: row.id },
      data: { status: "approved", authorizationId: grant.id },
    });
    return { status: "approved" as const, expiresAt };
  });
}

export async function exchangeDeviceCode(deviceCode: string) {
  const hash = secretHash(deviceCode);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`agent-token:${hash}`})::bigint)`;
    const row = await tx.agentDeviceAuthorization.findUnique({
      where: { deviceCodeHash: hash },
      include: { authorization: { include: { user: true } } },
    });
    if (!row || row.status === "consumed") return { error: "invalid_grant" };
    const now = new Date();
    if (row.expiresAt <= now) return { error: "expired_token" };
    if (row.status === "denied") return { error: "access_denied" };
    if (
      row.lastPolledAt &&
      now.getTime() - row.lastPolledAt.getTime() < row.pollInterval * 1000
    ) {
      await tx.agentDeviceAuthorization.update({
        where: { id: row.id },
        data: { lastPolledAt: now, pollInterval: { increment: 5 } },
      });
      return { error: "slow_down" };
    }
    await tx.agentDeviceAuthorization.update({
      where: { id: row.id },
      data: { lastPolledAt: now },
    });
    if (row.status !== "approved" || !row.authorization)
      return { error: "authorization_pending" };
    const grant = row.authorization;
    if (
      grant.revokedAt ||
      grant.expiresAt <= now ||
      grant.user.status !== "ACTIVE" ||
      grant.sessionVersion !== grant.user.sessionVersion
    )
      return { error: "access_denied" };
    const token = `cg_${randomBytes(32).toString("base64url")}`;
    await tx.agentAuthorization.update({
      where: { id: grant.id },
      data: { tokenHash: secretHash(token) },
    });
    await tx.agentDeviceAuthorization.update({
      where: { id: row.id },
      data: { status: "consumed" },
    });
    return {
      access_token: token,
      token_type: "Bearer",
      expires_in: Math.max(
        1,
        Math.floor((grant.expiresAt.getTime() - now.getTime()) / 1000),
      ),
      scope: AGENT_SCOPE,
    };
  });
}

export type AgentPrincipal = {
  authorization: AgentAuthorization;
  user: { id: string; email: string; credits: number };
};

export function assertActiveAuthorization(
  grant: Pick<AgentAuthorization, "revokedAt" | "expiresAt" | "sessionVersion">,
  user: { status: string; sessionVersion: number },
) {
  if (
    grant.revokedAt ||
    grant.expiresAt.getTime() <= Date.now() ||
    user.status !== "ACTIVE" ||
    grant.sessionVersion !== user.sessionVersion
  )
    throw new AgentAuthError(
      "AUTHORIZATION_EXPIRED",
      "授权已到期或已撤销，请重新授权",
    );
}

export async function requireAgent(request: Request): Promise<AgentPrincipal> {
  const match = /^Bearer (cg_[A-Za-z0-9_-]{43})$/i.exec(
    request.headers.get("authorization") ?? "",
  );
  if (!match)
    throw new AgentAuthError("UNAUTHORIZED", "请先在浏览器授权 Chugao Skill");
  const grant = await db.agentAuthorization.findUnique({
    where: { tokenHash: secretHash(match[1]) },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          credits: true,
          status: true,
          sessionVersion: true,
        },
      },
    },
  });
  if (!grant)
    throw new AgentAuthError("UNAUTHORIZED", "授权凭证无效，请重新授权");
  assertActiveAuthorization(grant, grant.user);
  if (!grant.lastUsedAt || Date.now() - grant.lastUsedAt.getTime() > 60_000)
    await db.agentAuthorization.update({
      where: { id: grant.id },
      data: { lastUsedAt: new Date() },
    });
  return {
    authorization: grant,
    user: {
      id: grant.user.id,
      email: grant.user.email,
      credits: grant.user.credits,
    },
  };
}

// Called inside the generation transaction, after taking the same per-user lock.
export async function assertAgentSubmission(
  tx: Prisma.TransactionClient,
  authorizationId: string,
  userId: string,
  replayId?: string,
) {
  const grant = await tx.agentAuthorization.findFirst({
    where: { id: authorizationId, userId },
    include: { user: { select: { status: true, sessionVersion: true } } },
  });
  if (!grant) throw new AgentAuthError("UNAUTHORIZED", "授权不存在");
  assertActiveAuthorization(grant, grant.user);
  if (
    grant.mode === "single" &&
    grant.boundGenerationId &&
    grant.boundGenerationId !== replayId
  )
    throw new AgentAuthError(
      "SINGLE_TASK_USED",
      "本次授权已用于一个任务，请重新授权",
      403,
    );
  return grant;
}

export async function bindAgentRead(
  principal: AgentPrincipal,
  generationId: string,
) {
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${principal.user.id})::bigint)`;
    const grant = await assertAgentSubmission(
      tx,
      principal.authorization.id,
      principal.user.id,
      generationId,
    );
    if (grant.mode === "single" && !grant.boundGenerationId)
      await tx.agentAuthorization.update({
        where: { id: grant.id },
        data: { boundGenerationId: generationId },
      });
  });
}

export function agentErrorResponse(error: unknown) {
  if (error instanceof AgentAuthError)
    return fail(error.code, error.message, { status: error.status });
  return fail("SERVICE_UNAVAILABLE", "Agent 服务暂不可用，请稍后重试", {
    status: 503,
  });
}
