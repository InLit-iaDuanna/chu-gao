import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { assertRedisReady, getRedis } from "@/lib/redis";
import {
  LUNA_MODEL_ID,
  REASONING_EFFORTS,
  type ReasoningEffort,
} from "@/lib/chat-model-options";

async function main() {
  const webSearch = process.argv.includes("--web");
  const directRoute = process.argv.includes("--direct-route");
  assert.equal(
    process.argv[2],
    webSearch ? "--confirm-2-requests" : "--confirm-1-request",
  );
  const effort = process.argv[3] as ReasoningEffort;
  assert.ok(REASONING_EFFORTS.includes(effort));
  const origin = process.env.CHAT_PROBE_ORIGIN;
  assert.ok(
    origin === "http://chugao-stream-candidate:3000" ||
      origin === "https://chugao.art",
  );
  const email = `stream-probe-${randomUUID()}@example.invalid`;
  const password = randomUUID() + randomUUID();
  const account = await db.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash(password, 10),
      name: "Temporary Stream Verification",
      credits: 1,
      role: "USER",
    },
    select: { id: true },
  });
  let conversationId: string | undefined;
  let cookie = "";
  const directPost = directRoute
    ? (await import("@/app/api/conversations/chat/route")).POST
    : undefined;
  const request = (path: string, body?: unknown) => {
    const init: RequestInit = {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-host": "chugao.art",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "manual",
      signal: AbortSignal.timeout(240_000),
    };
    return path === "/api/conversations/chat" && directPost
      ? directPost(new Request(`${origin}${path}`, init))
      : fetch(`${origin}${path}`, init);
  };
  const json = async (path: string, body?: unknown) => {
    const response = await request(path, body);
    const payload = await response.json();
    assert.equal(response.status, 200, `${path}: ${JSON.stringify(payload)}`);
    assert.equal(payload.ok, true);
    return payload.data;
  };
  try {
    const login = await request("/api/auth/login", { email, password });
    assert.equal(login.status, 200);
    cookie = login.headers
      .getSetCookie()
      .map((value) => value.split(";", 1)[0])
      .join("; ");
    assert.ok(cookie);
    const thread = await json("/api/conversations", {
      title: "Stream verification sample",
    });
    conversationId = thread.id;
    const prompt = webSearch
      ? "这是自建联网流式功能验证。请实际检索 GitHub remarkjs/react-markdown 的项目名称和主页链接，简短回答并引用来源。"
      : "这是自建流式功能验证，不是真实用户历史。请直接给出五条咖啡店产品陈列建议，每条一句，约150个中文字，不需要前言或分析。";
    const started = performance.now();
    console.log(
      JSON.stringify({
        event: "paid_request_start",
        effort,
        webSearch,
        origin,
        directRoute,
      }),
    );
    const response = await request("/api/conversations/chat", {
      conversationId,
      modelId: LUNA_MODEL_ID,
      reasoningEffort: effort,
      webSearch,
      messages: [{ role: "user", content: prompt }],
    });
    assert.equal(response.status, 200);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let answer = "";
    let deltas = 0;
    let chunks = 0;
    let replaces = 0;
    let done = false;
    let firstDeltaMs: number | undefined;
    let doneMs: number | undefined;
    let billing:
      | { credits: number; balance: number; refunded: boolean }
      | undefined;
    let failure: string | undefined;
    const dispatch = (frame: string) => {
      const event = frame.match(/^event: (.+)$/m)?.[1];
      const text = frame.match(/^data: (.+)$/m)?.[1];
      if (!event || !text) return;
      const data = JSON.parse(text);
      if (event === "billing") billing = data;
      if (event === "delta") {
        answer += data.content;
        deltas += 1;
        if (firstDeltaMs === undefined && answer.trim()) {
          firstDeltaMs = Math.round(performance.now() - started);
          console.log(
            JSON.stringify({
              event: "first_delta",
              effort,
              webSearch,
              ms: firstDeltaMs,
            }),
          );
        }
      }
      if (event === "replace") {
        answer = data.content;
        replaces += 1;
      }
      if (event === "error") failure = data.message;
      if (event === "done") {
        done = true;
        doneMs = Math.round(performance.now() - started);
      }
    };
    try {
      while (!done && !failure) {
        const part = await reader.read();
        if (part.value) chunks += 1;
        buffer += decoder.decode(part.value, { stream: !part.done });
        let boundary: RegExpExecArray | null;
        while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
          dispatch(buffer.slice(0, boundary.index));
          buffer = buffer.slice(boundary.index + boundary[0].length);
        }
        if (part.done) break;
      }
    } finally {
      void reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    assert.ok(!failure, failure);
    assert.ok(done && firstDeltaMs !== undefined && doneMs !== undefined);
    assert.ok(firstDeltaMs < doneMs);
    assert.ok(
      deltas > 1 && chunks > 1,
      `Not incremental: ${deltas} deltas in ${chunks} chunks`,
    );
    assert.equal(billing?.credits, 0.2);
    assert.equal(billing?.balance, 0.8);
    assert.equal(billing?.refunded, false);
    assert.ok(answer.trim());
    assert.ok(replaces <= 1);
    if (webSearch) {
      assert.match(answer, /参考来源/);
      assert.match(answer, /https:\/\/github\.com\/remarkjs\/react-markdown/i);
    }
    await json(`/api/conversations/${conversationId}/messages`, {
      messages: [
        { role: "user", content: prompt },
        { role: "assistant", content: answer },
      ],
    });
    assert.equal(
      await db.conversationMessage.count({ where: { conversationId } }),
      2,
    );
    assert.equal(
      (
        await db.user.findUniqueOrThrow({
          where: { id: account.id },
          select: { credits: true },
        })
      ).credits,
      0.8,
    );
    console.log(
      JSON.stringify({
        ok: true,
        effort,
        webSearch,
        origin,
        firstDeltaMs,
        doneMs,
        deltas,
        chunks,
        replaces,
        characters: answer.length,
        credits: billing.credits,
        balance: billing.balance,
      }),
    );
  } finally {
    try {
      if (conversationId) {
        await assertRedisReady();
        const digest = createHash("sha256")
          .update(JSON.stringify([account.id, conversationId]))
          .digest("hex");
        await getRedis().del(
          `chat-context:v1:{${digest}}:summary`,
          `chat-context:v1:{${digest}}:lock`,
        );
      }
    } finally {
      await db.$transaction(async (tx) => {
        await tx.usageLog.deleteMany({ where: { userId: account.id } });
        await tx.auditLog.deleteMany({ where: { actorId: account.id } });
        await tx.user.delete({ where: { id: account.id } });
      });
      console.log(
        JSON.stringify({ cleanup: "completed", testAccountRemoved: true }),
      );
    }
  }
}

main()
  .catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Stream verification failed",
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
    globalThis.__redis__?.disconnect();
    globalThis.__rateLimitRedis__?.disconnect();
  });
