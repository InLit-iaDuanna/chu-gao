"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { StudioApp } from "@/components/studio/StudioApp";
import { WorkspaceShell } from "@/components/studio/WorkspaceShell";
import {
  conversationFor,
  imageModels,
  me,
  pricing,
  runningTurn,
  threads,
  type PreviewScenario,
} from "./fixtures";

const ok = (data: unknown) =>
  new Response(JSON.stringify({ ok: true, data }), {
    headers: { "Content-Type": "application/json" },
  });

/** Replace same-origin API calls with canned data for one scenario. */
function installMocks(scenario: PreviewScenario) {
  const real = window.fetch.bind(window);
  const conversation = conversationFor(scenario);
  const turn = runningTurn(scenario);
  window.fetch = async (input, init) => {
    const raw =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const url = new URL(raw, window.location.origin);
    if (!url.pathname.startsWith("/api/")) return real(input, init);
    const path = url.pathname;
    if (path === "/api/me") return ok(me);
    if (path === "/api/public/models") return ok(imageModels);
    if (path === "/api/conversations/chat") return ok(pricing);
    if (path === "/api/conversations/context")
      return ok({
        estimatedTokens: scenario === "empty" ? 0 : 18_400,
        budgetTokens: 120_000,
        autoCompactTokens: 102_000,
        autoCompactRatio: 0.85,
        messageCount: conversation?.messages.length ?? 0,
        compactedMessages: 0,
        summary: null,
        canCompact: false,
      });
    if (path === "/api/conversations") return ok({ items: threads });
    if (path.startsWith("/api/conversations/")) return ok(conversation);
    if (path.endsWith("/events"))
      // An open stream that never emits: the turn stays in its canned state.
      return new Response(new ReadableStream<Uint8Array>({ start() {} }), {
        headers: { "Content-Type": "text/event-stream" },
      });
    if (path === "/api/chat/turns")
      return ok(url.searchParams.has("clientRequestId") ? null : turn);
    if (path.startsWith("/api/chat/turns/"))
      return ok(path.endsWith("/rendered") ? { recorded: true } : turn);
    return ok(null);
  };
  // Running image jobs subscribe with EventSource; keep them inert.
  window.EventSource = class {
    onmessage = null;
    onerror = null;
    addEventListener() {}
    removeEventListener() {}
    close() {}
  } as unknown as typeof EventSource;
}

export function StudioPreview({
  scenario,
  theme,
}: {
  scenario: PreviewScenario;
  theme: "light" | "dark";
}) {
  // Children fetch in their effects, which run before this component's
  // effects, so the mocks have to be in place during the first client render.
  const [ready, setReady] = useState(false);
  const { setTheme } = useTheme();
  useEffect(() => {
    installMocks(scenario);
    setTheme(theme);
    setReady(true);
  }, [scenario, theme, setTheme]);
  if (!ready) return null;
  return (
    <WorkspaceShell studio>
      <StudioApp initialThreadId={scenario === "empty" ? null : "preview"} />
    </WorkspaceShell>
  );
}
