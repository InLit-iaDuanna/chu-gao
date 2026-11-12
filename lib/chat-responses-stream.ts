import { createParser } from "eventsource-parser";
import { readCitedResponse, type ChatSearchSource } from "@/lib/chat-search";
import type { ChatTerminalStatus } from "@/lib/chat-turn-types";

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const string = (value: unknown) => (typeof value === "string" ? value : "");

export interface ResponseTextPart {
  itemId: string;
  outputIndex: number;
  contentIndex: number;
  type: "output_text" | "refusal";
  text: string;
  annotations: Array<Record<string, unknown>>;
  revision: number;
}

export interface ResponseOutputItem {
  itemId: string;
  outputIndex: number;
  type: string;
  status?: string;
  role?: string;
  phase?: string;
  callId?: string;
  name?: string;
  action?: Record<string, unknown>;
  startedAt?: string;
  finishedAt?: string;
}

export interface ResponseFunctionCall {
  itemId: string;
  outputIndex: number;
  callId: string;
  name: string;
  arguments: string;
}

export class ResponsesAccumulator {
  readonly parts = new Map<string, ResponseTextPart>();
  readonly items = new Map<string, ResponseOutputItem>();
  readonly eventCounts: Record<string, number> = {};
  readonly activityHistory: string[] = [];
  revision = 0;
  lastSequence: number | null = null;
  providerStatus: string | null = null;
  terminal: ChatTerminalStatus | null = null;
  private currentActivity = "waiting_upstream";
  responseId: string | null = null;
  searched = false;
  sources: ChatSearchSource[] = [];
  usage: Record<string, unknown> | null = null;
  error: Record<string, unknown> | null = null;
  finalText: string | null = null;
  private seenSequences = new Set<number>();
  private deltaParts = new Map<string, string>();
  private functionArguments = new Map<string, string>();

  get activity() {
    return this.currentActivity;
  }

  set activity(value: string) {
    if (this.currentActivity === value) return;
    this.currentActivity = value;
    if (this.activityHistory.at(-1) !== value) this.activityHistory.push(value);
    this.revision++;
  }

  get rawText() {
    return this.orderedParts()
      .map((part) => part.text)
      .join("\n\n");
  }

  orderedParts() {
    return [...this.parts.values()].sort(
      (a, b) =>
        a.outputIndex - b.outputIndex || a.contentIndex - b.contentIndex,
    );
  }

  checkpoint() {
    return {
      version: 3,
      revision: this.revision,
      responseId: this.responseId,
      providerStatus: this.providerStatus,
      lastSequence: this.lastSequence,
      activityHistory: this.activityHistory.length
        ? [...this.activityHistory]
        : [this.activity],
      usageAvailability: this.usage ? "reported" : "unknown",
      items: [...this.items.values()].sort(
        (a, b) => a.outputIndex - b.outputIndex,
      ),
      parts: this.orderedParts(),
    };
  }

  partDiagnostics() {
    return this.orderedParts().map((part) => {
      const delta = this.deltaParts.get(`${part.itemId}:${part.contentIndex}`);
      return {
        itemId: part.itemId,
        contentIndex: part.contentIndex,
        deltaCharacters: delta?.length ?? 0,
        finalRawCharacters: part.text.length,
        matchesFinalRaw: delta === undefined ? null : delta === part.text,
      };
    });
  }

  private part(payload: Record<string, unknown>) {
    const outputIndex =
      typeof payload.output_index === "number" ? payload.output_index : 0;
    const contentIndex =
      typeof payload.content_index === "number" ? payload.content_index : 0;
    const item = this.outputItem({ id: payload.item_id }, outputIndex);
    const itemId = item.itemId;
    const key = `${itemId}:${contentIndex}`;
    let part = this.parts.get(key);
    if (!part) {
      part = {
        itemId,
        outputIndex: item.outputIndex,
        contentIndex,
        type: "output_text",
        text: "",
        annotations: [],
        revision: ++this.revision,
      };
      this.parts.set(key, part);
    }
    return part;
  }

