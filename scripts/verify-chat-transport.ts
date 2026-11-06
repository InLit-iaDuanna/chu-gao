import { createHash, randomBytes } from "node:crypto";
import {
  createServer,
  request as httpRequest,
  type ServerResponse,
} from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import { createParser } from "eventsource-parser";

export const MAX_UPSTREAM_REQUESTS = 24;
export const SOL_MODEL = "gpt-6.1-sol";
export const FIXTURE_TEXT =
  "\u4f60\u597d \ud83c\udf08 Synthetic answer.\nWhitespace stays.  \n\nDone.";
export const FIXTURE_PARTIAL = "Synthetic partial.  \nDo not discard this.";
export const FIXTURE_SUMMARY =
  "Synthetic summary: preserve anchor SYNTHETIC_ANCHOR_731 and the approved count 7.";
export const FIXTURE_SOURCE = "https://example.org/synthetic-evidence";

type ObjectValue = Record<string, unknown>;
export const object = (value: unknown): ObjectValue =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as ObjectValue)
    : {};
export const array = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface TransportPlan {
  label: string;
  kind:
    | "plain"
    | "web"
    | "web-idle"
    | "citation"
    | "partial"
    | "malformed"
    | "cancel"
    | "reconnect"
    | "non-sse"
    | "no-usage"
    | "summary"
    | "probe"
    | "html"
    | "html-partial"
    | "markdown";
  web?: boolean;
  effort?: string;
}

export interface TransportCapture {
  label: string;
  kind: TransportPlan["kind"];
  body: ObjectValue;
  requestHash: string;
  contractErrors: string[];
  httpStatus: number;
  responseStatus: string | null;
  rawText: string;
  finalRawText: string | null;
  annotations: unknown[];
  usage: ObjectValue | null;
  searched: boolean;
  contentType: string;
  injected: boolean;
  held: boolean;
  done: boolean;
  protocolError: boolean;
}

interface WaitingPlan extends TransportPlan {
  release: () => void;
  released: Promise<void>;
}

export class AcceptanceError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export function check(condition: unknown, code: string): asserts condition {
  if (!condition) throw new AcceptanceError(code);
}

// Loopback control traffic must not inherit a caller's proxy dispatcher either.
export async function directLoopbackRequest(
  url: string,
  init: RequestInit = {},
) {
  const target = new URL(url);
  check(
    target.protocol === "http:" && target.hostname === "127.0.0.1",
    "CONTROL_REQUEST_MUST_BE_LOOPBACK",
  );
  check(
    init.body === undefined || typeof init.body === "string",
    "CONTROL_BODY_MUST_BE_JSON_TEXT",
  );
  return new Promise<Response>((resolveResponse, reject) => {
    const req = httpRequest(target, {
      method: init.method ?? "GET",
      agent: false,
      headers: Object.fromEntries(new Headers(init.headers)),
      signal: init.signal ?? undefined,
    });
    req.once("error", reject);
    req.once("response", (incoming) => {
      const headers = new Headers();
      for (let index = 0; index < incoming.rawHeaders.length; index += 2)
        headers.append(
          incoming.rawHeaders[index],
          incoming.rawHeaders[index + 1],
        );
      resolveResponse(
        new Response(
          incoming.statusCode === 204
            ? null
            : (Readable.toWeb(incoming) as ReadableStream<Uint8Array>),
          {
            status: incoming.statusCode ?? 502,
            headers,
          },
        ),
      );
    });
    req.end(init.body);
  });
}

export function responseText(payload: unknown): string {
  return array(object(payload).output)
    .flatMap((item) => {
      const row = object(item);
      return row.type === "message"
        ? array(row.content).flatMap((part) => {
            const value = object(part);
            const text = value.type === "refusal" ? value.refusal : value.text;
            return typeof text === "string" ? [text] : [];
          })
        : [];
    })
    .join("");
}

function inputText(body: ObjectValue) {
  return (
    array(body.input)
      .filter((row) => object(row).role === "user")
      .flatMap((row) =>
        array(object(row).content).flatMap((part) => {
          const text = object(part).text;
          return typeof text === "string" ? [text] : [];
        }),
      )
      .at(-1) ?? ""
  );
}

