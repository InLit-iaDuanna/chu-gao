import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { Lightbox } from "./Lightbox";
import { ToastProvider } from "@/components/ui";

it("uses the original URL for GIF previews at both zoom levels", () => {
  const url = "/api/images/animation";
  render(
    <Lightbox
      state={{
        generation: {
          prompt: "动画预览",
          images: [{ id: "animation", url, downloadUrl: `${url}?download=1` }],
        },
        index: 0,
      }}
      onClose={vi.fn()}
      onNavigate={vi.fn()}
    />,
    { wrapper: ToastProvider },
  );
  expect(screen.getByRole("img")).toHaveAttribute("src", url);
  fireEvent.click(screen.getByRole("button", { name: "查看原尺寸" }));
  expect(screen.getByRole("img")).toHaveAttribute("src", url);
});
