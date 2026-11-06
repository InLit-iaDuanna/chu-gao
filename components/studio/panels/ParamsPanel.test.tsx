import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ModelInfo } from "../lib/types";
import { ParamsPanel } from "./ParamsPanel";

describe("public generation parameters", () => {
  it("shows model parameters without provider names or account counts", () => {
    const model = {
      id: "gpt-image-2.5-flare",
      displayName: "Image 2.5 Flare",
      available: true,
      capabilities: {
        maxN: 1,
        sizes: ["1024x1024"],
        qualities: ["low", "medium", "high", "xhigh", "max"],
        outputFormats: ["png"],
      },
      defaults: {
        size: "1024x1024",
        quality: "high",
        outputFormat: "png",
      },
      providerChannels: [
        {
          id: "adobe",
          displayName: "Adobe",
          accountCount: 2,
          availableAccountCount: 1,
        },
        {
          id: "openai",
          displayName: "OpenAI",
          accountCount: 4,
          availableAccountCount: 3,
        },
      ],
    } as ModelInfo;
    render(
      <ParamsPanel
        models={[model]}
        model={model}
        params={{ n: 1, referenceImages: [] }}
        onSelectModel={vi.fn()}
        onParamsChange={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Image 2.5 Flare" }),
    ).toBeVisible();
    expect(screen.getByText("尺寸")).toBeVisible();
    expect(screen.getByRole("slider", { name: "生成质量" })).toHaveValue("2");
    expect(
      screen.queryByText(/Adobe|OpenAI|渠道|自动分配|1\/2|3\/4/),
    ).not.toBeInTheDocument();
  });
});
