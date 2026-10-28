import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { containerFixture, engineFixture, metricsFixture } from "@/test/fixtures";
import { mockCommands, renderWithApp } from "@/test/harness";

import { ContainersPage } from "./containers-page";

const shopDb = containerFixture({
  id: "db",
  name: "shop-db-1",
  image: "postgres:18",
  project: "shop",
  ports: [{ container: 5432, host: 5433, protocol: "tcp" }],
});
const shopApi = containerFixture({
  id: "api",
  name: "shop-api-1",
  image: "shop/api",
  project: "shop",
});
const crashed = containerFixture({
  id: "mock",
  name: "payments-mock",
  state: "exited",
  status: "Exited (1) 3 minutes ago",
});
const pod = containerFixture({ id: "pod", name: "k8s_web", pod: "default/web" });

function setup() {
  const calls = mockCommands({
    engineStatus: () => engineFixture(),
    composeAct: () => 8,
    containersList: () => [shopDb, shopApi, crashed, pod],
    metricsLatest: () =>
      metricsFixture({
        containers: [{ id: "db", cpuPercent: 1.5, memoryBytes: 64 * 1024 ** 2 }],
        ledger: {
          totalBytes: 8 * 1024 ** 3,
          usedBytes: 64 * 1024 ** 2,
          segments: [{ id: "project:shop", label: "shop", kind: "project", bytes: 64 * 1024 ** 2 }],
        },
      }),
  });
  renderWithApp(<ContainersPage />);
  return calls;
}

describe("ContainersPage", () => {
  it("answers what runs and where the memory goes, and hides Kubernetes pods", async () => {
    setup();
    expect(await screen.findByText("shop-db-1")).toBeDefined();
    expect(screen.getByText(/containers running/).textContent).toContain("2 of 3");
    expect(screen.getByText(/uses the most/).textContent).toContain("shop");
    expect(screen.queryByText("k8s_web")).toBeNull();
    expect(screen.getByText("64 MB", { selector: "td" })).toBeDefined();
  });

  it("flags a crashed container with a banner", async () => {
    setup();
    const banner = await screen.findByRole("alert");
    expect(banner.textContent).toContain("payments-mock exited with code 1");
  });

  it("filters by search and by state", async () => {
    setup();
    await screen.findByText("shop-db-1");
    await userEvent.type(screen.getByPlaceholderText("Filter containers"), "api");
    expect(screen.queryByText("shop-db-1")).toBeNull();
    expect(screen.getByText("shop-api-1")).toBeDefined();
    await userEvent.clear(screen.getByPlaceholderText("Filter containers"));
    await userEvent.click(screen.getByRole("radio", { name: /Stopped/ }));
    expect(screen.queryByText("shop-api-1")).toBeNull();
    expect(screen.getByText("payments-mock", { selector: "span" })).toBeDefined();
  });

  it("stops a container from its row", async () => {
    const calls = setup();
    await userEvent.click(await screen.findByRole("button", { name: "Stop shop-db-1" }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        command: "containerAct",
        args: { id: "db", action: "stop" },
      }),
    );
  });

  it("asks before deleting the selected containers", async () => {
    const calls = setup();
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select shop-db-1" }));
    await userEvent.click(
      within(screen.getByRole("toolbar", { name: "Selected containers" })).getByRole("button", {
        name: "Delete",
      }),
    );
    await userEvent.click(await screen.findByRole("button", { name: "Delete container" }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        command: "containerAct",
        args: { id: "db", action: "remove" },
      }),
    );
  });

  it("rebuilds a project from its ⋯ menu", async () => {
    const calls = setup();
    await userEvent.click(await screen.findByRole("button", { name: "More for shop" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Rebuild and Restart" }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          command: "composeAct",
          args: expect.objectContaining({ project: "shop", verb: "rebuild" }),
        }),
      ),
    );
  });

  it("stops every container of a project from its right-click menu", async () => {
    const calls = setup();
    fireEvent.contextMenu(await screen.findByRole("button", { name: "Collapse shop" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Stop Project" }));
    await waitFor(() => {
      expect(calls).toContainEqual({ command: "containerAct", args: { id: "db", action: "stop" } });
      expect(calls).toContainEqual({
        command: "containerAct",
        args: { id: "api", action: "stop" },
      });
    });
  });

  it("stops the whole project while a search hides some of it", async () => {
    const calls = setup();
    await userEvent.type(await screen.findByPlaceholderText("Filter containers"), "api");
    expect(screen.getByText("2 of 2 running")).toBeDefined();
    fireEvent.contextMenu(screen.getByRole("button", { name: "Collapse shop" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Stop Project" }));
    await waitFor(() => {
      expect(calls).toContainEqual({ command: "containerAct", args: { id: "db", action: "stop" } });
      expect(calls).toContainEqual({
        command: "containerAct",
        args: { id: "api", action: "stop" },
      });
    });
  });

  it("forgets the volumes choice when the remove sheet is cancelled", async () => {
    setup();
    fireEvent.contextMenu(await screen.findByRole("button", { name: "Collapse shop" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Remove Project…" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Also delete its volumes" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.contextMenu(screen.getByRole("button", { name: "Collapse shop" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Remove Project…" }));
    expect(
      screen
        .getByRole("checkbox", { name: "Also delete its volumes" })
        .getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("removes a project with its volumes from its right-click menu", async () => {
    const calls = setup();
    fireEvent.contextMenu(await screen.findByRole("button", { name: "Collapse shop" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Remove Project…" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Also delete its volumes" }));
    await userEvent.click(screen.getByRole("button", { name: "Remove Project" }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          command: "composeAct",
          args: expect.objectContaining({ project: "shop", verb: "downWithVolumes" }),
        }),
      ),
    );
  });

  it("selects a run of containers with ⇧-click", async () => {
    setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("checkbox", { name: "Select shop-db-1" }));
    await user.keyboard("{Shift>}");
    await user.click(screen.getByRole("link", { name: /payments-mock/ }));
    await user.keyboard("{/Shift}");
    expect(screen.getByText("3 selected")).toBeDefined();
  });
});
