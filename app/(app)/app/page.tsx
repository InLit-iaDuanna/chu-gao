import { StudioApp } from "@/components/studio/StudioApp";
import { creativeAssistantEnabled } from "@/lib/creative-config";

export default async function AppPage({
  searchParams,
}: {
  searchParams: Promise<{
    thread?: string;
    mode?: string;
    prompt?: string;
    negativePrompt?: string;
    modelName?: string;
    aspectRatio?: string;
    resolution?: string;
    seed?: string;
    reference?: string | string[];
  }>;
}) {
  const {
    thread,
    mode,
    prompt,
    negativePrompt,
    modelName,
    aspectRatio,
    resolution,
    seed,
    reference,
  } = await searchParams;
  const initialReferenceKeys = (
    Array.isArray(reference) ? reference : reference ? [reference] : []
  ).slice(0, 16);
  const parsedSeed = seed && /^-?\d+$/.test(seed) ? Number(seed) : undefined;

  return (
    <StudioApp
      creativeEnabled={creativeAssistantEnabled()}
      initialMode={mode === "agent" ? "agent" : undefined}
      initialThreadId={thread ?? null}
      initialPrompt={prompt ?? null}
      initialReferenceKeys={initialReferenceKeys}
      initialRecipe={{
        ...(negativePrompt ? { negativePrompt } : {}),
        ...(modelName ? { modelName } : {}),
        ...(aspectRatio ? { aspectRatio } : {}),
        ...(resolution ? { resolution } : {}),
        ...(Number.isSafeInteger(parsedSeed) ? { seed: parsedSeed } : {}),
      }}
    />
  );
}
