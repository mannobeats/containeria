import { describe, expect, it } from "vitest";

import { containerFixture } from "@/test/fixtures";

import {
  dockerRun,
  emptyForm,
  freePort,
  nextHostPort,
  splitCommand,
  suggestedName,
  toSpec,
  usedPorts,
  validate,
} from "./run-model";

describe("splitCommand", () => {
  it("splits on spaces and keeps quoted text together", () => {
    expect(splitCommand(`sh -c "echo hi there" 'a b'`)).toEqual([
      "sh",
      "-c",
      "echo hi there",
      "a b",
    ]);
    expect(splitCommand('  ""  x ')).toEqual(["", "x"]);
    expect(splitCommand("")).toEqual([]);
  });
});

describe("suggestedName", () => {
  it("names the container after the image", () => {
    expect(suggestedName("ghcr.io/acme/api:v2")).toBe("api-1");
    expect(suggestedName("postgres@sha256:abc")).toBe("postgres-1");
    expect(suggestedName(" ")).toBe("");
  });
});

describe("ports", () => {
  const used = usedPorts([
    containerFixture({ name: "db", ports: [{ container: 5432, host: 5432, protocol: "tcp" }] }),
  ]);

  it("finds the next free host port", () => {
    expect(freePort(5432, used)).toBe(5433);
    expect(freePort(8080, used)).toBe(8080);
  });

  it("names the container that holds a port", () => {
    const errors = validate(
      { ...emptyForm, image: "postgres", ports: [{ id: "a", host: "5432", container: "5432" }] },
      used,
    );
    expect(errors.ports).toBe("Port 5432 is in use by db.");
  });
});

describe("nextHostPort", () => {
  it("counts on from the ports typed so far", () => {
    expect(nextHostPort([{ id: "a", host: "9000", container: "80" }], new Map())).toBe(9001);
  });

  it("skips a Mac port that isn't a number", () => {
    expect(nextHostPort([{ id: "a", host: "web", container: "80" }], new Map())).toBe(8080);
  });
});

describe("validate", () => {
  const form = { ...emptyForm, image: "nginx" };
  const port = (host: string) =>
    validate({ ...form, ports: [{ id: "a", host, container: "80" }] }, new Map());

  it("asks for an image", () => {
    expect(validate(emptyForm, new Map())).toEqual({ image: "Choose an image to run." });
  });

  it("refuses a name Docker wouldn't take", () => {
    expect(validate({ ...form, name: "bad name" }, new Map())).toEqual({
      name: "Use letters, numbers, dots, dashes and underscores.",
    });
  });

  it("takes ports from 1 to 65535 only", () => {
    expect(port("65535")).toEqual({});
    expect(port("0").ports).toBe("Ports are numbers from 1 to 65535.");
    expect(port("65536").ports).toBe("Ports are numbers from 1 to 65535.");
    expect(port("80.5").ports).toBe("Ports are numbers from 1 to 65535.");
  });

  it("refuses a variable with a value but no name", () => {
    const env = [{ id: "a", key: " ", value: "dev" }];
    expect(validate({ ...form, env }, new Map())).toEqual({ env: "Give each variable a name." });
  });

  it("refuses a mount with only one side filled in", () => {
    const storage = [{ id: "a", source: "pg", target: "", readOnly: false }];
    expect(validate({ ...form, storage }, new Map())).toEqual({
      storage: "Give each mount a volume or folder and a path in the container.",
    });
  });

  it("lets empty rows through, since Run leaves them out", () => {
    const env = [{ id: "a", key: "", value: "" }];
    const storage = [{ id: "b", source: "", target: "", readOnly: false }];
    expect(validate({ ...form, env, storage }, new Map())).toEqual({});
  });
});

describe("toSpec and dockerRun", () => {
  const form = {
    ...emptyForm,
    image: "postgres:18",
    ports: [{ id: "a", host: "5433", container: "5432" }],
    env: [
      { id: "a", key: "POSTGRES_PASSWORD", value: "it's secret" },
      { id: "b", key: " ", value: "ignored" },
    ],
    storage: [{ id: "a", source: "pg", target: "/var/lib/postgresql", readOnly: false }],
    command: "postgres -c log_statement=all",
    amd64: true,
  };

  it("builds the spec Rust runs", () => {
    expect(toSpec(form)).toEqual({
      image: "postgres:18",
      name: "postgres-1",
      ports: [{ host: 5433, container: 5432, protocol: "tcp" }],
      env: [{ key: "POSTGRES_PASSWORD", value: "it's secret" }],
      storage: [{ source: "pg", target: "/var/lib/postgresql", readOnly: false }],
      restart: "unlessStopped",
      command: ["postgres", "-c", "log_statement=all"],
      platform: "linux/amd64",
    });
  });

  it("writes the same container as a docker run command", () => {
    expect(dockerRun(form)).toBe(
      "docker run -d --name postgres-1 --platform linux/amd64 --restart unless-stopped -p 5433:5432 -e 'POSTGRES_PASSWORD=it'\\''s secret' -v pg:/var/lib/postgresql postgres:18 postgres -c log_statement=all",
    );
  });
});
