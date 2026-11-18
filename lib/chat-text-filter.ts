/**
 * Some upstreams (proxy models behind a compatible endpoint) inline their
 * reasoning as literal `<thinking>…</thinking>` text instead of a separate
 * reasoning block. Chat replies must never show that, so it is removed from the
 * streamed text and from the final message.
 */
const OPEN = "<thinking>";
const CLOSE = "</thinking>";

function partialSuffixLength(buffer: string, token: string): number {
  const max = Math.min(token.length - 1, buffer.length);
  for (let length = max; length > 0; length -= 1) {
    if (buffer.endsWith(token.slice(0, length))) return length;
  }
  return 0;
}

/** Remove every `<thinking>…</thinking>` block from a complete string. */
export function stripThinkingTags(text: string): string {
  let out = "";
  let rest = text;
  for (;;) {
    const open = rest.indexOf(OPEN);
    if (open < 0) {
      out += rest;
      break;
    }
    out += rest.slice(0, open);
    const close = rest.indexOf(CLOSE, open + OPEN.length);
    if (close < 0) break;
    rest = rest.slice(close + CLOSE.length);
  }
  return out.replace(/^(?:[ \t]*\r?\n)+/, "");
}

/** Stateful filter for streamed deltas; tags may span chunks. */
export class ThinkingStreamFilter {
  private inside = false;
  private pending = "";

  push(chunk: string): string {
    let buffer = this.pending + chunk;
    this.pending = "";
    let out = "";
    for (;;) {
      if (this.inside) {
        const close = buffer.indexOf(CLOSE);
        if (close < 0) {
          const keep = partialSuffixLength(buffer, CLOSE);
          this.pending = keep ? buffer.slice(-keep) : "";
          break;
        }
        buffer = buffer.slice(close + CLOSE.length);
        this.inside = false;
        continue;
      }
      const open = buffer.indexOf(OPEN);
      if (open >= 0) {
        out += buffer.slice(0, open);
        buffer = buffer.slice(open + OPEN.length);
        this.inside = true;
        continue;
      }
      const keep = partialSuffixLength(buffer, OPEN);
      out += keep ? buffer.slice(0, buffer.length - keep) : buffer;
      this.pending = keep ? buffer.slice(-keep) : "";
      break;
    }
    return out;
  }

  /** Flush whatever is still pending (never thinking content). */
  flush(): string {
    const rest = this.inside ? "" : this.pending;
    this.pending = "";
    return rest;
  }
}