function wireContract(
  body: ObjectValue,
  plan: TransportPlan,
  encoding?: string,
) {
  const errors: string[] = [];
  const require = (value: unknown, code: string) => {
    if (!value) errors.push(code);
  };
  require(body.model === SOL_MODEL, "SOL_MODEL");
  require(body.stream === true &&
    body.store === false, "NATIVE_STREAM_STORE_FALSE");
  require(encoding === "identity", "IDENTITY_ENCODING");
  require(typeof body.instructions === "string", "INSTRUCTIONS");
  require(Array.isArray(body.input) && body.input.length > 0, "TYPED_INPUT");
  for (const value of array(body.input)) {
    const row = object(value);
    require(row.type === "message" &&
      ["system", "user", "assistant"].includes(
        String(row.role),
      ), "TYPED_MESSAGE");
    require(Array.isArray(row.content) &&
      row.content.length > 0, "TYPED_CONTENT");
    for (const value of array(row.content)) {
      const part = object(value);
      require(part.type ===
        (row.role === "assistant" ? "output_text" : "input_text") ||
        (row.role === "user" && part.type === "input_image"), "CONTENT_ROLE");
    }
  }
  require(object(body.reasoning).effort ===
    (plan.effort ?? "low"), "REASONING_EFFORT");
  require(body.max_output_tokens ===
    (plan.kind === "summary" ? 2048 : 4096), "OUTPUT_BUDGET");
  if (plan.web) {
    require(JSON.stringify(body.tools) ===
      '[{"type":"web_search"}]', "NATIVE_WEB_SEARCH");
    require(body.tool_choice === "auto" &&
      JSON.stringify(body.include) === "[]", "NATIVE_WEB_OPTIONS");
  } else
    require(!array(body.tools).length &&
      body.tool_choice === undefined, "NO_UNREQUESTED_SEARCH");
  return errors;
}

