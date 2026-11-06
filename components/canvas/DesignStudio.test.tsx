import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NumberField } from "./DesignNumberField";

afterEach(cleanup);

describe("NumberField", () => {
  it("commits a draft with Enter", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<NumberField label="宽" value={120} onChange={onChange} />);

    const input = screen.getByRole("spinbutton", { name: "宽" });
    await user.clear(input);
    await user.type(input, "240{Enter}");

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith(240);
  });

  it("restores the current value with Escape without committing", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<NumberField label="宽" value={120} onChange={onChange} />);

    const input = screen.getByRole("spinbutton", { name: "宽" });
    await user.clear(input);
    await user.type(input, "240{Escape}");

    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveValue(120);
  });
});
