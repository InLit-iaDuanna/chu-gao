import { getLunaConfig } from "@/lib/luna-config";
import { LUNA_MODEL_ID } from "@/lib/chat-model-options";
import {
  chatEndpoint,
  lunaRequestBody,
  readLunaStreamEvent,
} from "@/lib/chat-upstream";
import { chatSystemInstructions } from "@/lib/chat-instructions";
import {
  createContextSummarizer,
  estimateTextTokens,
} from "@/lib/chat-context-summary";
import { db } from "@/lib/db";

async function main() {
  const mode = process.argv[2];
  if (mode !== "web" && mode !== "summary") {
    throw new Error(
      "Specify web or summary; each mode makes one paid upstream request.",
    );
  }
  if (mode === "summary") {
    const summarize = await createContextSummarizer(LUNA_MODEL_ID);
    const summary = await summarize(
      [
        {
          role: "user",
          content:
            "这是功能验证样例，不是真实用户历史。项目是青禾咖啡的夏季海报，竖版3:4，主色薄荷绿，海报标题为夏日慢下来，必须保留品牌原有标志，不出现价格，不要卡通风。",
        },
        {
          role: "assistant",
          content:
            "已确认使用薄荷绿和自然摄影，竖版3:4，保留原标志，不加价格和卡通元素。待确认拍摄场景。",
        },
        {
          role: "user",
          content:
            "确认使用窗边木桌场景，主体是一杯冰拿铁，旁边可以有一片绿叶。保留标题和品牌标志，下一步需要两套构图方案。",
        },
      ],
      null,
    );
    console.log(
      JSON.stringify({
        mode,
        ok: Boolean(summary),
        estimatedTokens: estimateTextTokens(summary),
        summary,
      }),
    );
    return;
  }
  const config = await getLunaConfig();
  if (!config.enabled || !config.apiKey)
    throw new Error("Luna is not configured.");
  const response = await fetch(chatEndpoint(config.baseUrl, true), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
      Accept: "application/json",
    },
    body: JSON.stringify(
      lunaRequestBody(
        [
          {
            role: "user",
            content:
              "请实际调用联网搜索，核对 GitHub 上 remarkjs/react-markdown 的项目名称和主页地址。用一句中文回答并引用来源。不要使用已有知识代替检索。",
          },
        ],
        chatSystemInstructions("这是联网工具的自建功能验证样例。", true),
        "low",
        { webSearch: true, maxOutputTokens: 4096, stream: false },
      ),
    ),
    signal: AbortSignal.timeout(120_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof payload?.error?.message === "string"
        ? payload.error.message
            .replaceAll(config.apiKey, "[REDACTED]")
            .replace(/sk-[a-z\d_-]+/gi, "[REDACTED]")
            .slice(0, 500)
        : null;
    console.log(
      JSON.stringify({
        mode,
        ok: false,
        status: response.status,
        errorType: payload?.error?.type,
        message,
      }),
    );
    process.exitCode = 1;
    return;
  }
  const result = readLunaStreamEvent({
    type: "response.completed",
    response: payload,
  });
  console.log(
    JSON.stringify({
      mode,
      ok: result.completed && result.searched,
      status: response.status,
      searched: result.searched,
      outputTypes: Array.isArray(payload?.output)
        ? payload.output.map((item: { type?: string; status?: string }) => ({
            type: item.type,
            status: item.status,
          }))
        : [],
      answer: result.finalText,
      usage: payload?.usage,
    }),
  );
  if (!result.completed || !result.searched) process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Probe failed");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
