import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Menu } from "./menu";

describe("Menu", () => {
  it("opens from an accessibility press, which clicks without a pointer", () => {
    const onSelect = vi.fn();
    render(
      <Menu entries={[{ label: "Delete…", onSelect }]}>
        <button type="button">More</button>
      </Menu>,
    );
    fireEvent.click(screen.getByRole("button", { name: "More" }), { detail: 0 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete…" }));
    expect(onSelect).toHaveBeenCalledOnce();
  });
});
