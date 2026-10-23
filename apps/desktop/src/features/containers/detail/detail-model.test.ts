import { describe, expect, it } from "vitest";

import { isDatabase, isSecret, tokenizeJson } from "./detail-model";

describe("isSecret", () => {
  it("hides credentials by name or inside a connection string", () => {
    expect(isSecret({ key: "POSTGRES_PASSWORD", value: "x" })).toBe(true);
    expect(isSecret({ key: "STRIPE_KEY", value: "sk_test" })).toBe(true);
    expect(isSecret({ key: "DATABASE_URL", value: "postgres://shop:pw@db:5432/shop" })).toBe(true);
    expect(isSecret({ key: "PATH", value: "/usr/bin" })).toBe(false);
    expect(isSecret({ key: "REDIS_URL", value: "redis://redis:6379/0" })).toBe(false);
  });
});

describe("isDatabase", () => {
  it("recognises database images", () => {
    expect(isDatabase({ image: "postgres:18" })).toBe(true);
    expect(isDatabase({ image: "nginx:1.29" })).toBe(false);
  });
});

describe("tokenizeJson", () => {
  it("separates keys, strings, numbers and the rest, losing nothing", () => {
    const json = '{\n  "Name": "/web",\n  "Running": true,\n  "Pid": 42\n}';
    const tokens = tokenizeJson(json);
    expect(tokens.map((token) => token.text).join("")).toBe(json);
    expect(tokens.filter((token) => token.kind === "key").map((token) => token.text)).toEqual([
      '"Name"',
      '"Running"',
      '"Pid"',
    ]);
    expect(tokens.find((token) => token.kind === "string")?.text).toBe('"/web"');
    expect(tokens.filter((token) => token.kind === "number").map((token) => token.text)).toEqual([
      "true",
      "42",
    ]);
  });
});
