import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ModelInfo } from "../lib/types";
import { ParamsPanel } from "./ParamsPanel";
import type { DockParams } from "../CommandDock";

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

  it("uses GIF request sizes and corrects the size when changing formats", () => {
    const model = {
      id: "gpt-image-2.6",
      displayName: "Image 2.6",
      available: true,
      capabilities: {
        maxN: 1,
        sizes: ["auto", "1024x1024"],
        gifSizes: ["512x512", "768x768"],
        outputFormats: ["png", "gif"],
      },
      defaults: { size: "1024x1024", outputFormat: "png" },
    } as ModelInfo;
    const onParamsChange = vi.fn();
    function Panel() {
      const [params, setParams] = useState<DockParams>({
        n: 1,
        size: "1024x1024",
        outputFormat: "png",
        referenceImages: [],
      });
      return (
        <ParamsPanel
          models={[model]}
          model={model}
          params={params}
          onSelectModel={vi.fn()}
          onParamsChange={(patch) => {
            onParamsChange(patch);
            setParams((current) => ({ ...current, ...patch }));
          }}
        />
      );
    }
    render(<Panel />);

    fireEvent.click(screen.getByRole("button", { name: "GIF" }));
    expect(onParamsChange).toHaveBeenLastCalledWith({
      outputFormat: "gif",
      size: "512x512",
    });
    expect(screen.getByRole("button", { name: "512x512 · 1:1" })).toBeVisible();
    expect(screen.getByRole("button", { name: "768x768 · 1:1" })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "自动" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/1024x1024/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "768x768 · 1:1" }));
    expect(onParamsChange).toHaveBeenLastCalledWith({ size: "768x768" });
    fireEvent.click(screen.getByRole("button", { name: "PNG" }));
    expect(onParamsChange).toHaveBeenLastCalledWith({
      outputFormat: "png",
      size: "1024x1024",
    });
    expect(screen.getByRole("button", { name: "自动" })).toBeVisible();
    expect(screen.queryByText(/512x512|768x768/)).not.toBeInTheDocument();
  });
});
