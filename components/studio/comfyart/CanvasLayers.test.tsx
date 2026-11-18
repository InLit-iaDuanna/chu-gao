import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Editor } from "tldraw";

vi.mock("tldraw", () => ({
  useValue: (_name: string, read: () => unknown) => read(),
}));
vi.mock("./vendor/CommentShape", () => ({ COMMENT: "comment" }));
import { CanvasLayers } from "./CanvasLayers";

function setup(locked = false) {
  const shape = {
    id: "shape:frame",
    type: "frame",
    props: { name: "画板", w: 1024, h: 1024 },
    meta: {},
    isLocked: locked,
  };
  const editor = {
    getCurrentPageShapesSorted: () => [shape],
    getSelectedShapeIds: () => [shape.id],
    getSelectedShapes: () => [shape],
    getOnlySelectedShape: () => shape,
    isShapeOrAncestorLocked: () => locked,
    markHistoryStoppingPoint: vi.fn(),
    updateShape: vi.fn(),
    setCurrentTool: vi.fn(),
    setSelectedShapes: vi.fn(),
    select: vi.fn(),
    bringToFront: vi.fn(),
    sendToBack: vi.fn(),
    zoomToSelection: vi.fn(),
    run: vi.fn((action: () => void) => action()),
  };
  render(
    <CanvasLayers editor={editor as unknown as Editor} onUsePrompt={vi.fn()} />,
  );
  return editor;
}

describe("canvas layer controls", () => {
  it("renames the frame and cancels a subsequent edit with Escape", () => {
    const editor = setup();
    fireEvent.click(screen.getByRole("button", { name: "重命名选中图层" }));
    fireEvent.change(screen.getByRole("textbox", { name: "图层名称" }), {
      target: { value: "主画板" },
    });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "图层名称" }), {
      key: "Enter",
    });
    expect(editor.updateShape).toHaveBeenCalledWith(
      expect.objectContaining({
        props: { name: "主画板" },
        meta: { name: "主画板" },
      }),
    );
    editor.updateShape.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "重命名选中图层" }));
    fireEvent.change(screen.getByRole("textbox", { name: "图层名称" }), {
      target: { value: "discard" },
    });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "图层名称" }), {
      key: "Escape",
    });
    expect(editor.updateShape).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("textbox", { name: "图层名称" }),
    ).not.toBeInTheDocument();
  });

  it("uses native ordering and toggles an already selected layer with Shift", () => {
    const editor = setup();
    fireEvent.click(screen.getByRole("button", { name: "置于顶层" }));
    fireEvent.click(screen.getByRole("button", { name: "置于底层" }));
    expect(editor.bringToFront).toHaveBeenCalledWith(["shape:frame"]);
    expect(editor.sendToBack).toHaveBeenCalledWith(["shape:frame"]);
    fireEvent.click(screen.getByRole("button", { name: /^画板$/ }), {
      shiftKey: true,
    });
    expect(editor.setCurrentTool).toHaveBeenCalledWith("select");
    expect(editor.setSelectedShapes).toHaveBeenCalledWith([]);
  });

  it("keeps locked properties read-only while allowing visibility and unlock", () => {
    const editor = setup(true);
    expect(screen.getByRole("button", { name: "置于顶层" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "重命名选中图层" }),
    ).toBeDisabled();
    expect(screen.getByRole("spinbutton", { name: "画板宽度" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "隐藏 画板" }));
    expect(editor.run).toHaveBeenCalledWith(expect.any(Function), {
      ignoreShapeLock: true,
    });
    expect(editor.updateShape).toHaveBeenCalledWith(
      expect.objectContaining({ meta: { hidden: true } }),
    );
    fireEvent.click(screen.getByRole("button", { name: "解锁 画板" }));
    expect(editor.updateShape).toHaveBeenCalledWith(
      expect.objectContaining({ isLocked: false }),
    );
  });
});
