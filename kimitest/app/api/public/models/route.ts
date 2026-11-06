import { ok } from "@/lib/api-response";
import { db } from "@/lib/db";
import { listModelsWithPricing } from "@/lib/model-pricing";
import { getProviderChannelDisplayNameMap } from "@/lib/provider-channel-config";
import {
  buildProviderChannelsFromAccounts,
  toPublicProviderChannels,
  supportsProviderChannels,
} from "@/lib/provider-channels";
import { providerProtocolToModelProtocol } from "@/lib/providers/protocols";

function modelAliases(modelId: string): string[] {
  if (modelId === "gpt-image-2") {
    return [modelId, "gpt-image-2-standard", "gpt-image-2-high"];
  }

  if (modelId === "nano-banana-2-512") {
    return [modelId];
  }

  return [modelId];
}

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
    const [providers, displayNameMap] = await Promise.all([
      db.provider.findMany({
        where: {
          isActive: true,
        },
        select: {
          id: true,
          name: true,
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
              id: true,
              baseUrl: true,
              isActive: true,
              health: true,
              cooldownUntil: true,
            },
          },
        },
      }),
      getProviderChannelDisplayNameMap(),
    ]);

    const availableModelIds = new Set<string>();

    for (const provider of providers) {
      const expectedProtocol = providerProtocolToModelProtocol(
        provider.protocol,
      );

      const providerModelIds = new Set(provider.modelsSupported);

      for (const model of models) {
        const aliases = modelAliases(model.id);

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

    const providerChannelsByModelId = new Map(
      models
        .filter((model) => supportsProviderChannels(model.id))
        .map((model) => {
          const aliases = modelAliases(model.id);
          const accounts = providers
            .filter((provider) => {
              const expectedProtocol = providerProtocolToModelProtocol(
                provider.protocol,
              );

              return (
                model.protocol === expectedProtocol &&
                aliases.some((id) => provider.modelsSupported.includes(id))
              );
            })
            .flatMap((provider) =>
              provider.accounts.map((account) => ({
                ...account,
                provider: { id: provider.id, name: provider.name },
              })),
            );
          const channels = buildProviderChannelsFromAccounts(accounts, {
            displayNameMap,
          });

          return [
            model.id,
            toPublicProviderChannels(channels),
          ] as const;
        }),
    );

    return ok(
      models.map((model) => ({
        ...model,
        available: availableModelIds.has(model.id),
        providerChannels: providerChannelsByModelId.get(model.id) ?? undefined,
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