  private outputItem(value: Record<string, unknown>, outputIndex: number) {
    const fallbackId = `output-${outputIndex}`;
    const itemId =
      string(value.id) ||
      [...this.items.values()].find((item) => item.outputIndex === outputIndex)
        ?.itemId ||
      fallbackId;
    let item = this.items.get(itemId);
    if (!item && itemId !== fallbackId && this.items.has(fallbackId)) {
      item = this.items.get(fallbackId)!;
      this.items.delete(fallbackId);
      item.itemId = itemId;
      this.items.set(itemId, item);
      for (const [key, part] of this.parts) {
        if (part.itemId !== fallbackId) continue;
        this.parts.delete(key);
        part.itemId = itemId;
        const nextKey = `${itemId}:${part.contentIndex}`;
        part.annotations = part.annotations.map((annotation) => ({
          ...annotation,
          itemId,
        }));
        this.parts.set(nextKey, part);
        if (this.deltaParts.has(key)) {
          this.deltaParts.set(nextKey, this.deltaParts.get(key)!);
          this.deltaParts.delete(key);
        }
      }
      this.revision++;
    }
    if (!item) {
      item = { itemId, outputIndex, type: string(value.type) || "message" };
      this.items.set(itemId, item);
      this.revision++;
    }
    const before = JSON.stringify(item);
    for (const key of ["type", "status", "role", "phase"] as const)
      if (typeof value[key] === "string") item[key] = value[key];
    if (typeof value.call_id === "string") item.callId = value.call_id;
    if (typeof value.name === "string") item.name = value.name;
    if (item.type === "function_call" && typeof value.arguments === "string") {
      this.functionArguments.set(item.callId ?? item.itemId, value.arguments);
    }
    // Only retain public tool metadata, never reasoning/encrypted content or
    // arbitrary provider item payloads.
    if (item.type === "web_search_call") {
      item.startedAt ??= new Date().toISOString();
      if (["completed", "failed", "incomplete"].includes(item.status ?? ""))
        item.finishedAt ??= new Date().toISOString();
      const action = record(value.action);
      if (Object.keys(action).length) {
        item.action = Object.fromEntries(
          ["type", "query", "queries", "url", "pattern", "sources"]
            .filter((key) => action[key] !== undefined)
            .map((key) => [key, action[key]]),
        );
      }
    }
    if (before !== JSON.stringify(item)) this.revision++;
    return item;
  }

  private annotations(part: ResponseTextPart, annotations: unknown[]) {
    const normalized: Array<Record<string, unknown>> = [];
    annotations.forEach((value, index) => {
      const annotation = record(value);
      if (!Object.keys(annotation).length) return;
      const annotationIndex = Number.isInteger(annotation.annotation_index)
        ? annotation.annotation_index
        : index;
      const next = {
        ...annotation,
        annotationIndex,
        itemId: part.itemId,
        outputIndex: part.outputIndex,
        contentIndex: part.contentIndex,
      };
      const existing = normalized.findIndex(
        (item) => item.annotationIndex === annotationIndex,
      );
      if (existing < 0) normalized.push(next);
      else normalized[existing] = next;
    });
    if (JSON.stringify(part.annotations) !== JSON.stringify(normalized)) {
      part.annotations = normalized;
      part.revision = ++this.revision;
    }
  }

  private content(
    payload: Record<string, unknown>,
    content: Record<string, unknown>,
  ) {
    if (content.type !== "output_text" && content.type !== "refusal") return;
    const part = this.part(payload);
    const text = content.text ?? content.refusal;
    if (
      part.type !== content.type ||
      (typeof text === "string" && part.text !== text)
    ) {
      part.type = content.type;
      if (typeof text === "string") part.text = text;
      part.revision = ++this.revision;
    }
    if (Array.isArray(content.annotations))
      this.annotations(part, content.annotations);
  }

  private item(item: Record<string, unknown>, outputIndex: number) {
    this.outputItem(item, outputIndex);
    if (item.type === "function_call") this.activity = "image_tool";
    if (item.type === "web_search_call" && item.status === "completed") {
      this.searched = true;
      if (this.activity !== "answering")
        this.activity = [...this.items.values()].some(
          (value) =>
            value.type === "web_search_call" &&
            !["completed", "failed", "incomplete"].includes(value.status ?? ""),
        )
          ? "searching"
          : "waiting_upstream";
    }
    if (item.type !== "message" || !Array.isArray(item.content)) return;
    item.content.forEach((value, contentIndex) => {
      this.content(
        {
          item_id: item.id,
          output_index: outputIndex,
          content_index: contentIndex,
        },
        record(value),
      );
    });
  }

