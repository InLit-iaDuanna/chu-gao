import { ok } from "@/lib/api-response";
import { agentModels } from "@/lib/agent-images";
import { getApiDocsMarkdown } from "@/lib/api-docs";

/** Public API docs: editable Markdown plus the live model and API price table. */
export async function GET() {
  const [{ markdown }, models] = await Promise.all([
    getApiDocsMarkdown(),
    agentModels(true),
  ]);
  return ok(
    {
      markdown,
      models: models.map((model) => ({
        id: model.id,
        displayName: model.displayName,
        available: model.available,
        sizes: model.capabilities.sizes,
        qualities: model.capabilities.qualities,
        maxN: model.capabilities.maxN,
        maxReferenceImages: model.capabilities.supportsReferenceImage
          ? model.capabilities.maxReferenceImages
          : 0,
        defaultSize: model.defaults.size,
        prices: "prices" in model ? model.prices : {},
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
