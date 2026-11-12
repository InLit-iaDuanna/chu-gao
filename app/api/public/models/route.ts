import { ok } from "@/lib/api-response";
import { db } from "@/lib/db";
import { listModelsWithPricing } from "@/lib/model-pricing";
import { providerProtocolToModelProtocol } from "@/lib/providers/protocols";
import type { ModelDefinition } from "@/lib/models/types";
import {
  isFallbackProvider,
  providerCostMultiplier,
} from "@/lib/providers/account-pool";

function modelAliases(modelId: string): string[] {
  if (modelId === "gpt-image-2") {
    return [modelId, "gpt-image-2-standard", "gpt-image-2-high"];
  }

  if (modelId === "nano-banana-2-512") {
    return [modelId];
  }

  return [modelId];
}

function publicModel(
  model: ModelDefinition,
  available: boolean,
  fallbackCostMultiplier?: number,
) {
  return {
    ...model,
    available,
    ...(fallbackCostMultiplier === undefined ? {} : { fallbackCostMultiplier }),
    pricingRules: model.pricingRules?.filter((rule) => !rule.providerChannelId),
  };
}

export async function GET() {
  const models = await listModelsWithPricing();

  if (!process.env.DATABASE_URL) {
    return ok(models.map((model) => publicModel(model, false)));
  }

  try {
    const providers = await db.provider.findMany({
      where: {
        isActive: true,
      },
      select: {
        id: true,
        costMultiplier: true,
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
          },
          select: {
            health: true,
            cooldownUntil: true,
          },
        },
      },
    });

    const availableModelIds = new Set<string>();
    const fallbackMultipliers = new Map<string, number>();

    for (const provider of providers) {
      const expectedProtocol = providerProtocolToModelProtocol(
        provider.protocol,
      );

      const providerModelIds = new Set(provider.modelsSupported);

      for (const model of models) {
        const aliases = modelAliases(model.id);
        if (
          isFallbackProvider(provider) &&
          model.protocol === expectedProtocol &&
          aliases.some((id) => providerModelIds.has(id))
        ) {
          fallbackMultipliers.set(model.id, providerCostMultiplier(provider));
        }

        if (
          model.protocol === expectedProtocol &&
          aliases.some((id) => providerModelIds.has(id)) &&
          (provider._count.accounts === 0 ||
            provider.accounts.some(
              (account) =>
                account.health !== "DOWN" &&
                (!account.cooldownUntil || account.cooldownUntil <= new Date()),
            ))
        ) {
          availableModelIds.add(model.id);
        }
      }
    }

    return ok(
      models.map((model) =>
        publicModel(
          model,
          availableModelIds.has(model.id),
          fallbackMultipliers.get(model.id),
        ),
      ),
    );
  } catch {
    return ok(models.map((model) => publicModel(model, false)));
  }
}
