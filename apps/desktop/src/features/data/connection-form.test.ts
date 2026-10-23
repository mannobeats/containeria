import { describe, expect, it } from "vitest";

import { blankForm, formFromConnection, formProblem, toInput } from "./connection-form";

const viaSsh = {
  ...blankForm("postgres"),
  name: "billing",
  ssh: true,
  sshHost: " bastion ",
  sshUser: "deploy",
};

describe("connection form", () => {
  it("starts from the engine's defaults", () => {
    const neon = blankForm("neon");
    expect(neon.engine).toBe("postgres");
    expect(neon.provider).toBe("neon");
    expect(neon.tls).toBe(true);
    expect(neon.port).toBe("5432");
    expect(blankForm("sqlite").host).toBe("");
  });

  it("names the first missing field", () => {
    expect(formProblem(blankForm("postgres"))).toBe("Give the connection a name.");
    expect(formProblem({ ...blankForm("sqlite"), name: "notes" })).toBe(
      "Choose the SQLite database file.",
    );
    expect(formProblem({ ...blankForm("mysql"), name: "auth", port: "abc" })).toBe(
      "The port is a number up to 65535.",
    );
    expect(formProblem({ ...blankForm("mysql"), name: "auth" })).toBeNull();
  });

  it("rejects a port above 65535", () => {
    expect(formProblem({ ...blankForm("mysql"), name: "auth", port: "70000" })).toBe(
      "The port is a number up to 65535.",
    );
  });

  it("keeps the saved password unless it was changed", () => {
    const form = formFromConnection({
      id: "billing",
      name: "billing",
      engine: "postgres",
      provider: null,
      host: "db.example.com",
      port: 5432,
      user: "app",
      database: null,
      file: null,
      tls: true,
      environment: "production",
      hasPassword: true,
    });
    expect(toInput(form).password).toBeNull();
    expect(toInput({ ...form, password: "new", passwordChanged: true }).password).toBe("new");
    expect(toInput({ ...form, port: "" }).port).toBeNull();
  });

  it("asks for a password when the connection has none saved", () => {
    const form = formFromConnection({
      id: "local",
      name: "local",
      engine: "postgres",
      provider: null,
      host: "localhost",
      port: 5432,
      user: "postgres",
      database: null,
      file: null,
      tls: false,
      environment: "local",
      hasPassword: false,
      ssh: { host: "bastion", port: 22, user: "deploy", auth: "agent", keyFile: null },
      hasSshSecret: false,
    });
    expect([form.passwordChanged, form.sshSecretChanged]).toEqual([true, true]);
  });

  it("sends an SSH tunnel only when it is on, and only the secret its login needs", () => {
    expect(toInput(blankForm("postgres")).ssh).toBeNull();
    expect(toInput(viaSsh).ssh).toEqual({
      host: "bastion",
      port: 22,
      user: "deploy",
      auth: "agent",
      keyFile: null,
    });
    expect(toInput({ ...viaSsh, sshSecret: "left over" }).sshSecret).toBeNull();
    expect(toInput({ ...viaSsh, sshAuth: "password", sshSecret: "pw" }).sshSecret).toBe("pw");
    expect(toInput({ ...viaSsh, engine: "sqlite", file: "a.db" }).ssh).toBeNull();
  });

  it("names the first missing SSH field", () => {
    expect(formProblem({ ...viaSsh, sshHost: "" })).toBe("Enter the SSH host.");
    expect(formProblem({ ...viaSsh, sshPort: "70000" })).toBe(
      "The SSH port is a number up to 65535.",
    );
    expect(formProblem({ ...viaSsh, sshAuth: "key" })).toBe("Choose the SSH private key file.");
    expect(formProblem(viaSsh)).toBeNull();
  });
});
