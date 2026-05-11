import bcrypt from "bcryptjs";

import { fail, ok } from "@/lib/api-response";
import type { SessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { attachSessionCookie } from "@/lib/session-cookie";
import { loginSchema } from "@/lib/validators";

export async function POST(request: Request) {
  const json = (await request.json()) as unknown;
  const parsed = loginSchema.safeParse(json);

  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "登录参数不合法", {
      status: 400,
      details: parsed.error.flatten(),
    });
  }

  if (!process.env.DATABASE_URL) {
    return fail("AUTH_UNAVAILABLE", "认证服务暂时不可用", { status: 503 });
  }

  let user: {
    id: string;
    email: string;
    passwordHash: string;
    role: "USER" | "ADMIN";
    status: "ACTIVE" | "BANNED";
    sessionVersion: number;
    name: string | null;
    credits: number;
  } | null;

  try {
    user = await db.user.findUnique({
      where: { email: parsed.data.email },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        role: true,
        status: true,
        sessionVersion: true,
        name: true,
        credits: true,
      },
    });
  } catch {
    return fail("AUTH_UNAVAILABLE", "认证服务暂时不可用", { status: 503 });
  }

  if (
    !user ||
    !(await bcrypt.compare(parsed.data.password, user.passwordHash))
  ) {
    return fail("UNAUTHORIZED", "邮箱或密码错误", { status: 401 });
  }

  if (user.status !== "ACTIVE") {
    return fail("FORBIDDEN", "账号不可用", { status: 403 });
  }

  const sessionUser: SessionUser = {
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
    sessionVersion: user.sessionVersion,
  };
  const response = ok({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    credits: user.credits,
  });

  return attachSessionCookie(response, sessionUser);
}
