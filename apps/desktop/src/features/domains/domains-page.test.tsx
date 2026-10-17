import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { DomainsStatus } from "@/lib/ipc/bindings";
import { containerFixture, engineFixture } from "@/test/fixtures";
import { mockCommands, renderWithApp } from "@/test/harness";

import { DomainsPage } from "./domains-page";

function status(overrides: Partial<DomainsStatus> = {}): DomainsStatus {
  return {
    enabled: true,
    tld: "containeria.local",
    https: true,
    ports: { dns: 15353, http: 80, https: 7443 },
    resolver: "installed",
    caTrusted: true,
    routes: [
      {
        host: "shop.test",
        kind: "custom",
        container: "shop-api-1",
        port: 8080,
        https: true,
        down: null,
      },
      {
        host: "web.shop.containeria.local",
        kind: "container",
        container: "shop-web-1",
        port: 3000,
        https: true,
        down: null,
      },
      {
        host: "redis.containeria.local",
        kind: "container",
        container: "redis",
        port: null,
        https: true,
        down: "notPublished",
      },
    ],
    ...overrides,
  };
}

function setup(domains: DomainsStatus) {
  const calls = mockCommands({
    domainsStatus: () => domains,
    engineStatus: () => engineFixture(),
    containersList: () => [
      containerFixture({ name: "shop-web-1" }),
      containerFixture({ id: "api", name: "shop-api-1" }),
    ],
  });
  renderWithApp(<DomainsPage />);
  return calls;
}

const called = (calls: { command: string }[], command: string) =>
  waitFor(() => expect(calls.map((call) => call.command)).toContain(command));

describe("DomainsPage", () => {
  it("offers to turn domains on", async () => {
    const calls = setup(status({ enabled: false }));
    await userEvent.click(await screen.findByRole("button", { name: "Turn on domains" }));
    await waitFor(() =>
      expect(calls).toContainEqual({ command: "domainsSetEnabled", args: { enabled: true } }),
    );
  });

  it("lists the user's routes before the containers, and says which are down", async () => {
    setup(status());
    expect(await screen.findByText("2 of 3")).toBeDefined();
    const rows = screen.getAllByRole("row").map((row) => row.textContent ?? "");
    const custom = rows.findIndex((text) => text.includes("shop.test"));
    const container = rows.findIndex((text) => text.includes("web.shop.containeria.local"));
    expect(custom).toBeLessThan(container);
    expect(screen.getByText("Port not published")).toBeDefined();
    expect(screen.getByText("HTTP 80 · HTTPS 7443 · DNS 15353")).toBeDefined();
  });

  it("asks before the one-time steps that change the Mac", async () => {
    const calls = setup(status({ resolver: "missing", caTrusted: false }));
    await userEvent.click(await screen.findByRole("button", { name: "Set up names" }));
    await called(calls, "domainsInstallResolver");
    await userEvent.click(screen.getByRole("button", { name: "Trust certificate" }));
    await called(calls, "domainsTrustCa");
  });

  it("adds a route and refuses an invalid name", async () => {
    const calls = setup(status());
    await userEvent.click(await screen.findByRole("button", { name: "Add route" }));
    const host = await screen.findByLabelText("Domain");
    await userEvent.type(host, "not a host");
    await userEvent.click(screen.getByRole("button", { name: "Add route" }));
    expect(await screen.findByText("Use a name like shop.test")).toBeDefined();
    await userEvent.clear(host);
    await userEvent.type(host, "blog.test");
    await userEvent.click(screen.getByRole("button", { name: "Add route" }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        command: "domainsAddRoute",
        args: { route: { host: "blog.test", container: "shop-web-1", port: 3000, https: true } },
      }),
    );
  });

  it("removes a custom route after confirming", async () => {
    const calls = setup(status());
    await userEvent.click(await screen.findByRole("button", { name: "More for shop.test" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Remove route…" }));
    await userEvent.click(await screen.findByRole("button", { name: "Remove route" }));
    await waitFor(() =>
      expect(calls).toContainEqual({ command: "domainsRemoveRoute", args: { host: "shop.test" } }),
    );
  });

  it("removes what it changed on the Mac from the settings", async () => {
    const calls = setup(status());
    await userEvent.click(await screen.findByRole("button", { name: "Remove" }));
    await called(calls, "domainsUninstallResolver");
    await userEvent.click(screen.getByRole("button", { name: "Remove from Keychain" }));
    await called(calls, "domainsUntrustCa");
    await userEvent.click(screen.getByRole("switch", { name: "Domains" }));
    await waitFor(() =>
      expect(calls).toContainEqual({ command: "domainsSetEnabled", args: { enabled: false } }),
    );
  });
});
