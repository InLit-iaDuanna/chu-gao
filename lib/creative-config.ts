export function creativeAssistantEnabled(): boolean {
  return ["true", "1"].includes(
    (process.env.CREATIVE_ASSISTANT_ENABLED ?? "false").trim().toLowerCase(),
  );
}
