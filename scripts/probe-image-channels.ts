import { performance } from "node:perf_hooks";
import sharp from "sharp";

import { decrypt } from "@/lib/crypto";
import { db } from "@/lib/db";
import { getModel } from "@/lib/models/registry";
import { channelIdFromProvider } from "@/lib/provider-channels";
import { findAvailableProviderAccounts } from "@/lib/providers/account-pool";
import { OpenAIImagesAdapter } from "@/lib/providers/openai-images";
import { serializeProviderError } from "@/lib/providers/diagnostics";

const option = (name: string) =>
  process.argv
    .find((arg) => arg.startsWith(`--${name}=`))
    ?.slice(name.length + 3);

async function main() {
  const accountId = option("account");
  const accounts = await db.providerAccount.findMany({
    where: {
      ...(accountId ? { id: accountId } : {}),
      provider: { protocol: "OPENAI_IMAGES" },
    },
    include: { provider: true },
    orderBy: [{ providerId: "asc" }, { createdAt: "asc" }],
  });
  if (!accounts.length) throw new Error("No matching image account.");

  if (process.argv.includes("--availability")) {
    const pools = new Map(
      accounts.map((account) => [account.providerId, account.provider]),
    );
    for (const provider of pools.values()) {
      for (const modelId of provider.modelsSupported) {
        const available = await findAvailableProviderAccounts(
          modelId,
          channelIdFromProvider(provider.id, provider.baseUrl),
        );
        console.log(
          JSON.stringify({
            providerId: provider.id,
            modelId,
            availableAccounts: available.map((account) => account.id),
          }),
        );
      }
    }
    return;
  }

  if (process.argv.includes("--models")) {
    for (const account of accounts) {
      const started = performance.now();
      try {
        const baseUrl = account.baseUrl
          .replace(/\/+$/, "")
          .replace(/\/v1$/, "");
        const response = await fetch(`${baseUrl}/v1/models`, {
          headers: { Authorization: `Bearer ${decrypt(account.apiKeyEnc)}` },
          signal: AbortSignal.timeout(25_000),
        });
        const data = (await response.json()) as {
          data?: { id?: string }[];
          error?: { message?: string };
        };
        console.log(
          JSON.stringify({
            accountId: account.id,
            providerId: account.providerId,
            account: account.name,
            status: response.status,
            ms: Math.round(performance.now() - started),
            models: data.data
              ?.map((model) => model.id)
              .filter((id) => typeof id === "string" && /image/i.test(id)),
            ...(!response.ok
              ? {
                  error: serializeProviderError(
                    new Error(data.error?.message ?? "Model listing failed"),
                  ),
                }
              : {}),
          }),
        );
      } catch (error) {
        console.log(
          JSON.stringify({
            accountId: account.id,
            error: serializeProviderError(error),
          }),
        );
      }
    }
    return;
  }

  if (!accountId || !process.argv.includes("--confirm-1-request"))
    throw new Error(
      "Use --models or --account=ID --model=ID --confirm-1-request.",
    );
  const account = accounts[0];
  const model = getModel(option("model") ?? "gpt-image-2");
  if (!model || !account.provider.modelsSupported.includes(model.id))
    throw new Error("Model is not configured for this account.");
  const adapter = new OpenAIImagesAdapter({
    id: account.id,
    name: account.name ?? account.provider.name,
    protocol: "openai-images",
    baseUrl: account.baseUrl,
    apiKey: decrypt(account.apiKeyEnc),
  });
  const started = performance.now();
  console.log(
    JSON.stringify({
      event: "start",
      accountId,
      providerId: account.providerId,
      modelId: model.id,
    }),
  );
  try {
    const result = await adapter.generate(
      {
        modelId: model.id,
        protocol: model.protocol,
        prompt:
          "A product photograph of a blue ceramic mug on a white table in soft daylight, no text.",
        size: "1024x1024",
        quality: model.defaults.quality ?? "auto",
        responseFormat: "b64_json",
        aspectRatio: "1:1",
        resolution: "1K",
        n: 1,
        outputFormat: "png",
        background: "auto",
        executionPolicy: "single-submit",
      },
      AbortSignal.timeout(150_000),
    );
    if (result.images.length !== 1)
      throw new Error("Expected one generated image.");
    const image = result.images[0];
    let bytes: Buffer;
    if (image.b64) {
      bytes = Buffer.from(
        image.b64.replace(/^data:[^;]+;base64,/, ""),
        "base64",
      );
    } else if (image.url && /^https?:\/\//.test(image.url)) {
      const response = await fetch(image.url, {
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok)
        throw new Error(`Generated image fetch failed: ${response.status}`);
      bytes = Buffer.from(await response.arrayBuffer());
    } else {
      throw new Error("No usable generated image.");
    }
    const metadata = await sharp(bytes).metadata();
    if (!metadata.width || !metadata.height)
      throw new Error("Generated image is not decodable.");
    console.log(
      JSON.stringify({
        ok: true,
        accountId,
        providerId: account.providerId,
        modelId: model.id,
        ms: Math.round(performance.now() - started),
        base64: Boolean(image.b64),
        bytes: bytes.length,
        width: metadata.width,
        height: metadata.height,
        format: metadata.format,
      }),
    );
  } catch (error) {
    console.log(
      JSON.stringify({
        ok: false,
        accountId,
        providerId: account.providerId,
        modelId: model.id,
        ms: Math.round(performance.now() - started),
        error: serializeProviderError(error),
      }),
    );
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(serializeProviderError(error));
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
