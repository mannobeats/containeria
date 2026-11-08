import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { ForeignContext } from "@/lib/ipc/bindings";
import { engineFixture } from "@/test/fixtures";
import { mockCommands, renderWithApp } from "@/test/harness";

import { DockerContextBanner } from "./docker-context-banner";

const colima: ForeignContext = {
  name: "colima",
  endpoint: "unix:///Users/ada/.colima/default/docker.sock",
  answers: true,
};

function renderBanner(dockerContext: ForeignContext | null, fails = false) {
  let switched = false;
  const calls = mockCommands({
    engineStatus: () => engineFixture({ dockerContext: switched ? null : dockerContext }),
    engineUseDockerContext: () => {
      if (fails) {
        throw { kind: "internal", message: "config.json is read-only" };
      }
      switched = true;
      return null;
    },
  });
  renderWithApp(<DockerContextBanner />);
  return calls;
}

describe("DockerContextBanner", () => {
  it("names the context and its endpoint, then switches back to Containeria", async () => {
    const calls = renderBanner(colima);
    expect(await screen.findByText("colima")).toBeDefined();
    expect(screen.getByText(colima.endpoint ?? "")).toBeDefined();
    expect(screen.getByText("Another engine answers there.")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "Use Containeria" }));

    expect(calls).toContainEqual({ command: "engineUseDockerContext", args: {} });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Use Containeria" })).toBeNull(),
    );
  });

  it.each([
    [{ ...colima, answers: false }, "Nothing answers there, so docker commands fail."],
    [
      { name: "orbstack", endpoint: null, answers: false },
      "No context has that name, so docker commands fail.",
    ],
    [
      { name: "remote", endpoint: "ssh://ada@build-box", answers: null },
      "Containeria can't check whether it answers.",
    ],
  ])("says whether the endpoint answers", async (context, line) => {
    renderBanner(context);
    expect(await screen.findByText(line)).toBeDefined();
  });

  it("says why the switch didn't happen", async () => {
    renderBanner(colima, true);
    await userEvent.click(await screen.findByRole("button", { name: "Use Containeria" }));
    expect(await screen.findByText("config.json is read-only")).toBeDefined();
  });

  it("shows nothing while Docker uses Containeria", async () => {
    const calls = renderBanner(null);
    await waitFor(() => expect(calls.map((call) => call.command)).toContain("engineStatus"));
    expect(screen.queryByRole("status")).toBeNull();
  });
});
