import { describe, expect, it } from "vitest";

import { logoFor, logoUrl } from "./logos";

describe("logoFor", () => {
  it("matches the most specific keyword first", () => {
    expect(logoFor("postgis/postgis:16-3.4")).toBe("postgresql");
    expect(logoFor("neondatabase/neon")).toBe("neon");
    expect(logoFor("ghcr.io/tursodatabase/libsql-server")).toBe("turso");
  });

  it("ignores the tag and the Docker Hub prefix", () => {
    expect(logoFor("docker.io/library/redis:7-alpine")).toBe("redis");
    expect(logoFor("golang:1.25")).toBe("go");
  });

  it("falls through hints until one matches", () => {
    expect(logoFor(undefined, "my-company/api:latest", "mysql")).toBe("mysql");
  });

  it("returns nothing for an image it doesn't know", () => {
    expect(logoFor("my-company/api:latest")).toBeUndefined();
  });
});

describe("logoUrl", () => {
  it("uses the dark variant only where one exists", () => {
    expect(logoUrl("redis", true)).not.toBe(logoUrl("redis", false));
    expect(logoUrl("postgresql", true)).toBe(logoUrl("postgresql", false));
    expect(logoUrl("postgresql", false)).not.toBe("");
  });
});
