import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { renderWithApp } from "@/test/harness";

import { Crumb, Page } from "./page";
import { useUi } from "./ui-store";

describe("Page", () => {
  afterEach(() => {
    useUi.setState({ sidebarCollapsed: false });
  });

  it("brings a hidden sidebar back from beside the traffic lights", async () => {
    useUi.setState({ sidebarCollapsed: true });
    renderWithApp(<Page crumbs={<Crumb>Containers</Crumb>}>Rows</Page>);
    await userEvent.click(await screen.findByRole("button", { name: "Show sidebar" }));
    expect(useUi.getState().sidebarCollapsed).toBe(false);
    expect(screen.queryByRole("button", { name: "Show sidebar" })).toBeNull();
  });
});
