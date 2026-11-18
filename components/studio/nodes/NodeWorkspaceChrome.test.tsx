import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { NodeOverview, NodeWorkspaceToolbar } from "./NodeWorkspaceChrome";

const toolbarProps = () => ({
  tabs: [
    { id: "main", name: "主画布" },
    { id: "second", name: "海报" },
  ],
  activeId: "main",
  onSelectTab: vi.fn(),
  onCreateTab: vi.fn(),
  onCloseTab: vi.fn(),
  onRenameTab: vi.fn(),
  tool: "select" as const,
  onToolChange: vi.fn(),
  onAdd: vi.fn(),
  onUndo: vi.fn(),
  onRedo: vi.fn(),
  canUndo: false,
  canRedo: false,
  onArrange: vi.fn(),
  onPublish: vi.fn(),
  onClear: vi.fn(),
  onRun: vi.fn(),
  readyCount: 0,
  runningCount: 0,
  saveState: "saved" as const,
  panelOpen: false,
  onTogglePanel: vi.fn(),
});

it("exposes tools, prevents an empty run and supports keyboard canvas switching", () => {
  const props = toolbarProps();
  render(<NodeWorkspaceToolbar {...props} />);
  expect(screen.getByRole("button", { name: "选择工具" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  fireEvent.click(screen.getByRole("button", { name: "平移工具" }));
  expect(props.onToolChange).toHaveBeenCalledWith("hand");
  expect(screen.getByRole("button", { name: /运行全部/ })).toBeDisabled();
  fireEvent.keyDown(screen.getByRole("tab", { name: "主画布" }), {
    key: "ArrowRight",
  });
  expect(props.onSelectTab).toHaveBeenCalledWith("second");
  expect(screen.getByRole("tab", { name: "海报" })).toHaveFocus();
});

it("renames a canvas with a validated inline application dialog", () => {
  const props = toolbarProps();
  render(<NodeWorkspaceToolbar {...props} />);
  fireEvent.doubleClick(screen.getByRole("tab", { name: "海报" }));
  const dialog = screen.getByRole("dialog", { name: "重命名画布" });
  const input = within(dialog).getByRole("textbox", { name: "画布名称" });
  fireEvent.change(input, { target: { value: " " } });
  expect(within(dialog).getByRole("button", { name: "保存" })).toBeDisabled();
  fireEvent.change(input, { target: { value: "  包装方案  " } });
  fireEvent.submit(input.closest("form")!);
  expect(props.onRenameTab).toHaveBeenCalledWith("second", "包装方案");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("focuses blocked generation nodes from the overview without running them", () => {
  const onFocus = vi.fn();
  render(
    <NodeOverview
      nodes={[{ id: "generate-a", kind: "generate", x: 0, y: 0, data: {} }]}
      runs={{}}
      hints={{ "generate-a": "需要提示词" }}
      selectedIds={[]}
      onFocus={onFocus}
      onClose={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /需要提示词/ }));
  expect(onFocus).toHaveBeenCalledWith("generate-a");
});
