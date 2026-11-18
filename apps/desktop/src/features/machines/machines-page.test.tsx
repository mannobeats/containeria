import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Distro, Machine } from "@/lib/ipc/bindings";
import { mockCommands, renderWithApp } from "@/test/harness";

import { distrosFixture, machineFixture } from "./fixtures";
import { MachinesPage } from "./machines-page";
import { useNewMachineSheet } from "./new-machine-store";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: () => Promise.resolve("/Users/ada/Desktop/ubuntu-dev.tar.gz"),
  save: () => Promise.resolve("/Users/ada/Desktop/ubuntu-dev.tar.gz"),
}));

beforeEach(() => useNewMachineSheet.setState({ open: false }));

function setup(machines: Machine[] = [machineFixture()], distros: Distro[] = distrosFixture) {
  const calls = mockCommands({
    machinesList: () => machines,
    machineDistros: () => distros,
    machineShellCommand: () =>
      "DOCKER_HOST='unix:///s' 'docker' exec -it 'contena-machine-ubuntu-dev' su - 'ada'",
  });
  renderWithApp(<MachinesPage />);
  return calls;
}

const arch = machineFixture({
  name: "arch-lab",
  distro: "Archlinux",
  release: "current",
  state: "stopped",
  ipv4: null,
});

describe("MachinesPage", () => {
  it("shows each machine as a card with its state and usage", async () => {
    setup([machineFixture(), arch]);
    expect(await screen.findByText("ubuntu-dev")).toBeDefined();
    expect(screen.getByText(/running, using/).textContent).toContain("1 of 2 machines");
    expect(screen.getAllByText(/310 MB/)).toHaveLength(2);
    expect(screen.getByTitle("Arch Linux")).toBeDefined();
  });

  it("stops and starts machines from their cards", async () => {
    const calls = setup([machineFixture(), arch]);
    await userEvent.click(await screen.findByRole("button", { name: "Stop" }));
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() =>
      expect(
        calls.filter((call) => call.command === "machineAct").map((call) => call.args),
      ).toEqual([
        { name: "ubuntu-dev", action: "stop" },
        { name: "arch-lab", action: "start" },
      ]),
    );
  });

  it("says what a machine is before the first one", async () => {
    setup([]);
    expect(await screen.findByRole("heading", { name: "No Linux machines yet" })).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "New machine" }));
    expect(await screen.findByRole("dialog", { name: "New Linux machine" })).toBeDefined();
  });

  it("asks before deleting a machine", async () => {
    const calls = setup();
    await userEvent.click(await screen.findByRole("button", { name: "More for ubuntu-dev" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Delete Machine…" }));
    const sheet = await screen.findByRole("dialog", { name: "Delete ubuntu-dev?" });
    await userEvent.click(within(sheet).getByRole("button", { name: "Delete machine" }));
    await waitFor(() =>
      expect(calls).toContainEqual({ command: "machineDelete", args: { name: "ubuntu-dev" } }),
    );
  });
});

describe("machine menu", () => {
  async function choose(item: string) {
    await userEvent.click(await screen.findByRole("button", { name: "More for ubuntu-dev" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: item }));
  }

  it("clones a machine under a free name", async () => {
    const calls = setup([machineFixture(), machineFixture({ name: "ubuntu-dev-copy" })]);
    await choose("Clone…");
    const sheet = await screen.findByRole("dialog", { name: "Clone ubuntu-dev" });
    expect(within(sheet).getByLabelText("Name")).toHaveProperty("value", "ubuntu-dev-copy-2");
    await userEvent.click(within(sheet).getByRole("button", { name: "Clone" }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        command: "machineClone",
        args: { name: "ubuntu-dev", to: "ubuntu-dev-copy-2" },
      }),
    );
  });

  it("exports a machine to the file picked in the save panel", async () => {
    const calls = setup();
    await choose("Export…");
    await waitFor(() =>
      expect(calls).toContainEqual({
        command: "machineExport",
        args: { name: "ubuntu-dev", destination: "/Users/ada/Desktop/ubuntu-dev.tar.gz" },
      }),
    );
  });

  it("opens the machine in Terminal", async () => {
    const calls = setup();
    await choose("Open in Terminal App");
    await waitFor(() =>
      expect(calls).toContainEqual({
        command: "machineOpenTerminal",
        args: { name: "ubuntu-dev" },
      }),
    );
  });

  it("copies the shell command", async () => {
    const calls = setup();
    await choose("Copy Shell Command");
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          args: expect.objectContaining({
            text: "DOCKER_HOST='unix:///s' 'docker' exec -it 'contena-machine-ubuntu-dev' su - 'ada'",
          }),
        }),
      ),
    );
  });

  it("imports an exported machine under a free name", async () => {
    const calls = setup();
    await userEvent.click(await screen.findByRole("button", { name: "Import…" }));
    const sheet = await screen.findByRole("dialog", { name: "Import a machine" });
    expect(within(sheet).getByLabelText("Name")).toHaveProperty("value", "ubuntu-dev-2");
    await userEvent.click(within(sheet).getByRole("button", { name: "Import" }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        command: "machineImport",
        args: { source: "/Users/ada/Desktop/ubuntu-dev.tar.gz", name: "ubuntu-dev-2" },
      }),
    );
  });
});

