import { describe, expect, it } from "vitest";

import { blankForm, formFromConnection, formProblem, toInput } from "./connection-form";

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
});
