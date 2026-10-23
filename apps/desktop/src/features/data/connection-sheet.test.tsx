import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { Connection, HostKey } from "@/lib/ipc/bindings";
import { connectionFixture } from "@/test/data-fixtures";
import { type Call, mockCommands, renderWithApp } from "@/test/harness";

import { ConnectionSheet } from "./connection-sheet";

const hostKey: HostKey = {
  host: "bastion.example.com",
  port: 22,
  algorithm: "ssh-ed25519",
  fingerprint: "SHA256:uNiVztksCsDhcc0u9e8BujQXVUpKZIDTMczCvj3tD2s",
  key: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAno8D5JcQq9RdmRAcG/7QqeoC8Xje1P3mwHc549udK",
};

const tunneled = connectionFixture({
  ssh: {
    host: "bastion.example.com",
    port: 22,
    user: "deploy",
    auth: "password",
    keyFile: null,
  },
  hasSshSecret: true,
});

function open(connection: Connection, test: () => string) {
  const calls = mockCommands({ dataTestConnection: test, dataSshHostKey: () => hostKey });
  renderWithApp(<ConnectionSheet open onOpenChange={() => undefined} connection={connection} />);
  return calls;
}

const tests = (calls: Call[]) => calls.filter((call) => call.command === "dataTestConnection");

describe("ConnectionSheet over SSH", () => {
  it("tests through a tunnel that logs in with a key file", async () => {
    const calls = open(connectionFixture(), () => "PostgreSQL 18.0");
    const sheet = await screen.findByRole("dialog");
    await userEvent.click(within(sheet).getByRole("switch", { name: "Connect over SSH" }));
    await userEvent.type(within(sheet).getByLabelText("SSH host"), "bastion.example.com");
    await userEvent.type(within(sheet).getByLabelText("SSH user"), "deploy");
    expect(within(sheet).getByText(/Uses the keys in ssh-agent/)).toBeDefined();
    await userEvent.click(within(sheet).getByRole("radio", { name: "Key file" }));
    await userEvent.type(within(sheet).getByLabelText("Private key"), "~/.ssh/id_ed25519");
    await userEvent.type(within(sheet).getByLabelText("Passphrase"), "hunter2");
    await userEvent.click(within(sheet).getByRole("button", { name: "Test connection" }));
    expect(await within(sheet).findByText("PostgreSQL 18.0")).toBeDefined();
    expect(tests(calls)[0]?.args).toMatchObject({
      input: {
        host: "db.internal",
        ssh: {
          host: "bastion.example.com",
          port: 22,
          user: "deploy",
          auth: "key",
          keyFile: "~/.ssh/id_ed25519",
        },
        sshSecret: "hunter2",
      },
    });
  });

  it("names a missing SSH field before dialling", async () => {
    const calls = open(connectionFixture(), () => "PostgreSQL 18.0");
    const sheet = await screen.findByRole("dialog");
    await userEvent.click(within(sheet).getByRole("switch", { name: "Connect over SSH" }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Test connection" }));
    expect(within(sheet).getByRole("alert").textContent).toBe("Enter the SSH host.");
    expect(tests(calls)).toHaveLength(0);
  });

  it("keeps the saved SSH password unless it is typed again", async () => {
    const calls = open(tunneled, () => "PostgreSQL 18.0");
    const sheet = await screen.findByRole("dialog");
    expect((within(sheet).getByLabelText("SSH host") as HTMLInputElement).value).toBe(
      "bastion.example.com",
    );
    expect(within(sheet).getByLabelText("SSH password")).toBeDefined();
    await userEvent.click(within(sheet).getByRole("button", { name: "Test connection" }));
    await waitFor(() => expect(tests(calls)).toHaveLength(1));
    expect(tests(calls)[0]?.args).toMatchObject({ input: { password: null, sshSecret: null } });
  });

  it("says when the tunnel failed rather than the database", async () => {
    open(tunneled, () => {
      throw { kind: "ssh", message: "SSH to bastion.example.com failed: connection refused" };
    });
    const sheet = await screen.findByRole("dialog");
    await userEvent.click(within(sheet).getByRole("button", { name: "Test connection" }));
    expect(await within(sheet).findByText("Couldn't open the SSH tunnel.")).toBeDefined();
    expect(within(sheet).queryByText("Couldn't connect.")).toBeNull();
  });

  it("shows an unknown server's fingerprint, trusts it, and tests again", async () => {
    let attempts = 0;
    const calls = open(tunneled, () => {
      attempts += 1;
      if (attempts === 1) {
        throw { kind: "unknownHostKey", message: "bastion.example.com isn't a known SSH server" };
      }
      return "PostgreSQL 18.0";
    });
    const sheet = await screen.findByRole("dialog");
    await userEvent.click(within(sheet).getByRole("button", { name: "Test connection" }));
    expect(await within(sheet).findByText(`ssh-ed25519 ${hostKey.fingerprint}`)).toBeDefined();
    await userEvent.click(within(sheet).getByRole("button", { name: "Trust and connect" }));
    expect(await within(sheet).findByText("PostgreSQL 18.0")).toBeDefined();
    expect(calls.find((call) => call.command === "dataTrustHostKey")?.args).toEqual({
      key: hostKey,
    });
    expect(tests(calls)).toHaveLength(2);
  });
});
