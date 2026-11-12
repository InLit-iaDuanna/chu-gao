import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GenerationCard } from "./GenerationCard";
import { ToastProvider } from "@/components/ui";
import type { Generation } from "./lib/types";

const generation = {
  id: "gif-generation",
  prompt: "动画预览",
  status: "SUCCEEDED",
  outputFormat: "gif",
  size: "512x512",
  createdAt: "2026-11-07T10:00:00Z",
  images: [
    {
      id: "gif-image",
      mimeType: "image/gif",
      url: "/api/images/gif-image",
      thumbnailUrl: "/api/images/gif-image?thumbnail=1",
      width: 816,
      height: 816,
    },
  ],
} as Generation;

describe("GIF generation previews", () => {
  it.each(["conversation", "wall"] as const)(
    "uses the correct preview URL in the %s view",
    (variant) => {
      const onOpen = vi.fn();
      render(
        <GenerationCard
          generation={generation}
          variant={variant}
          onOpen={onOpen}
          onCancel={vi.fn()}
          onRetry={vi.fn()}
          onUseAsReference={vi.fn()}
        />,
        { wrapper: ToastProvider },
      );
      expect(screen.getByRole("img")).toHaveAttribute(
        "src",
        variant === "conversation"
          ? generation.images[0].url
          : generation.images[0].thumbnailUrl,
      );
      fireEvent.click(screen.getByRole("button", { name: "查看第 1 张大图" }));
      expect(onOpen).toHaveBeenCalledWith(generation, 0);
    },
  );

  it("keeps PNG conversation previews on their thumbnail URL", () => {
    render(
      <GenerationCard
        generation={{
          ...generation,
          outputFormat: "png",
          images: [{ ...generation.images[0], mimeType: "image/png" }],
        }}
        variant="conversation"
        onOpen={vi.fn()}
        onCancel={vi.fn()}
        onRetry={vi.fn()}
        onUseAsReference={vi.fn()}
      />,
    );
    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      generation.images[0].thumbnailUrl,
    );
  });
});
