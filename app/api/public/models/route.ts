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
          accounts: {
            where: {
              isActive: true,
              health: { not: "DOWN" },
              OR: [{ cooldownUntil: null }, { cooldownUntil: { lte: new Date() } }],
            },
            select: { id: true },
          },
      },
    });

    const availableModelIds = new Set<string>();

    for (const provider of providers) {
      const expectedProtocol = providerProtocolToModelProtocol(
        provider.protocol,
      );

      for (const modelId of provider.modelsSupported) {
        const model = models.find((item) => item.id === modelId);

        if (
          model &&
          model.protocol === expectedProtocol &&
          (provider.accounts.length > 0 || provider.modelsSupported.length > 0)
        ) {
          availableModelIds.add(modelId);
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
