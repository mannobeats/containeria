import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { PromptSheet } from "./prompt-sheet";

const rename = (open: boolean) => (
  <PromptSheet
    open={open}
    onOpenChange={() => undefined}
    title="Rename web"
    label="Name"
    initial="web"
    action="Rename"
    onSubmit={() => undefined}
  />
);

describe("PromptSheet", () => {
  it("starts again from the initial value each time it opens", async () => {
    const { rerender } = render(rename(true));
    const name = screen.getByRole<HTMLInputElement>("textbox", { name: "Name" });
    await userEvent.type(name, "-old");
    expect(name.value).toBe("web-old");
    rerender(rename(false));
    rerender(rename(true));
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Name" }).value).toBe("web");
  });
});
