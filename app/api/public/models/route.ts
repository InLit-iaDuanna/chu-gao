import { ok } from "@/lib/api-response";
import { db } from "@/lib/db";
import { listModelsWithPricing } from "@/lib/model-pricing";
import { providerProtocolToModelProtocol } from "@/lib/providers/protocols";

export async function GET() {
  const models = await listModelsWithPricing();

  if (!process.env.DATABASE_URL) {
    return ok(
      models.map((model) => ({
        ...model,
        available: false,
      })),
    );
  }

  try {
    const providers = await db.provider.findMany({
      where: {
        isActive: true,
        health: { not: "DOWN" },
      },
      select: {
        protocol: true,
        modelsSupported: true,
        _count: {
          select: {
            accounts: true,
          },
        },
        accounts: {
          where: {
            isActive: true,
            health: { not: "DOWN" },
            OR: [
              { cooldownUntil: null },
              { cooldownUntil: { lte: new Date() } },
            ],
          },
          select: { id: true },
        },
      },
    });

    const availableModelIds = new Set<string>();
    const modelAliases = new Map<string, string[]>([
      [
        "gemini-3.1-flash-image-preview",
        ["gemini-2.5-flash-image", "gemini-3.1-flash-image-preview"],
      ],
      [
        "gemini-3-pro-image-preview",
        ["gemini-2.5-flash-image-pro", "gemini-3-pro-image-preview"],
      ],
    ]);

    for (const provider of providers) {
      const expectedProtocol = providerProtocolToModelProtocol(
        provider.protocol,
      );

      const providerModelIds = new Set(provider.modelsSupported);

      for (const model of models) {
        const aliases = modelAliases.get(model.id) ?? [model.id];

        if (
          model.protocol === expectedProtocol &&
          aliases.some((id) => providerModelIds.has(id)) &&
          (provider._count.accounts === 0 || provider.accounts.length > 0)
        ) {
          availableModelIds.add(model.id);
        }
      }
    }

    return ok(
      models.map((model) => ({
        ...model,
        available: availableModelIds.has(model.id),
      })),
    );
  } catch {
    return ok(
      models.map((model) => ({
        ...model,
        available: false,
      })),
    );
  }
}
