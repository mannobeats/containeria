import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { containerFixture, engineFixture, networkFixture } from "@/test/fixtures";
import { mockCommands, renderWithApp } from "@/test/harness";

import { NetworksPage } from "./networks-page";

function setup() {
  const calls = mockCommands({
    engineStatus: () => engineFixture(),
    containersList: () => [containerFixture({ id: "db", name: "shop-db-1", image: "postgres:18" })],
    networksList: () => [
      networkFixture({ id: "n1", name: "shop_default", containers: ["shop-db-1"] }),
      networkFixture({
        id: "n2",
        name: "bridge",
        builtIn: true,
        project: null,
        subnet: "172.17.0.0/16",
      }),
    ],
  });
  renderWithApp(<NetworksPage />);
  return calls;
}

describe("NetworksPage", () => {
  it("lists project and built-in networks with their containers", async () => {
    setup();
    expect(await screen.findByText("shop_default")).toBeDefined();
    expect(screen.getByText(/1 project network and 1 built in/)).toBeDefined();
    expect(screen.getByText("Built in")).toBeDefined();
    expect(screen.getByText("shop-db-1")).toBeDefined();
  });

  it("searches by subnet", async () => {
    setup();
    await screen.findByText("shop_default");
    await userEvent.type(screen.getByPlaceholderText("Filter networks"), "172.17");
    expect(screen.queryByText("shop_default")).toBeNull();
  });

  it("creates a network with a subnet", async () => {
    const calls = setup();
    await userEvent.click(await screen.findByRole("button", { name: "New network" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Name" }), "payments_net");
    await userEvent.type(screen.getByRole("textbox", { name: "Subnet" }), "172.23.0.0/16");
    await userEvent.click(screen.getByRole("switch", { name: "Internal only" }));
    await userEvent.click(screen.getByRole("button", { name: "Create network" }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        command: "networkCreate",
        args: {
          spec: {
            name: "payments_net",
            driver: "bridge",
            subnet: "172.23.0.0/16",
            gateway: null,
            internal: true,
            ipv6: false,
          },
        },
      }),
    );
  });

  it("deletes a project network but not a built-in one", async () => {
    const calls = setup();
    await userEvent.click(await screen.findByRole("button", { name: "More for bridge" }));
    expect(
      (await screen.findByRole("menuitem", { name: /can't be deleted/i })).getAttribute(
        "aria-disabled",
      ),
    ).toBe("true");
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "More for shop_default" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Delete Network…" }));
    await userEvent.click(await screen.findByRole("button", { name: "Delete network" }));
    await waitFor(() =>
      expect(calls).toContainEqual({ command: "networkRemove", args: { id: "n1" } }),
    );
  });

  it("can't select a built-in network or one with containers on it", async () => {
    setup();
    await screen.findByText("shop_default");
    for (const name of ["Select shop_default", "Select bridge"]) {
      expect((screen.getByRole("checkbox", { name }) as HTMLButtonElement).disabled).toBe(true);
    }
  });
});