describe("NewMachineSheet", () => {
  async function openSheet(
    machines: Machine[] = [machineFixture({ name: "ubuntu" })],
    distros: Distro[] = distrosFixture,
  ) {
    const calls = setup(machines, distros);
    const [newButton] = await screen.findAllByRole("button", { name: /New machine/ });
    await userEvent.click(newButton as HTMLElement);
    return { calls, sheet: await screen.findByRole("dialog", { name: "New Linux machine" }) };
  }

  it("suggests a free name and creates the machine", async () => {
    const { calls, sheet } = await openSheet();
    expect(within(sheet).getByLabelText("Name")).toHaveProperty("value", "ubuntu-2");
    await userEvent.click(within(sheet).getByRole("radio", { name: /Debian/ }));
    expect(within(sheet).getByLabelText("Name")).toHaveProperty("value", "debian");
    await userEvent.selectOptions(within(sheet).getByLabelText("Memory"), "8");
    await userEvent.click(within(sheet).getByRole("switch", { name: "Mount my Mac home folder" }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Create machine" }));
    await waitFor(() =>
      expect(calls.find((call) => call.command === "machineCreate")?.args.request).toEqual({
        name: "debian",
        distro: "debian",
        release: "13",
        cpus: 2,
        memoryGib: 8,
        mountHome: false,
      }),
    );
  });

  it("starts from a fresh form after creating a machine", async () => {
    const { calls, sheet } = await openSheet();
    const name = within(sheet).getByLabelText("Name");
    await userEvent.clear(name);
    await userEvent.type(name, "dev");
    await userEvent.click(within(sheet).getByRole("button", { name: "Create machine" }));
    await waitFor(() => expect(calls.map((call) => call.command)).toContain("machineCreate"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    useNewMachineSheet.setState({ open: true });
    const again = await screen.findByRole("dialog", { name: "New Linux machine" });
    expect(within(again).getByLabelText("Name")).toHaveProperty("value", "ubuntu-2");
  });

  it("can't create without a distribution to pick", async () => {
    const { sheet } = await openSheet(undefined, []);
    expect(within(sheet).getByRole("button", { name: "Create machine" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("refuses a name that isn't a host name", async () => {
    const { sheet } = await openSheet();
    const name = within(sheet).getByLabelText("Name");
    await userEvent.clear(name);
    await userEvent.type(name, "Dev Box");
    expect(within(sheet).getByRole("alert").textContent).toBe(
      "Start the name with a lowercase letter.",
    );
    expect(within(sheet).getByRole("button", { name: "Create machine" })).toHaveProperty(
      "disabled",
      true,
    );
  });
});