  consume(value: unknown) {
    if (this.terminal) return;
    const payload = record(value);
    const type = string(payload.type);
    if (
      typeof payload.sequence_number === "number" &&
      Number.isInteger(payload.sequence_number)
    ) {
      if (this.seenSequences.has(payload.sequence_number)) return;
      this.seenSequences.add(payload.sequence_number);
      this.lastSequence = Math.max(
        this.lastSequence ?? 0,
        payload.sequence_number,
      );
    }
    this.eventCounts[type || "unknown"] =
      (this.eventCounts[type || "unknown"] ?? 0) + 1;
    const response = record(payload.response);
    if (response.id && this.responseId !== response.id) {
      this.responseId = string(response.id);
      this.revision++;
    }
    if (
      typeof response.status === "string" &&
      response.status !== this.providerStatus
    ) {
      this.providerStatus = response.status;
      this.revision++;
    }
    if (
      response.usage &&
      JSON.stringify(this.usage) !== JSON.stringify(response.usage)
    ) {
      this.usage = record(response.usage);
      this.revision++;
    }
    if (
      type === "response.output_text.delta" ||
      type === "response.refusal.delta"
    ) {
      const part = this.part(payload);
      const delta = string(payload.delta);
      part.type = type === "response.refusal.delta" ? "refusal" : "output_text";
      part.text += delta;
      if (delta) part.revision = ++this.revision;
      const key = `${part.itemId}:${part.contentIndex}`;
      this.deltaParts.set(key, (this.deltaParts.get(key) ?? "") + delta);
      this.activity = "answering";
    } else if (
      type === "response.output_text.done" ||
      type === "response.refusal.done"
    ) {
      this.content(payload, {
        type: type === "response.refusal.done" ? "refusal" : "output_text",
        text: payload.text ?? payload.refusal,
      });
    } else if (type === "response.output_text.annotation.added") {
      const part = this.part(payload);
      const annotation = record(payload.annotation);
      const index =
        typeof payload.annotation_index === "number"
          ? payload.annotation_index
          : (part.annotations.find((value) =>
              Object.entries(annotation).every(
                ([key, field]) => value[key] === field,
              ),
            )?.annotationIndex ?? part.annotations.length);
      const next = part.annotations.filter(
        (value) => value.annotationIndex !== index,
      );
      next.push({ ...annotation, annotation_index: index });
      next.sort(
        (a, b) =>
          Number(a.annotation_index ?? a.annotationIndex) -
          Number(b.annotation_index ?? b.annotationIndex),
      );
      this.annotations(
        part,
        next.map((value) => ({
          ...value,
          annotation_index: value.annotation_index ?? value.annotationIndex,
        })),
      );
    } else if (
      type === "response.content_part.added" ||
      type === "response.content_part.done"
    ) {
      this.content(payload, record(payload.part));
    } else if (type === "response.output_item.added") {
      const item = record(payload.item);
      this.item(
        item,
        typeof payload.output_index === "number" ? payload.output_index : 0,
      );
      if (item.type === "reasoning") this.activity = "reasoning";
      if (item.type === "web_search_call") this.activity = "searching";
      if (item.type === "function_call") this.activity = "image_tool";
    } else if (
      type === "response.function_call_arguments.delta" ||
      type === "response.function_call_arguments.done"
    ) {
      const outputIndex =
        typeof payload.output_index === "number" ? payload.output_index : 0;
      const item = this.outputItem(
        {
          id: payload.item_id,
          call_id: payload.call_id,
          name: payload.name,
          type: "function_call",
        },
        outputIndex,
      );
      const key = item.callId ?? item.itemId;
      const argumentsValue =
        type.endsWith(".done") && typeof payload.arguments === "string"
          ? payload.arguments
          : string(payload.delta);
      if (type.endsWith(".done"))
        this.functionArguments.set(key, argumentsValue);
      else if (argumentsValue)
        this.functionArguments.set(
          key,
          (this.functionArguments.get(key) ?? "") + argumentsValue,
        );
      this.activity = "image_tool";
      if (argumentsValue) this.revision++;
    } else if (type.startsWith("response.web_search_call.")) {
      const outputIndex =
        typeof payload.output_index === "number" ? payload.output_index : 0;
      this.outputItem(
        {
          id: payload.item_id,
          type: "web_search_call",
          status: type.split(".").at(-1),
        },
        outputIndex,
      );
      this.activity = type.endsWith("completed")
        ? "waiting_upstream"
        : "searching";
      if (type.endsWith("completed")) this.searched = true;
    } else if (type === "response.output_item.done") {
      this.item(
        record(payload.item),
        typeof payload.output_index === "number" ? payload.output_index : 0,
      );
    }
    if (type === "response.completed") {
      if (Array.isArray(response.output)) {
        // A successful final response is authoritative; failures may omit output
        // or contain only the final subset, so preserve their streamed parts.
        if (
          !response.error &&
          (!response.status || response.status === "completed")
        ) {
          this.parts.clear();
          this.revision++;
        }
        response.output.forEach((item, index) =>
          this.item(record(item), index),
        );
      }
      if (
        response.error ||
        (response.status && response.status !== "completed")
      ) {
        this.terminal =
          response.status === "incomplete" ? "incomplete" : "failed";
        this.error = record(response.error ?? response.incomplete_details);
      } else {
        if (Array.isArray(response.output)) {
          // The completed response is authoritative, including removed/rewritten parts.
          const cited = readCitedResponse(response.output);
          this.finalText = cited.finalText;
          this.sources = cited.sources ?? [];
          this.searched ||= cited.searched ?? false;
        }
        this.terminal = "completed";
      }
      if (!response.status) this.providerStatus = this.terminal;
      this.revision++;
    } else if (
      type === "response.failed" ||
      type === "error" ||
      type === "response.incomplete" ||
      payload.error
    ) {
      this.terminal = type === "response.incomplete" ? "incomplete" : "failed";
      if (Array.isArray(response.output))
        response.output.forEach((item, index) =>
          this.item(record(item), index),
        );
      this.error = record(
        response.error ??
          payload.error ??
          response.incomplete_details ??
          payload,
      );
      if (!response.status) this.providerStatus = this.terminal;
      this.revision++;
    }
    if (!this.finalText) {
      const cited = readCitedResponse([
        ...[...this.items.values()]
          .filter((item) => item.type === "web_search_call")
          .map((item) => ({
            type: item.type,
            status: item.status,
            action: item.action,
          })),
        ...this.orderedParts().map((part) => ({
          type: "message",
          content: [
            {
              type: part.type,
              text: part.type === "output_text" ? part.text : undefined,
              refusal: part.type === "refusal" ? part.text : undefined,
              annotations: part.annotations,
            },
          ],
        })),
      ]);
      this.sources = cited.sources ?? [];
    }
  }

