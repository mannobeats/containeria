import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it } from "vitest";

import { containerFixture, engineFixture, networkFixture } from "@/test/fixtures";
import { mockCommands, renderWithApp } from "@/test/harness";
import { Toaster } from "@/ui/toaster";

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
  renderWithApp(
    <>
      <NetworkPage />
      <Toaster />
    </>,
    { route },
  );
  return calls;
}

beforeEach(() => {
  toast.dismiss();
});

describe("NetworkPage", () => {
  it("shows each container's address", async () => {
    setup();
    expect(await screen.findByText("172.18.0.2/16")).toBeDefined();
    expect(screen.getByText("02:42:ac:12:00:02")).toBeDefined();
    expect(screen.getByText("1 container")).toBeDefined();
  });

  it("shows the network's details", async () => {
    setup();
    const details = (await screen.findByRole("heading", { name: "Details" })).parentElement;
    expect(details?.textContent).toContain("172.18.0.0/16");
    expect(details?.textContent).toContain("local");
    expect(details?.textContent).toContain("No");
  });

  it("disconnects a container and names it in the toast", async () => {
    const calls = setup();
    await userEvent.click(await screen.findByRole("button", { name: "Disconnect shop-db-1" }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        command: "networkDisconnect",
        args: { network: "n1", container: "db" },
      }),
    );
    expect(await screen.findByText("shop-db-1 left shop_default")).toBeDefined();
  });

  it("copies a container's address without its prefix", async () => {
    const calls = setup();
    fireEvent.contextMenu(await screen.findByText("172.18.0.2/16"));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Copy IP Address" }));
    await waitFor(() =>
      expect(calls.find((call) => String(call.command).endsWith("writeText"))?.args).toMatchObject({
        text: "172.18.0.2",
      }),
    );
  });

  it("won't delete a network containers are on", async () => {
    setup();
    const remove = await screen.findByRole("button", { name: /1 container is connected/ });
    expect(remove.getAttribute("aria-disabled")).toBe("true");
    act(() => remove.focus());
    expect(document.activeElement).toBe(remove);
    expect((await screen.findByRole("tooltip")).textContent).toContain(
      "Disconnect or stop it first",
    );
    await userEvent.click(remove);
    expect(screen.queryByRole("dialog")).toBeNull();
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

  it("offers to try again when the network can't be read", async () => {
    mockCommands({
      engineStatus: () => engineFixture(),
      networkDetail: () => {
        throw { kind: "engineStopped", message: "the engine didn't answer" };
      },
    });
    renderWithApp(<NetworkPage />, { route });
    expect(await screen.findByText("This network couldn't be read")).toBeDefined();
    expect(screen.getByText("the engine didn't answer")).toBeDefined();
    expect(screen.getByRole("button", { name: "Try Again" })).toBeDefined();
  });
});
