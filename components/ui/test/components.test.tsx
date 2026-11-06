import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { Button } from "../Button";
import { FormField } from "../FormField";
import { IconButton } from "../IconButton";
import { Input } from "../Input";
import { Select } from "../Select";
import { Switch } from "../Switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../Tabs";
import { Textarea } from "../Textarea";

describe("UI controls", () => {
  it("disables a loading button and exposes busy state", () => {
    render(<Button loading>保存</Button>);
    expect(screen.getByRole("button", { name: /保存/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /保存/ })).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  it("keeps disabled buttons visible with explicit semantic colors", () => {
    render(<Button disabled>保存</Button>);
    const button = screen.getByRole("button", { name: "保存" });
    expect(button).toHaveClass("disabled:opacity-100");
    expect(button).toHaveClass(
      "disabled:border-[rgb(var(--control-disabled-border))]",
    );
    expect(button).not.toHaveClass("disabled:opacity-45");
  });

  it("renders IconButton variants with a non-shrinking icon", () => {
    const { rerender } = render(
      <IconButton aria-label="工具" variant="primary">
        <svg data-testid="tool-icon" />
      </IconButton>,
    );
    expect(screen.getByRole("button", { name: "工具" })).toHaveClass(
      "bg-[rgb(var(--brand-primary))]",
    );
    expect(screen.getByTestId("tool-icon")).toHaveClass("shrink-0");

    rerender(
      <IconButton aria-label="工具" variant="outline">
        <svg data-testid="tool-icon" />
      </IconButton>,
    );
    expect(screen.getByRole("button", { name: "工具" })).toHaveClass(
      "border-[rgb(var(--control-border))]",
    );
  });

  it("exposes selected and loading IconButton states", () => {
    const { rerender } = render(
      <IconButton aria-label="布局" selected>
        <svg data-testid="layout-icon" />
      </IconButton>,
    );
    const selectedButton = screen.getByRole("button", { name: "布局" });
    expect(selectedButton).toHaveAttribute("aria-pressed", "true");
    expect(selectedButton).toHaveClass("bg-[rgb(var(--control-selected-bg))]");

    rerender(
      <IconButton aria-label="布局" loading>
        <svg data-testid="layout-icon" />
      </IconButton>,
    );
    const loadingButton = screen.getByRole("button", { name: "布局" });
    expect(loadingButton).toBeDisabled();
    expect(loadingButton).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByTestId("layout-icon")).not.toBeInTheDocument();
  });

  it("uses readable placeholder colors for text controls", () => {
    render(
      <>
        <Input aria-label="标题" placeholder="输入标题" />
        <Textarea aria-label="描述" placeholder="输入描述" />
      </>,
    );
    expect(screen.getByRole("textbox", { name: "标题" })).toHaveClass(
      "placeholder:text-text-muted",
    );
    expect(screen.getByRole("textbox", { name: "描述" })).toHaveClass(
      "placeholder:text-text-muted",
    );
  });

  it("keeps the legacy Input size prop compatible", () => {
    const { rerender } = render(<Input aria-label="兼容输入" inputSize="lg" />);
    expect(screen.getByRole("textbox", { name: "兼容输入" })).toHaveClass(
      "h-10",
    );

    rerender(<Input aria-label="兼容输入" controlSize="sm" inputSize="lg" />);
    expect(screen.getByRole("textbox", { name: "兼容输入" })).toHaveClass(
      "h-7",
    );
  });

  it("associates form labels, descriptions, and errors", () => {
    render(
      <FormField label="邮箱" description="用于登录" error="格式错误">
        <Input />
      </FormField>,
    );
    const input = screen.getByRole("textbox", { name: "邮箱" });
    expect(input).toHaveAccessibleDescription("用于登录 格式错误");
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("updates a controlled switch once per click", async () => {
    const user = userEvent.setup();
    function Example(): React.ReactElement {
      const [checked, setChecked] = useState(false);
      return (
        <Switch aria-label="通知" checked={checked} onChange={setChecked} />
      );
    }
    render(<Example />);
    const control = screen.getByRole("switch", { name: "通知" });
    await user.click(control);
    expect(control).toHaveAttribute("aria-checked", "true");
  });

  it("selects an option with keyboard-accessible Radix select", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <Select
        aria-label="模型"
        defaultValue="a"
        options={[
          { value: "a", label: "模型 A" },
          { value: "b", label: "模型 B" },
        ]}
        onValueChange={onValueChange}
      />,
    );
    await user.click(screen.getByRole("combobox", { name: "模型" }));
    await user.click(screen.getByRole("option", { name: "模型 B" }));
    expect(onValueChange).toHaveBeenCalledWith("b");
  });

  it("moves between tab panels", async () => {
    const user = userEvent.setup();
    render(
      <Tabs defaultValue="one">
        <TabsList aria-label="视图">
          <TabsTrigger value="one">一</TabsTrigger>
          <TabsTrigger value="two">二</TabsTrigger>
        </TabsList>
        <TabsContent value="one">内容一</TabsContent>
        <TabsContent value="two">内容二</TabsContent>
      </Tabs>,
    );
    await user.click(screen.getByRole("tab", { name: "二" }));
    expect(screen.getByRole("tabpanel")).toHaveTextContent("内容二");
  });
});