  functionCalls(): ResponseFunctionCall[] {
    return [...this.items.values()]
      .filter((item) => item.type === "function_call")
      .map((item) => {
        const callId = item.callId ?? item.itemId;
        const args = this.functionArguments.get(callId);
        if (!args) return null;
        return {
          itemId: item.itemId,
          outputIndex: item.outputIndex,
          callId,
          name: item.name ?? "",
          arguments: args,
        };
      })
      .filter((item): item is ResponseFunctionCall => Boolean(item));
  }

  recordToolResult(
    callId: string,
    name: string,
    result: {
      ok: boolean;
      generationId?: string;
      status?: string;
      message?: string;
    },
  ) {
    const itemId = `tool-${callId}`;
    this.items.set(itemId, {
      itemId,
      outputIndex:
        Math.max(
          -1,
          ...[...this.items.values()].map((item) => item.outputIndex),
        ) + 1,
      type: "tool_result",
      status: result.ok ? "completed" : "failed",
      callId,
      name,
      action: {
        status: result.status ?? (result.ok ? "accepted" : "failed"),
        ...(result.generationId ? { generationId: result.generationId } : {}),
        ...(result.message ? { message: result.message } : {}),
      },
    });
    this.revision++;
  }

  resetForContinuation() {
    for (const [itemId, item] of this.items) {
      if (item.type === "function_call" || item.type === "function_call_output")
        this.items.delete(itemId);
    }
    this.functionArguments.clear();
    this.terminal = null;
    this.error = null;
    this.finalText = null;
    this.providerStatus = null;
    this.usage = null;
    this.responseId = null;
    this.seenSequences.clear();
    this.currentActivity = "waiting_upstream";
    this.revision++;
  }
}

export class ChatProtocolError extends Error {}

export async function consumeChatSse(
  stream: ReadableStream<Uint8Array>,
  onEvent: (value: unknown) => Promise<boolean | void>,
  options: { signal?: AbortSignal; idleMs?: number; onBytes?: () => void } = {},
) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let values: unknown[] = [];
  const done = Symbol("sse.done");
  let parseError: Error | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const parser = createParser({
    maxBufferSize: 2_000_000,
    onEvent(event) {
      if (parseError) return;
      if (event.data === "[DONE]") {
        values.push(done);
        return;
      }
      try {
        values.push(JSON.parse(event.data));
      } catch {
        parseError ??= new ChatProtocolError("Malformed JSON in upstream SSE");
      }
    },
    onError(error) {
      if (error.type === "max-buffer-size-exceeded")
        parseError ??= new ChatProtocolError(
          "SSE event exceeded the buffer limit",
        );
    },
  });
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  options.signal?.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      options.signal?.throwIfAborted();
      const part = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new ChatProtocolError("Upstream byte idle timeout")),
            options.idleMs ?? 90_000,
          );
        }),
      ]);
      clearTimeout(timer);
      if (part.value?.length) options.onBytes?.();
      parser.feed(decoder.decode(part.value, { stream: !part.done }));
      if (part.done) parser.feed("\n\n");
      // Never discard a complete event parsed immediately before a protocol error.
      for (const value of values)
        if (value === done || (await onEvent(value)) === false) return;
      values = [];
      if (parseError) throw parseError;
      if (part.done) return;
    }
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", cancel);
    cancel();
    reader.releaseLock();
  }
}
