import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { containerFixture, engineFixture, networkFixture } from "@/test/fixtures";
import { mockCommands, renderWithApp } from "@/test/harness";

import { NetworkPage } from "./network-page";

const route = { path: "networks/$id", url: "/networks/n1" };

function setup() {
  const calls = mockCommands({
    engineStatus: () => engineFixture(),
    containersList: () => [
      containerFixture({ id: "db", name: "shop-db-1" }),
      containerFixture({ id: "api", name: "shop-api-1" }),
    ],
    networkDetail: () => ({
      network: networkFixture({ id: "n1", name: "shop_default", containers: ["shop-db-1"] }),
      endpoints: [
        {
          containerId: "db",
          container: "shop-db-1",
          ipv4: "172.18.0.2/16",
          mac: "02:42:ac:12:00:02",
        },
      ],
    }),
  });
  renderWithApp(<NetworkPage />, { route });
  return calls;
}

describe("NetworkPage", () => {
  it("shows each container's address and the network's details", async () => {
    setup();
    expect(await screen.findByText("172.18.0.2/16")).toBeDefined();
    expect(screen.getByText("02:42:ac:12:00:02")).toBeDefined();
    expect(screen.getAllByText("172.18.0.0/16").length).toBeGreaterThan(0);
  });

  it("disconnects a container", async () => {
    const calls = setup();
    await userEvent.click(await screen.findByRole("button", { name: "Disconnect shop-db-1" }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        command: "networkDisconnect",
        args: { network: "n1", container: "db" },
      }),
    );
  });

  it("connects a container that isn't on it yet", async () => {
    const calls = setup();
    await userEvent.click(await screen.findByRole("button", { name: "Connect container" }));
    expect((screen.getByRole("combobox", { name: "Container" }) as HTMLSelectElement).value).toBe(
      "shop-api-1",
    );
    await userEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        command: "networkConnect",
        args: { network: "n1", container: "shop-api-1" },
      }),
    );
  });

  it("says when the network is gone", async () => {
    mockCommands({
      engineStatus: () => engineFixture(),
      networkDetail: () => {
        throw { kind: "notFound", message: "network n1 not found" };
      },
    });
    renderWithApp(<NetworkPage />, { route });
    expect(await screen.findByText("This network was deleted")).toBeDefined();
  });
});