// One transport owns every provider call, including summaries and optional probes.
// http(s).request uses a direct socket, ignores proxy env vars, and never retries
// or follows redirects. The real credential never reaches the app or scratch DB.
export async function startAcceptanceTransport(options: {
  real?: { endpoint: URL; key: string };
  maxRequests: number;
  interactivePrompt: string;
}) {
  check(
    Number.isInteger(options.maxRequests) &&
      options.maxRequests > 0 &&
      options.maxRequests <= MAX_UPSTREAM_REQUESTS,
    "INVALID_REQUEST_BUDGET",
  );
  const token = randomBytes(32).toString("base64url");
  const plans = new Map<string, WaitingPlan[]>();
  const allPlans: WaitingPlan[] = [];
  const captures: TransportCapture[] = [];
  const pending = new Set<Promise<void>>();
  const outbound = new Set<ReturnType<typeof httpRequest>>();
  let calls = 0;
  let actualCalls = 0;
  let denied = 0;
  let closing = false;
  let sentinelBase = "";
  let statusUrl = "";
  const sentinelHits: Record<string, number> = {};
  let unexpectedRequests = 0;
  const stats = () => ({
    maxRequests: options.maxRequests,
    calls,
    actualCalls,
    denied,
    remaining: options.maxRequests - calls,
    unexpectedRequests,
    htmlMockRequests: captures.filter((row) =>
      ["html", "html-partial", "markdown"].includes(row.kind),
    ).length,
    sentinelRequests: Object.values(sentinelHits).reduce(
      (sum, value) => sum + value,
      0,
    ),
    sentinelHits: { ...sentinelHits },
  });

  const htmlFixture = () =>
    [
      "```html",
      "<!doctype html><html><head><title>Synthetic CSP acceptance</title>",
      `<meta http-equiv="refresh" content="0;url=${sentinelBase}/meta">`,
      `<link rel="stylesheet" href="${sentinelBase}/stylesheet">`,
      `<style>@import url('${sentinelBase}/css-import');body{font:16px sans-serif}.probe{background-image:url('${sentinelBase}/css-image');width:160px;height:80px}</style>`,
      "</head><body><h1>Synthetic HTML preview</h1><p>Viewport sentinel 731</p><div class=probe>CSS probe</div>",
      `<img src="${sentinelBase}/image" onerror="fetch('${sentinelBase}/image-handler')" alt="Synthetic blocked image">`,
      `<iframe src="${sentinelBase}/iframe" title="Synthetic blocked frame"></iframe>`,
      `<form method="POST" action="${sentinelBase}/form"><input name="synthetic" value="731"><button type="submit">Synthetic submit</button></form>`,
      `<script>fetch('${sentinelBase}/script');new Image().src='${sentinelBase}/script-image';document.forms[0].submit();</script>`,
      "</body></html>",
      "```",
    ].join("\n");

  const markdownFixture = () =>
    [
      "# Synthetic Markdown acceptance",
      "",
      "Selection anchor 731 stays in this paragraph while later rows stream.",
      "",
      "```typescript",
      ...Array.from(
        { length: 100 },
        (_, index) =>
          `const sample_${index} = { index: ${index}, label: \"Synthetic fixture <>&\" };`,
      ),
      "```",
      "",
      "| Row | Description | State |",
      "| --- | --- | --- |",
      ...Array.from(
        { length: 70 },
        (_, index) =>
          `| ${index} | Synthetic_${"long_column_".repeat(8)}${index} | complete |`,
      ),
      "",
      "**Synthetic final marker 731.**",
      "",
    ].join("\n");

  const schedule = (key: string, plan: TransportPlan) => {
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const next = { ...plan, release, released };
    plans.set(key, [...(plans.get(key) ?? []), next]);
    allPlans.push(next);
  };
  const observedParts = new WeakMap<
    TransportCapture,
    Map<string, { output: number; content: number; text: string }>
  >();
  const observedItemIds = new WeakMap<TransportCapture, Map<string, number>>();
  const observe = (capture: TransportCapture, payload: unknown) => {
    const event = object(payload);
    const response = object(event.response);
    const parts = observedParts.get(capture) ?? new Map();
    const ids = observedItemIds.get(capture) ?? new Map();
    observedParts.set(capture, parts);
    observedItemIds.set(capture, ids);
    const item = object(event.item);
    const itemId =
      typeof event.item_id === "string"
        ? event.item_id
        : typeof item.id === "string"
          ? item.id
          : "";
    const output =
      typeof event.output_index === "number"
        ? event.output_index
        : (ids.get(itemId) ?? 0);
    if (itemId) ids.set(itemId, output);
    const content =
      typeof event.content_index === "number" ? event.content_index : 0;
    const snapshot = (value: unknown, contentIndex: number) => {
      const part = object(value);
      if (!["output_text", "refusal"].includes(String(part.type))) return;
      const text = part.text ?? part.refusal;
      if (typeof text === "string")
        parts.set(`${output}:${contentIndex}`, {
          output,
          content: contentIndex,
          text,
        });
    };
    if (
      ["response.output_item.added", "response.output_item.done"].includes(
        String(event.type),
      ) &&
      item.type === "message"
    )
      array(item.content).forEach(snapshot);
    if (
      ["response.content_part.added", "response.content_part.done"].includes(
        String(event.type),
      )
    )
      snapshot(event.part, content);
    if (
      ["response.output_text.done", "response.refusal.done"].includes(
        String(event.type),
      )
    )
      snapshot(
        {
          type:
            event.type === "response.refusal.done" ? "refusal" : "output_text",
          text: event.text ?? event.refusal,
        },
        content,
      );
    if (
      ["response.output_text.delta", "response.refusal.delta"].includes(
        String(event.type),
      ) &&
      typeof event.delta === "string"
    ) {
      const key = `${output}:${content}`;
      const previous = parts.get(key)?.text ?? "";
      parts.set(key, { output, content, text: previous + event.delta });
    }
    capture.rawText = [...parts.values()]
      .sort((a, b) => a.output - b.output || a.content - b.content)
      .map((part) => part.text)
      .join("\n\n");
    if (
      event.type === "response.web_search_call.completed" ||
      (object(event.item).type === "web_search_call" &&
        object(event.item).status === "completed")
    )
      capture.searched = true;
    if (event.type === "response.completed") {
      capture.finalRawText = responseText(response);
      capture.responseStatus = String(response.status ?? "completed");
      capture.usage = response.usage ? object(response.usage) : null;
      for (const value of array(response.output)) {
        const item = object(value);
        if (item.type === "web_search_call" && item.status === "completed")
          capture.searched = true;
        for (const part of array(item.content))
          capture.annotations.push(...array(object(part).annotations));
      }
    }
    if (["response.failed", "response.incomplete"].includes(String(event.type)))
      capture.responseStatus = String(
        response.status ??
          (event.type === "response.failed" ? "failed" : "incomplete"),
      );
  };
  const event = (
    res: ServerResponse,
    capture: TransportCapture,
    payload: unknown,
  ) => {
    observe(capture, payload);
    if (!res.destroyed && !res.writableEnded)
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };
  const begin = (res: ServerResponse, capture: TransportCapture) => {
    capture.httpStatus = 200;
    capture.contentType = "text/event-stream";
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      "x-request-id": `synthetic-${capture.label}`,
    });
    res.flushHeaders();
  };
  const waitForRelease = async (plan: WaitingPlan, res: ServerResponse) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onClose!: () => void;
    try {
      await Promise.race([
        plan.released,
        new Promise<void>((resolve) => {
          onClose = resolve;
          res.once("close", onClose);
          timer = setTimeout(resolve, 120_000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      res.off("close", onClose);
    }
  };
  const injectFailure = (
    res: ServerResponse,
    capture: TransportCapture,
    plan: WaitingPlan,
  ) => {
    capture.injected = true;
    if (plan.kind === "partial")
      event(res, capture, {
        type: "response.incomplete",
        response: {
          status: "incomplete",
          incomplete_details: { reason: "max_output_tokens" },
        },
      });
    else res.write("data: {malformed-synthetic-json\n\n");
    res.end();
  };

  const mock = async (
    res: ServerResponse,
    capture: TransportCapture,
    plan: WaitingPlan,
  ) => {
    if (plan.kind === "non-sse") {
      capture.httpStatus = 200;
      capture.contentType = "application/json";
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"output":[],"status":"completed"}');
      return;
    }
    begin(res, capture);
    let sequence = 0;
    const emit = (payload: ObjectValue) =>
      event(res, capture, { ...payload, sequence_number: ++sequence });
    emit({
      type: "response.created",
      response: { id: `synthetic-${plan.label}`, status: "in_progress" },
    });
    const text =
      plan.kind === "html" || plan.kind === "html-partial"
        ? htmlFixture()
        : plan.kind === "markdown"
          ? markdownFixture()
          : plan.kind === "summary"
            ? FIXTURE_SUMMARY
            : ["partial", "malformed", "cancel"].includes(plan.kind)
              ? FIXTURE_PARTIAL
              : FIXTURE_TEXT;
    const searched = plan.kind === "web" || plan.kind === "citation";
    if (searched) {
      emit({
        type: "response.output_item.added",
        output_index: 0,
        item: { id: "search", type: "web_search_call", status: "in_progress" },
      });
      await delay(65);
      emit({
        type: "response.web_search_call.completed",
        output_index: 0,
        item_id: "search",
      });
    }
    const index = searched ? 1 : 0;
    emit({
      type: "response.output_item.added",
      output_index: index,
      item: {
        id: "answer",
        type: "message",
        role: "assistant",
        status: "in_progress",
      },
    });
    // A real delay makes a persisted intermediate checkpoint observable over HTTP.
    const split = Math.min(20, text.length);
    const chunks =
      plan.kind === "markdown"
        ? (text.match(/[\s\S]{1,400}/g) ?? [])
        : [text.slice(0, split), text.slice(split)];
    for (const delta of chunks) {
      emit({
        type: "response.output_text.delta",
        output_index: index,
        content_index: 0,
        item_id: "answer",
        delta,
      });
      await delay(70);
    }
    if (plan.kind === "html-partial") {
      capture.injected = true;
      emit({
        type: "response.incomplete",
        response: {
          status: "incomplete",
          incomplete_details: { reason: "synthetic_partial_html" },
        },
      });
      res.end();
      return;
    }
    if (plan.kind === "partial" || plan.kind === "malformed") {
      injectFailure(res, capture, plan);
      return;
    }
    if (plan.kind === "cancel" || plan.kind === "reconnect") {
      capture.held = true;
      await waitForRelease(plan, res);
      capture.held = false;
    }
    if (res.destroyed || closing) return;
    const annotations =
      plan.kind === "citation"
        ? [
            {
              type: "url_citation",
              start_index: 0,
              end_index: 9,
              url: FIXTURE_SOURCE,
              title: "Synthetic evidence",
            },
          ]
        : [];
    const output: ObjectValue[] = [];
    if (searched)
      output.push({
        id: "search",
        type: "web_search_call",
        status: "completed",
        action: { type: "search", query: "synthetic evidence" },
      });
    output.push({
      id: "answer",
      type: "message",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text, annotations }],
    });
    const usage =
      plan.kind === "no-usage"
        ? {}
        : { usage: { input_tokens: 41, output_tokens: 13, total_tokens: 54 } };
    emit({
      type: "response.completed",
      response: {
        id: `synthetic-${plan.label}`,
        status: "completed",
        output,
        ...usage,
      },
    });
    res.end();
  };

  const forward = async (
    res: ServerResponse,
    capture: TransportCapture,
    plan: WaitingPlan,
    raw: string,
  ) => {
    const real = options.real!;
    // This is the only operation capable of opening an upstream connection.
    check(
      actualCalls < options.maxRequests && calls <= options.maxRequests,
      "UPSTREAM_BUDGET_EXHAUSTED",
    );
    actualCalls++;
    const client =
      real.endpoint.protocol === "https:" ? httpsRequest : httpRequest;
    const req = client(real.endpoint, {
      method: "POST",
      agent: false,
      headers: {
        Authorization: `Bearer ${real.key}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "Accept-Encoding": "identity",
      },
    });
    outbound.add(req);
    const disconnect = () => req.destroy();
    res.once("close", disconnect);
    const deadline = setTimeout(
      () => req.destroy(new Error("upstream_timeout")),
      180_000,
    );
    try {
      const response = await new Promise<import("node:http").IncomingMessage>(
        (resolve, reject) => {
          req.once("response", resolve);
          req.once("error", reject);
          req.end(raw);
        },
      );
      capture.httpStatus = response.statusCode ?? 502;
      capture.contentType = String(response.headers["content-type"] ?? "");
      if (
        capture.httpStatus < 200 ||
        capture.httpStatus >= 300 ||
        !capture.contentType.includes("text/event-stream")
      ) {
        // Never echo provider error bodies, headers, request IDs or credentials.
        res.writeHead(capture.httpStatus >= 400 ? capture.httpStatus : 502, {
          "Content-Type": "application/json",
        });
        res.end('{"error":{"code":"VERIFY_UPSTREAM_REJECTED"}}');
        response.destroy();
        return;
      }
      if (plan.kind === "non-sse") {
        capture.injected = true;
        capture.contentType = "application/json";
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"output":[],"status":"completed"}');
        response.destroy();
        return;
      }
      begin(res, capture);
      let frames: string[] = [];
      const decoder = new TextDecoder();
      const parser = createParser({
        maxBufferSize: 2_000_000,
        onEvent: (frame) => frames.push(frame.data),
        onError: () => {
          capture.protocolError = true;
        },
      });
      let held = false;
      for await (const chunk of response) {
        parser.feed(decoder.decode(chunk as Uint8Array, { stream: true }));
        const batch = frames;
        frames = [];
        for (const data of batch) {
          if (res.destroyed || closing) return;
          if (data === "[DONE]") continue;
          let payload: unknown;
          try {
            payload = JSON.parse(data);
          } catch {
            capture.protocolError = true;
            res.write(`data: ${data}\n\n`);
            continue;
          }
          if (plan.kind === "no-usage" && object(payload).response) {
            const response = { ...object(object(payload).response) };
            delete response.usage;
            payload = { ...object(payload), response };
            capture.injected = true;
          }
          event(res, capture, payload);
          if (!held && capture.rawText.trim()) {
            held = true;
            if (plan.kind === "partial" || plan.kind === "malformed") {
              await delay(80);
              injectFailure(res, capture, plan);
              return;
            }
            if (plan.kind === "cancel" || plan.kind === "reconnect") {
              capture.held = true;
              await waitForRelease(plan, res);
              capture.held = false;
            }
          }
        }
      }
      parser.feed(decoder.decode() + "\n\n");
      for (const data of frames) {
        if (data === "[DONE]") continue;
        try {
          event(res, capture, JSON.parse(data));
        } catch {
          capture.protocolError = true;
        }
      }
      res.end();
    } finally {
      clearTimeout(deadline);
      res.off("close", disconnect);
      outbound.delete(req);
      req.destroy();
    }
  };

  const server = createServer((req, res) => {
    const handle = async () => {
      if (
        statusUrl &&
        req.method === "GET" &&
        req.url === new URL(statusUrl).pathname
      ) {
        res
          .writeHead(200, {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          })
          .end(JSON.stringify(stats()));
        return;
      }
      if (
        sentinelBase &&
        req.url?.startsWith(new URL(sentinelBase).pathname + "/")
      ) {
        const label = req.url.split("/").at(-1)?.split("?")[0] ?? "unknown";
        const allowed = [
          "meta",
          "stylesheet",
          "css-import",
          "css-image",
          "image",
          "image-handler",
          "iframe",
          "form",
          "script",
          "script-image",
        ];
        const kind = allowed.includes(label) ? label : "unknown";
        sentinelHits[kind] = (sentinelHits[kind] ?? 0) + 1;
        res
          .writeHead(200, {
            "Content-Type": "text/plain",
            "Cache-Control": "no-store",
          })
          .end("Synthetic sentinel");
        req.resume();
        return;
      }
      if (
        closing ||
        req.method !== "POST" ||
        req.url !== "/v1/responses" ||
        req.headers.authorization !== `Bearer ${token}`
      ) {
        denied++;
        unexpectedRequests++;
        res.writeHead(403).end();
        return;
      }
      let raw = "";
      for await (const chunk of req) {
        raw += String(chunk);
        check(Buffer.byteLength(raw) <= 4_000_000, "TRANSPORT_BODY_TOO_LARGE");
      }
      const body = object(JSON.parse(raw));
      const probe = req.headers["x-chat-verify-probe"];
      const latest = inputText(body);
      const key =
        typeof probe === "string"
          ? probe
          : body.max_output_tokens === 2048
            ? "summary"
            : [...plans.keys()].find(
                (key) =>
                  key !== "summary" &&
                  (plans.get(key)?.length ?? 0) > 0 &&
                  latest.split(/\r?\n/).includes(key),
              );
      const plan = key
        ? plans.get(key)?.shift()
        : latest.includes(options.interactivePrompt)
          ? {
              label: "interactive-html",
              kind: latest.includes(`${options.interactivePrompt}_MARKDOWN`)
                ? ("markdown" as const)
                : latest.includes(`${options.interactivePrompt}_PARTIAL`)
                  ? ("html-partial" as const)
                  : ("html" as const),
              web: false,
              release: () => {},
              released: Promise.resolve(),
            }
          : undefined;
      if (!plan || calls >= options.maxRequests) {
        denied++;
        res
          .writeHead(429, { "Content-Type": "application/json" })
          .end('{"error":{"code":"VERIFY_BUDGET_OR_UNPLANNED_REQUEST"}}');
        return;
      }
      calls++;
      const capture: TransportCapture = {
        label: plan.label,
        kind: plan.kind,
        body,
        requestHash: hash(raw),
        contractErrors: wireContract(
          body,
          plan,
          req.headers["accept-encoding"],
        ),
        httpStatus: 0,
        responseStatus: null,
        rawText: "",
        finalRawText: null,
        annotations: [],
        usage: null,
        searched: false,
        contentType: "",
        injected: false,
        held: false,
        done: false,
        protocolError: false,
      };
      captures.push(capture);
      try {
        if (
          options.real &&
          !["html", "html-partial", "markdown"].includes(plan.kind)
        )
          await forward(res, capture, plan, raw);
        else await mock(res, capture, plan);
      } finally {
        capture.done = true;
      }
    };
    const task = handle().catch(() => {
      if (!res.headersSent)
        res.writeHead(502, { "Content-Type": "application/json" });
      if (!res.writableEnded && !res.destroyed)
        res.end('{"error":{"code":"VERIFY_TRANSPORT_FAILED"}}');
    });
    pending.add(task);
    void task.finally(() => pending.delete(task));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  check(address && typeof address !== "string", "TRANSPORT_BIND_FAILED");
  sentinelBase = `http://127.0.0.1:${address.port}/sentinel/${randomBytes(12).toString("hex")}`;
  statusUrl = `http://127.0.0.1:${address.port}/status/${randomBytes(12).toString("hex")}`;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    token,
    schedule,
    captures,
    sentinelBase,
    statusUrl,
    release(label: string) {
      allPlans
        .filter((plan) => plan.label === label)
        .forEach((plan) => plan.release());
    },
    releaseAll() {
      allPlans.forEach((plan) => plan.release());
    },
    stats,
    async close() {
      closing = true;
      for (const plan of allPlans) plan.release();
      for (const req of outbound) req.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await Promise.allSettled([...pending]);
    },
  };
}

export type AcceptanceTransport = Awaited<
  ReturnType<typeof startAcceptanceTransport>
>;
