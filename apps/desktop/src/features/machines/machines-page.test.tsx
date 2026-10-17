import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import type { EnginePhase, Machine } from "@/lib/ipc/bindings";
import { mockCommands, renderWithApp } from "@/test/harness";

import { distrosFixture, machineFixture, machinesStatusFixture } from "./fixtures";
import { MachinesPage } from "./machines-page";
import { useNewMachineSheet } from "./new-machine-store";

beforeEach(() => useNewMachineSheet.setState({ open: false }));

function setup(
  phase: EnginePhase = "running",
  machines: Machine[] = [machineFixture()],
  supportsVms = false,
) {
  const calls = mockCommands({
    machinesStatus: () => machinesStatusFixture({ phase, supportsVms }),
    machinesList: () => machines,
    machineDistros: () => distrosFixture,
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
    setup("running", [machineFixture(), arch]);
    expect(await screen.findByText("ubuntu-dev")).toBeDefined();
    expect(screen.getByText(/running, using/).textContent).toContain("1 of 2 machines");
    expect(screen.getAllByText(/310 MB/)).toHaveLength(2);
    expect(screen.getByTitle("Arch Linux")).toBeDefined();
  });

  it("stops and starts machines from their cards", async () => {
    const calls = setup("running", [machineFixture(), arch]);
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

  it("explains the machines VM before the first machine", async () => {
    setup("notCreated", []);
    expect(await screen.findByRole("heading", { name: "No Linux machines yet" })).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "New machine" }));
    expect(await screen.findByRole("dialog", { name: "New Linux machine" })).toBeDefined();
  });

  it("starts a stopped machines VM", async () => {
    const calls = setup("stopped", []);
    await userEvent.click(await screen.findByRole("button", { name: "Start Linux machines" }));
    await waitFor(() => expect(calls.map((call) => call.command)).toContain("machinesStart"));
  });

  it("says when Colima is missing or the VM is booting", async () => {
    setup("missing", []);
    expect(await screen.findByText("brew install colima")).toBeDefined();
  });

  it("shows progress while the machines VM starts", async () => {
    setup("starting", []);
    expect(await screen.findByRole("progressbar", { name: "Machines progress" })).toBeDefined();
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

describe("NewMachineSheet", () => {
  async function openSheet(
    supportsVms: boolean,
    machines: Machine[] = [machineFixture({ name: "ubuntu" })],
  ) {
    const calls = setup("running", machines, supportsVms);
    const [newButton] = await screen.findAllByRole("button", { name: /New machine/ });
    await userEvent.click(newButton as HTMLElement);
    return { calls, sheet: await screen.findByRole("dialog", { name: "New Linux machine" }) };
  }

  it("suggests a free name and creates the machine", async () => {
    const { calls, sheet } = await openSheet(false);
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
        kind: "container",
        cpus: 2,
        memoryGib: 8,
        mountHome: false,
      }),
    );
  });

  it("refuses a name Incus wouldn't take", async () => {
    const { sheet } = await openSheet(false);
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

  it("offers full VMs only on Macs that can nest them", async () => {
    const { sheet } = await openSheet(true);
    await userEvent.click(within(sheet).getByRole("radio", { name: "Full VM" }));
    expect(within(sheet).getByText(/runs its own kernel/)).toBeDefined();
  });

  it("explains why full VMs are missing", async () => {
    const { sheet } = await openSheet(false);
    expect(within(sheet).queryByRole("radio", { name: "Full VM" })).toBeNull();
    expect(within(sheet).getByText(/M3 or newer/)).toBeDefined();
  });
});
