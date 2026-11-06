import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { assertRedisReady, getRedis } from "@/lib/redis";
import { LUNA_MODEL_ID } from "@/lib/chat-model-options";

// Uses only a temporary verification account and self-authored sample messages.
async function main() {
  assert.equal(process.argv[2], "--confirm-3-requests");
  const origin = process.env.CHAT_PROBE_ORIGIN;
  assert.ok(
    origin &&
      /^http:\/\/(?:chugao-chat-candidate|127\.0\.0\.1):\d+$/.test(origin),
  );
  const marker = randomUUID();
  const password = randomUUID() + randomUUID();
  const email = `chat-probe-${marker}@example.invalid`;
  const account = await db.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash(password, 10),
      name: "Temporary Chat Verification",
      credits: 1,
      role: "USER",
    },
    select: { id: true },
  });
  const ids: string[] = [];
  let cookie = "";
  let paidRequests = 0;
  const request = (path: string, body?: unknown) =>
    fetch(`${origin}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-host": "chugao.art",
        "User-Agent": "Chugao-Chat-Verification/1.0",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "manual",
      signal: AbortSignal.timeout(220_000),
    });
  const json = async (path: string, body?: unknown) => {
    const response = await request(path, body);
    const result = await response.json();
    assert.equal(response.status, 200, `${path}: ${JSON.stringify(result)}`);
    assert.equal(result.ok, true, path);
    return result.data;
  };
  const conversation = async (title: string) => {
    const data = await json("/api/conversations", { title });
    ids.push(data.id);
    return data.id as string;
  };
  const chat = async (id: string, prompt: string, webSearch: boolean) => {
    paidRequests += 1;
    console.log(
      JSON.stringify({
        event: "paid_request_start",
        mode: webSearch ? "web" : "render",
        paidRequests,
      }),
    );
    const response = await request("/api/conversations/chat", {
      conversationId: id,
      messages: [{ role: "user", content: prompt }],
      modelId: LUNA_MODEL_ID,
      reasoningEffort: "low",
      webSearch,
    });
    assert.equal(response.status, 200);
    const raw = await response.text();
    const events = raw.split(/\r?\n\r?\n/).flatMap((block) => {
      const event = block.match(/^event: (.+)$/m)?.[1];
      const data = block.match(/^data: (.+)$/m)?.[1];
      return event && data ? [{ event, data: JSON.parse(data) }] : [];
    });
    const error = events.find((item) => item.event === "error");
    assert.ok(!error, JSON.stringify(error?.data));
    assert.ok(events.some((item) => item.event === "done"));
    assert.ok(events.some((item) => item.event === "context"));
    const billing = events.find((item) => item.event === "billing");
    assert.equal(billing?.data.credits, 0.2);
    const text = events
      .filter((item) => item.event === "delta")
      .map((item) => item.data.content)
      .join("");
    assert.ok(text.trim());
    await json(`/api/conversations/${id}/messages`, {
      messages: [
        { role: "user", content: prompt },
        { role: "assistant", content: text },
      ],
    });
    return { text, balance: billing.data.balance };
  };
  try {
    const login = await request("/api/auth/login", { email, password });
    assert.equal(login.status, 200);
    cookie = login.headers
      .getSetCookie()
      .map((value) => value.split(";", 1)[0])
      .join("; ");
    assert.ok(cookie);
    const catalog = await json("/api/conversations/chat");
    const luna = catalog.models.find(
      (model: { id: string }) => model.id === LUNA_MODEL_ID,
    );
    assert.equal(luna?.credits, 0.2);
    assert.equal(luna?.supportsWebSearch, true);

    const id = await conversation("Chat verification: web and rendering");
    const web = await chat(
      id,
      "这是自建联网功能测试。请实际联网核对 GitHub 的 remarkjs/react-markdown 仓库名称和主页链接，一句中文回答，引用来源。",
      true,
    );
    assert.equal(web.balance, 0.8);
    assert.match(web.text, /https:\/\/github\.com\/remarkjs\/react-markdown/i);
    assert.match(web.text, /参考来源/);
    console.log(
      JSON.stringify({
        mode: "web",
        ok: true,
        balance: web.balance,
        answerCharacters: web.text.length,
      }),
    );

    const render = await chat(
      id,
      "这是自建渲染功能测试。请只输出：一个 Markdown 二级标题、两行两列 Markdown 表格，以及一个完整 HTML 代码块。HTML 用内联 CSS 展示“功能验证通过”，不使用脚本、外部资源或图片。尽量简短。",
      false,
    );
    assert.equal(render.balance, 0.6);
    assert.match(render.text, /^## /m);
    assert.match(render.text, /```html[\s\S]*<[^>]+>/i);
    assert.match(render.text, /\|.+\|/);
    console.log(
      JSON.stringify({
        mode: "render",
        ok: true,
        balance: render.balance,
        answerCharacters: render.text.length,
      }),
    );

    const contextId = await conversation("Chat verification: summary");
    const detail =
      "项目只用于功能测试。青禾咖啡夏季海报，竖版3:4，薄荷绿主色，自然摄影，保留原有品牌标志，标题为夏日慢下来，不出现价格，不用卡通风。窗边木桌上一杯冰拿铁，旁边一片绿叶，左侧留白，下午自然光。下一步需要两套构图方案，先不生成图片。";
    const samples = Array.from({ length: 16 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: `样例消息 ${index + 1}。${detail.repeat(3)}`,
    }));
    for (let index = 0; index < samples.length; index += 8)
      await json(`/api/conversations/${contextId}/messages`, {
        messages: samples.slice(index, index + 8),
      });
    const before = await json(
      `/api/conversations/context?conversationId=${contextId}`,
    );
    assert.equal(before.messageCount, 16);
    assert.equal(before.canCompact, true);
    paidRequests += 1;
    console.log(
      JSON.stringify({
        event: "paid_request_start",
        mode: "summary",
        paidRequests,
      }),
    );
    const after = await json("/api/conversations/context", {
      conversationId: contextId,
      modelId: LUNA_MODEL_ID,
    });
    assert.equal(after.messageCount, 16);
    assert.ok(after.compactedMessages >= 8);
    assert.ok(after.estimatedTokens < before.estimatedTokens);
    assert.match(after.summary, /3[:：]4/);
    assert.match(after.summary, /薄荷绿/);
    assert.equal(
      await db.conversationMessage.count({
        where: { conversationId: contextId },
      }),
      16,
    );
    const balance = await db.user.findUniqueOrThrow({
      where: { id: account.id },
      select: { credits: true },
    });
    assert.equal(balance.credits, 0.6);
    const longText = "Long reply persistence sample. ".repeat(220);
    const saved = await json(`/api/conversations/${id}/messages`, {
      messages: [{ role: "assistant", content: longText }],
    });
    assert.equal(saved.messages.at(-1).content, longText.trim());
    console.log(
      JSON.stringify({
        mode: "summary",
        ok: true,
        originalMessages: 16,
        compactedMessages: after.compactedMessages,
        tokensBefore: before.estimatedTokens,
        tokensAfter: after.estimatedTokens,
        balance: balance.credits,
        longReplyCharacters: longText.trim().length,
      }),
    );
  } finally {
    await assertRedisReady();
    for (const conversationId of ids) {
      const digest = createHash("sha256")
        .update(JSON.stringify([account.id, conversationId]))
        .digest("hex");
      await getRedis().del(
        `chat-context:v1:{${digest}}:summary`,
        `chat-context:v1:{${digest}}:lock`,
      );
    }
    await db.$transaction(async (tx) => {
      await tx.usageLog.deleteMany({ where: { userId: account.id } });
      await tx.auditLog.deleteMany({ where: { actorId: account.id } });
      await tx.user.delete({ where: { id: account.id } });
    });
    console.log(
      JSON.stringify({
        cleanup: "completed",
        paidRequests,
        testAccountRemoved: true,
      }),
    );
  }
}

main()
  .catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : "Chat verification failed",
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
    if (globalThis.__redis__) globalThis.__redis__.disconnect();
  });
