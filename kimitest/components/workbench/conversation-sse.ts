interface SseHandlers {
  onDelta: (token: string) => void;
  onReasoning: (token: string) => void;
  onError: (message: string) => void;
  onBilling?: (billing: {
    credits: number;
    balance: number;
    refunded: boolean;
  }) => void;
  signal: AbortSignal;
}

// 解析 chat 端点的 SSE 流：event: delta|reasoning|done|error。
export async function consumeSse(
  body: ReadableStream<Uint8Array>,
  handlers: SseHandlers,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const dispatch = (rawEvent: string) => {
    let eventName = "message";
    const dataLines: string[] = [];

    for (const line of rawEvent.split("\n")) {
      if (line.startsWith("event:")) {
        eventName = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trim());
      }
    }

    const data = dataLines.join("\n");
    if (!data) {
      return;
    }

    let parsed: {
      content?: unknown;
      message?: unknown;
      credits?: unknown;
      balance?: unknown;
      refunded?: unknown;
    } = {};
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }

    if (eventName === "delta" && typeof parsed.content === "string") {
      handlers.onDelta(parsed.content);
    } else if (
      eventName === "reasoning" &&
      typeof parsed.content === "string"
    ) {
      handlers.onReasoning(parsed.content);
    } else if (eventName === "error") {
      handlers.onError(
        typeof parsed.message === "string" ? parsed.message : "对话出错。",
      );
    } else if (
      eventName === "billing" &&
      typeof parsed.credits === "number" &&
      typeof parsed.balance === "number" &&
      typeof parsed.refunded === "boolean"
    ) {
      handlers.onBilling?.({
        credits: parsed.credits,
        balance: parsed.balance,
        refunded: parsed.refunded,
      });
    }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        dispatch(rawEvent);
        boundary = buffer.indexOf("\n\n");
      }
    }
    if (buffer.trim()) {
      dispatch(buffer);
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // 忽略取消错误。
    }
  }
}
